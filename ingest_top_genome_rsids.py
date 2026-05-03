#!/usr/bin/env python3
"""Ingest the top-N matched rsids from your genome upload into the wiki.

Cross-references your VCF against SNPedia genotype pages, then orders the
matches in two phases:
  1. Pages whose SNPedia genotype has an explicit `magnitude=...` field —
     ranked by magnitude descending.
  2. Pages with no `magnitude` field on the genotype — appended after the
     magnitude-ranked block, ordered lexicographically by rsid.

`--top-n` / `--start` slice the unified list, so the magnitude block is
consumed first and the no-magnitude block is reached only once that runs
out. Then runs the same compile pipeline as POST /api/genome-wiki/ingest
— but with bounded concurrency to stay under Anthropic's
8K-output-tokens-per-minute rate limit, and skipping rsids whose wiki page
is already on disk.

Usage:
  python3 ingest_top_genome_rsids.py --top-n 30
  python3 ingest_top_genome_rsids.py --top-n 20 --start 30   # next 20
  python3 ingest_top_genome_rsids.py --top-n 10 --rebuild-rank
  python3 ingest_top_genome_rsids.py --top-n 10 --concurrency-variants 4
  python3 ingest_top_genome_rsids.py --top-n 10 --force      # ignore skip set
  python3 ingest_top_genome_rsids.py --systems-only          # only compile systems from current gene wiki
  python3 ingest_top_genome_rsids.py --systems-only --rebuild-systems  # ditto, overwriting existing
  python3 ingest_top_genome_rsids.py --ask "What does my MTHFR C677T mean for folate?"
  python3 ingest_top_genome_rsids.py --report longevity      # one of: pharmacogenomics longevity performance nutrition methylation
  python3 ingest_top_genome_rsids.py --annotate-vcf out.vcf  # fill in missing rsids in the latest genome upload by SNPedia position lookup

VCF source: by default the latest entry in `genome_uploads` (its symlinked
file under VITALSCOPE_UPLOADS). Override with --vcf.

Rank cache: the (slow) VCF-vs-SNPedia magnitude join is cached as a TSV at
$VITALSCOPE_GENOME_WIKI/rank_by_magnitude.tsv. Pass --rebuild-rank after
adding new SNPedia data or a new genome upload to refresh it.

Environment:
  ANTHROPIC_API_KEY        required (the AI compile passes need it)
  VITALSCOPE_DB            SQLite DB path
  VITALSCOPE_GENOME_WIKI   wiki root
  VITALSCOPE_UPLOADS       uploads dir

Empirical concurrency ceilings (from running this on a real WGS):
  Anthropic Sonnet, direct          variants=3   genes=2     (8K-tokens/min cap)
  OpenRouter Sonnet                 variants=15  genes=8     (~2× direct)
  OpenRouter DeepSeek V4 Flash      variants=20  genes=10    (per-account cap ≈ 25)
  OpenRouter DeepSeek V4 Pro        variant=15   genes=8     (Parasail upstream is flaky;
                                                              raise GENOME_WIKI_AI_TIMEOUT_SEC
                                                              to ~240s — model is slow)

  Pushing past the ceiling produces a storm of `rate_limit` retries; the
  retry path absorbs them but throughput drops because every slot holds
  its semaphore through a 60-90s backoff. Stay just below.
"""

import argparse
import asyncio
import json
import random
import re
import sqlite3
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable, Optional

import backend.app as app

DEFAULT_RANK_CACHE = app.GENOME_WIKI_ROOT / "rank_by_magnitude.tsv"
DEFAULT_HG38_POSITIONS_CACHE = app.GENOME_WIKI_ROOT / "rsid_positions_hg38.tsv"
DEFAULT_HG19_POSITIONS_CACHE = app.GENOME_WIKI_ROOT / "rsid_positions_hg19.tsv"

_GENE_FIELD_RE = re.compile(r"\|\s*Gene\s*=\s*([A-Za-z0-9._-]+)", re.IGNORECASE)
_GENO_TITLE_RE = re.compile(r"^Rs(\d+)\(([ACGT]);([ACGT])\)$", re.IGNORECASE)
_GENO_MAG_RE = re.compile(r"\|\s*magnitude\s*=\s*([\d.]+)", re.IGNORECASE)
_GENO_REPUTE_RE = re.compile(r"\|\s*repute\s*=\s*(\w+)", re.IGNORECASE)
_GENO_SUMMARY_RE = re.compile(r"\|\s*summary\s*=\s*([^\n|}]+)", re.IGNORECASE)

# {{Rsnum ...}} fields on canonical Rs<NNN> pages. Position is GRCh38; we
# liftOver to GRCh37/hg19 once at startup so we can annotate either build.
_RSNUM_BLOCK_RE = re.compile(r"\{\{[Rr]snum.*?\}\}", re.DOTALL)
_RSNUM_RSID_RE = re.compile(r"\|\s*rsid\s*=\s*(\d+)", re.IGNORECASE)
_RSNUM_CHR_RE = re.compile(r"\|\s*Chromosome\s*=\s*([0-9XYMTxymt]+)", re.IGNORECASE)
_RSNUM_POS_RE = re.compile(r"\|\s*position\s*=\s*(\d+)", re.IGNORECASE)
_RSNUM_ASM_RE = re.compile(r"\|\s*Assembly\s*=\s*GRCh(\d+)", re.IGNORECASE)

# Real HGNC symbols start with an uppercase letter and use ASCII letters,
# digits, and hyphens. They almost always either contain a digit (BRCA1,
# IL6, C1orf127, LOC101928462) or are all-uppercase ≥4 chars (MTHFR, OXTR,
# COMT, HLA-B). SNPedia's `|Gene=` field also carries category tags
# ("renal", "cardiovascular", "Intergenic", "DNA-damage-response") and
# acronyms ("CNS", "PNS", "DNA") that slip past the loose extraction —
# the previous loose filter dragged those into variant filenames where
# the gene-synthesis pass then couldn't anchor and burned retries.
_GENE_SHAPE_RE = re.compile(r"^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$")
_PHANTOM_GENE_BLACKLIST = frozenset({
    "CNS", "PNS", "DNA",  # acronyms shaped like genes but aren't HGNC symbols
})


def _normalise_gene(raw: Optional[str]) -> str:
    """Return raw if it looks like a real gene symbol, else 'UNK'."""
    if not raw:
        return "UNK"
    g = raw.strip()
    if not g or len(g) < 2 or len(g) > 20:
        return "UNK"
    if g in _PHANTOM_GENE_BLACKLIST:
        return "UNK"
    if not _GENE_SHAPE_RE.match(g):
        return "UNK"
    has_digit = any(c.isdigit() for c in g)
    no_hyphen = g.replace("-", "")
    # Real 3-char gene symbols are common (TYR, LEP, FTO, ACE, ABO, INS, …),
    # so accept all-uppercase ≥2 chars; the blacklist catches CNS/PNS/DNA.
    all_upper = no_hyphen.isupper() and len(no_hyphen) >= 2
    if not (has_digit or all_upper):
        return "UNK"
    return g


def _build_genotype_lookup(conn: sqlite3.Connection) -> dict:
    """Index SNPedia genotype pages by (rsid, allele1, allele2).

    `magnitude` is None when the genotype page exists but has no
    `|magnitude=` field — those still represent valid user-genotype
    matches and are ingested in the second pass (after magnitude-ranked
    entries). A bad/non-numeric magnitude is also treated as missing.
    """
    print("[rank] indexing SNPedia genotype pages…", flush=True)
    lookup: dict[tuple[str, str, str], dict] = {}
    for row in conn.execute(
        "SELECT title, raw_json FROM snpedia_pages "
        "WHERE title LIKE 'Rs%(_;_)' OR title LIKE 'rs%(_;_)'"
    ):
        m = _GENO_TITLE_RE.match(row["title"])
        if not m:
            continue
        rs = "rs" + m.group(1)
        a, b = m.group(2).upper(), m.group(3).upper()
        text = json.loads(row["raw_json"])["revisions"][0]["*"]
        mm = _GENO_MAG_RE.search(text)
        mag: Optional[float] = None
        if mm:
            try:
                mag = float(mm.group(1))
            except ValueError:
                mag = None
        rep = _GENO_REPUTE_RE.search(text)
        smy = _GENO_SUMMARY_RE.search(text)
        lookup[(rs, a, b)] = {
            "magnitude": mag,
            "repute": (rep.group(1) if rep else "").strip(),
            "summary": (smy.group(1) if smy else "").strip(),
        }
    return lookup


def _build_hg38_position_lookup(
    conn: sqlite3.Connection, cache_path: Path,
) -> dict[tuple[str, int], str]:
    """Map (chromosome, hg38 position) → rsid from SNPedia Rsnum templates.

    Cached to a TSV under the wiki root because scanning all 273k SNPedia
    pages takes ~30s. Delete the cache file to rebuild.
    """
    if cache_path.is_file():
        out: dict[tuple[str, int], str] = {}
        with cache_path.open() as fh:
            next(fh)
            for line in fh:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue
                try:
                    out[(parts[0], int(parts[1]))] = parts[2]
                except ValueError:
                    continue
        print(f"[positions] loaded {len(out):,} hg38 positions from {cache_path}", flush=True)
        return out
    print("[positions] scanning SNPedia pages for hg38 positions…", flush=True)
    # Keyed by (chrom, hg38_pos). On collision (dbSNP merges leave multiple
    # SNPedia pages claiming the same locus, e.g. Rs4680 + Rs165688), keep
    # the lowest numeric rsid — older ID = canonical survivor of the merge.
    out: dict[tuple[str, int], str] = {}
    out_num: dict[tuple[str, int], int] = {}
    for row in conn.execute(
        "SELECT title, raw_json FROM snpedia_pages "
        "WHERE title GLOB 'Rs[0-9]*' AND title NOT GLOB '*(*'"
    ):
        try:
            text = json.loads(row["raw_json"])["revisions"][0]["*"]
        except Exception:
            continue
        block_m = _RSNUM_BLOCK_RE.search(text)
        if not block_m:
            continue
        block = block_m.group(0)
        rsid_m = _RSNUM_RSID_RE.search(block)
        chr_m = _RSNUM_CHR_RE.search(block)
        pos_m = _RSNUM_POS_RE.search(block)
        if not (rsid_m and chr_m and pos_m):
            continue
        asm_m = _RSNUM_ASM_RE.search(block)
        if asm_m and asm_m.group(1) != "38":
            continue
        try:
            pos = int(pos_m.group(1))
            rsid_num = int(rsid_m.group(1))
        except ValueError:
            continue
        chrom = chr_m.group(1).upper()
        key = (chrom, pos)
        if key in out_num and out_num[key] <= rsid_num:
            continue
        out[key] = f"rs{rsid_num}"
        out_num[key] = rsid_num
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("w") as fh:
        fh.write("chrom\thg38_pos\trsid\n")
        for (chrom, pos), rsid in out.items():
            fh.write(f"{chrom}\t{pos}\t{rsid}\n")
    print(f"[positions] cached {len(out):,} (chrom, hg38_pos) → rsid pairs", flush=True)
    return out


def _build_hg19_position_lookup(
    hg38_lookup: dict[tuple[str, int], str], cache_path: Path,
) -> dict[tuple[str, int], str]:
    """Lift every SNPedia hg38 position to hg19 via UCSC chain file.

    Cached because the first liftOver call downloads a ~1MB chain file and
    converting 100k positions takes ~10s.
    """
    if cache_path.is_file():
        out: dict[tuple[str, int], str] = {}
        with cache_path.open() as fh:
            next(fh)
            for line in fh:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue
                try:
                    out[(parts[0], int(parts[1]))] = parts[2]
                except ValueError:
                    continue
        print(f"[positions] loaded {len(out):,} hg19 positions from {cache_path}", flush=True)
        return out
    try:
        from pyliftover import LiftOver
    except ImportError:
        print(
            "[positions] pyliftover not installed — hg19 annotation disabled. "
            "pip install pyliftover==0.4.1",
            flush=True,
        )
        return {}
    print("[positions] lifting SNPedia hg38 → hg19 (one-time, ~10s)…", flush=True)
    lo = LiftOver("hg38", "hg19")
    out = {}
    for (chrom, hg38_pos), rsid in hg38_lookup.items():
        hits = lo.convert_coordinate(f"chr{chrom}", hg38_pos - 1)
        if not hits:
            continue
        lifted_chr = hits[0][0].removeprefix("chr").upper()
        out[(lifted_chr, hits[0][1] + 1)] = rsid
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("w") as fh:
        fh.write("chrom\thg19_pos\trsid\n")
        for (chrom, pos), rsid in out.items():
            fh.write(f"{chrom}\t{pos}\t{rsid}\n")
    print(f"[positions] cached {len(out):,} (chrom, hg19_pos) → rsid pairs", flush=True)
    return out


def _detect_vcf_build(
    vcf_path: Path,
    hg38_lookup: dict[tuple[str, int], str],
    hg19_lookup: dict[tuple[str, int], str],
    sample_max: int = 200_000,
    min_hits: int = 50,
) -> str:
    """Stream variant lines until we accumulate at least `min_hits` matches
    against either build (or we've scanned `sample_max` lines), then return
    the winning build. Real WGS files start with telomeric chr1 positions
    that have zero SNPedia coverage, so a small sample window misses
    everything — read until we have a real signal.
    """
    hg38_hits = hg19_hits = sampled = 0
    with vcf_path.open() as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            chrom = parts[0].removeprefix("chr").upper()
            try:
                pos = int(parts[1])
            except ValueError:
                continue
            if (chrom, pos) in hg38_lookup:
                hg38_hits += 1
            if (chrom, pos) in hg19_lookup:
                hg19_hits += 1
            sampled += 1
            if max(hg38_hits, hg19_hits) >= min_hits:
                break
            if sampled >= sample_max:
                break
    print(
        f"[positions] build detection — sampled {sampled:,} lines, "
        f"hg38_hits={hg38_hits}, hg19_hits={hg19_hits}",
        flush=True,
    )
    if hg38_hits == 0 and hg19_hits == 0:
        return "unknown"
    return "hg38" if hg38_hits >= hg19_hits else "hg19"


def _annotate_vcf_in_place(
    in_path: Path,
    out_path: Path,
    position_to_rsid: dict[tuple[str, int], str],
) -> tuple[int, int, int, int]:
    """Stream `in_path` to `out_path`, fixing the ID column from the SNPedia
    position lookup. Two corrections happen per row:

    1. Missing rsid (`.` / empty / non-rs ID): if SNPedia has a rsid at this
       position, fill it in. Counted as `annotated`.
    2. Wrong/non-canonical rsid: dbSNP merges leave VCFs with newer rsids
       (e.g. rs1591309094) that have been merged into older canonical ones
       (rs1799732). The wiki ingest is keyed by rsid, so it can't bridge
       these. If SNPedia has a different (canonical) rsid at this position,
       replace the VCF's rsid with SNPedia's. Counted as `canonicalised`.

    `had_id` counts rows whose existing rsid already matched SNPedia (or
    SNPedia didn't know the position).

    Returns (total_variants, had_id, annotated, canonicalised).
    """
    total = had_id = annotated = canonicalised = 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with in_path.open("r", encoding="utf-8", errors="replace") as fin, \
         out_path.open("w", encoding="utf-8") as fout:
        for line in fin:
            if line.startswith("##"):
                fout.write(line)
                continue
            if line.startswith("#"):
                fout.write("##VitalScopeAnnotation=position-to-rsid via SNPedia (" +
                           datetime.utcnow().isoformat(timespec="seconds") + "Z)\n")
                fout.write(line)
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                fout.write(line)
                continue
            total += 1
            current_id = parts[2]
            chrom = parts[0].removeprefix("chr").upper()
            try:
                pos = int(parts[1])
            except ValueError:
                fout.write(line)
                continue
            snpedia_rsid = position_to_rsid.get((chrom, pos))
            if current_id and current_id != "." and current_id.lower().startswith("rs"):
                # Existing rsid — canonicalise if SNPedia knows a different
                # (older / merged-into) rsid at this position.
                if snpedia_rsid and snpedia_rsid.lower() != current_id.lower():
                    parts[2] = snpedia_rsid
                    canonicalised += 1
                    fout.write("\t".join(parts) + "\n")
                else:
                    had_id += 1
                    fout.write(line)
                continue
            if snpedia_rsid:
                parts[2] = snpedia_rsid
                annotated += 1
                fout.write("\t".join(parts) + "\n")
            else:
                fout.write(line)
    return total, had_id, annotated, canonicalised


def _stream_user_vcf(vcf_path: Path, known_rsids: set[str]) -> list[tuple[str, str, str, str]]:
    user_rows: list[tuple[str, str, str, str]] = []
    with open(vcf_path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 10:
                continue
            rsid = parts[2]
            if not rsid.startswith("rs"):
                continue
            rsid_lc = rsid.lower()
            if rsid_lc not in known_rsids:
                continue
            if parts[6] not in ("PASS", "."):
                continue
            ref = parts[3].upper()
            alts = parts[4].upper().split(",")
            fmt_fields = parts[8].split(":")
            sample_fields = parts[9].split(":")
            try:
                gt_idx = fmt_fields.index("GT")
            except ValueError:
                continue
            gt_raw = sample_fields[gt_idx].replace("|", "/")
            if "." in gt_raw:
                continue
            try:
                a_idx, b_idx = (int(x) for x in gt_raw.split("/"))
            except ValueError:
                continue

            def _resolve(i: int) -> Optional[str]:
                if i == 0:
                    return ref
                if 1 <= i <= len(alts):
                    return alts[i - 1]
                return None

            a1, a2 = _resolve(a_idx), _resolve(b_idx)
            if not a1 or not a2 or len(a1) != 1 or len(a2) != 1 or a1 not in "ACGT" or a2 not in "ACGT":
                continue
            user_rows.append((rsid_lc, a1, a2, gt_raw))
    return user_rows


_RSNUM_SUMMARY_RE = re.compile(r"\|\s*Summary\s*=\s*([^\n|}]+)", re.IGNORECASE)


_RSNUM_GENE_RE = re.compile(r"\|\s*Gene\s*=\s*([A-Za-z0-9._-]+)", re.IGNORECASE)
_VARIANT_PAGE_BODY_MIN = 2000  # filter stub pages (Rsnum-only); 2000 is the
# observed cliff between "infobox-only stubs" (≤1000 chars) and pages with
# real synthesised content (≥2000 chars). Trades ~12k thin pages for ~1.5k
# substantial ones. SLC6A4/MAOA/COMT cleared; DRD5's rs6283 (body=463) is
# a genuine stub and stays filtered.


def _build_variant_page_summary_lookup(conn: sqlite3.Connection) -> dict[str, str]:
    """Map rsid → display summary from canonical Rs<N> variant pages.

    Used as a fallback when SNPedia has a variant page for a rsid but no
    per-genotype subpage that matches the user's allele combo (common for
    SLC6A4, DRD5, MAOA, and ~half of HLA / immune variants — the
    pharmacology lives on the parent page, not split per allele).

    Eligibility rules — a rsid enters the lookup if:
      a) the Rsnum infobox has a non-empty `|Summary=` field, OR
      b) it has a `|Gene=` tag AND the wikitext body is at least
         _VARIANT_PAGE_BODY_MIN chars (filters position-only stubs while
         keeping real curated pages without an explicit Summary).
    Pages that match (b) get a synthesized placeholder summary so the
    rank cache stays human-readable.
    """
    print("[rank] indexing SNPedia variant pages for fallback summaries…", flush=True)
    out: dict[str, str] = {}
    for row in conn.execute(
        "SELECT title, raw_json FROM snpedia_pages "
        "WHERE title GLOB 'Rs[0-9]*' AND title NOT GLOB '*(*'"
    ):
        try:
            text = json.loads(row["raw_json"])["revisions"][0]["*"]
        except Exception:
            continue
        block_m = _RSNUM_BLOCK_RE.search(text)
        if not block_m:
            continue
        block = block_m.group(0)
        rsid_m = _RSNUM_RSID_RE.search(block)
        if not rsid_m:
            continue
        rsid = "rs" + rsid_m.group(1)
        sum_m = _RSNUM_SUMMARY_RE.search(block)
        if sum_m and sum_m.group(1).strip():
            out[rsid] = sum_m.group(1).strip()
            continue
        gene_m = _RSNUM_GENE_RE.search(block)
        if gene_m and len(text) >= _VARIANT_PAGE_BODY_MIN:
            out[rsid] = f"(SNPedia variant page for {gene_m.group(1).strip()} — no summary)"
    return out


def _rank(vcf_path: Path, conn: sqlite3.Connection) -> list[dict]:
    geno_lookup = _build_genotype_lookup(conn)
    variant_page_summaries = _build_variant_page_summary_lookup(conn)
    known_rsids = {r["rsid"].lower() for r in conn.execute("SELECT rsid FROM snpedia_variants")}
    print(
        f"[rank] {len(geno_lookup):,} genotype-magnitude pairs; "
        f"{len(variant_page_summaries):,} variant-page summaries; "
        f"{len(known_rsids):,} rsids in snpedia_variants",
        flush=True,
    )
    print(f"[rank] streaming {vcf_path}…", flush=True)
    user_rows = _stream_user_vcf(vcf_path, known_rsids)
    print(f"[rank] {len(user_rows):,} VCF rows match SNPedia", flush=True)
    ranked: list[dict] = []
    fallback_count = 0
    for rsid, a1, a2, gt_raw in user_rows:
        rec = geno_lookup.get((rsid, a1, a2)) or geno_lookup.get((rsid, a2, a1))
        if rec is None:
            # No genotype subpage matches the user's allele combo. Fall back
            # to the variant page if SNPedia has one with a non-empty
            # `|Summary=` field — these enter the no-magnitude tier of the
            # rank. Variant-page entries with no summary are stubs (just
            # position metadata, no medical info to synthesise) and are
            # skipped to avoid burning AI calls on empty pages.
            summary = variant_page_summaries.get(rsid, "")
            if not summary:
                continue
            rec = {"magnitude": None, "repute": "", "summary": summary}
            fallback_count += 1
        ranked.append({
            "rsid": rsid,
            "user_genotype": f"({a1};{a2})",
            "vcf_gt": gt_raw,
            "magnitude": rec["magnitude"],
            "repute": rec["repute"],
            "summary": rec["summary"],
        })
    print(
        f"[rank] {len(ranked):,} ranked entries "
        f"({len(ranked) - fallback_count:,} from genotype subpages, "
        f"{fallback_count:,} from variant-page fallback)",
        flush=True,
    )
    # Two-phase ordering: magnitude entries first (descending), then the
    # no-magnitude entries (lexicographic by rsid). `magnitude is None`
    # sorts True > False, so the None block lands after every numeric one.
    ranked.sort(key=lambda r: (
        r["magnitude"] is None,
        -(r["magnitude"] or 0.0),
        r["rsid"],
    ))
    return ranked


def _write_rank_cache(ranked: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        fh.write("rsid\tuser_genotype\tvcf_gt\tmagnitude\trepute\tsummary\n")
        for r in ranked:
            s = r["summary"].replace("\t", " ").replace("\n", " ")[:200]
            mag = "" if r["magnitude"] is None else r["magnitude"]
            fh.write(
                f"{r['rsid']}\t{r['user_genotype']}\t{r['vcf_gt']}\t"
                f"{mag}\t{r['repute']}\t{s}\n"
            )


def _read_rank_cache(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open() as fh:
        next(fh)
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            mag_raw = parts[3].strip()
            try:
                magnitude: Optional[float] = float(mag_raw) if mag_raw else None
            except ValueError:
                magnitude = None
            rows.append({
                "rsid": parts[0],
                "user_genotype": parts[1],
                "vcf_gt": parts[2],
                "magnitude": magnitude,
                "repute": parts[4],
                "summary": parts[5] if len(parts) > 5 else "",
            })
    return rows


def _existing_variant_rsids() -> set[str]:
    out: set[str] = set()
    vd = app.GENOME_WIKI_ROOT / "wiki" / "variants"
    if not vd.is_dir():
        return out
    for p in vd.glob("*.md"):
        stem = p.stem
        if "_" in stem:
            out.add(stem.split("_", 1)[0].lower())
    return out


def _resolve_vcf(conn: sqlite3.Connection, override: Optional[Path]) -> Path:
    if override:
        if not override.is_file():
            raise SystemExit(f"VCF not found: {override}")
        return override
    row = conn.execute(
        "SELECT u.filename FROM uploads u "
        "JOIN genome_uploads g ON g.source_upload_id = u.id "
        "ORDER BY g.id DESC LIMIT 1"
    ).fetchone()
    if not row:
        raise SystemExit("no genome_upload exists; pass --vcf or import a genome first")
    p = (app.UPLOADS_DIR / row["filename"]).resolve()
    if not p.is_file():
        raise SystemExit(f"genome upload file missing: {p}")
    return p


def _ensure_genome_upload_id(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT id FROM genome_uploads ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not row:
        raise SystemExit("no genome_uploads row; import a genome first")
    return row["id"]


def _classify_retry_reason(exc: BaseException) -> Optional[str]:
    """Return a short label if the exception is worth retrying, else None.

    Looks at HTTPException status + detail string, then a few generic
    network errors. Validator hedges and link errors are retryable
    because the AI is non-deterministic — a fresh sample often passes.
    """
    detail = ""
    status = None
    try:
        from fastapi import HTTPException as _HE  # local import keeps cold path light
        if isinstance(exc, _HE):
            status = exc.status_code
            detail = str(getattr(exc, "detail", "") or "")
    except Exception:
        pass
    text = (detail + " " + str(exc)).lower()
    # Credit / payment exhaustion — never retryable. Both Anthropic
    # ("credit balance is too low") and OpenRouter ("insufficient credits"
    # / 402) come through wrapped as a 502 from the provider adapter,
    # so message text is the only reliable signal.
    if "credit balance" in text or "insufficient credits" in text:
        return "credit_exhausted"
    # Auth failure — also wrapped as 502 by the adapter, but the inner
    # 401/403 message text is reliably present. Deterministic: a bad key
    # will never become a good one, so retries waste budget. Trip the
    # breaker on the first hit.
    if (
        "invalid x-api-key" in text
        or "authentication_error" in text
        or "permission_error" in text
        or "permission denied" in text
        or "invalid api key" in text
    ):
        return "auth_failed"
    if "rate_limit" in text or "rate limit" in text or " 429" in text or text.startswith("429"):
        return "rate_limit"
    if status == 408 or "timed out" in text or "timeout" in text:
        return "timeout"
    if status == 400 and "medical claim without citation" in text:
        return "validator_hedge"
    if status == 400 and "unresolved wikilink" in text:
        return "validator_link"
    if status == 400 and "colloquial banned phrase" in text:
        return "validator_lint"
    if status in (502, 503, 504):
        return "upstream_5xx"
    if isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    return None


def _backoff_seconds(reason: str, attempt: int) -> float:
    """Sleep between attempts. Jitter prevents thundering-herd retries
    after a multi-task rate-limit storm."""
    if reason == "rate_limit":
        base = 45.0 + 20.0 * attempt        # 65, 85, 105 …
    elif reason == "timeout":
        base = 8.0 * attempt                # 8, 16, 24
    elif reason == "upstream_5xx":
        base = 5.0 * attempt
    else:                                   # validator_*: just resample
        base = 2.0 * attempt
    return base + random.uniform(0, min(10.0, base * 0.2))


class _CreditCircuitBreaker:
    """Trip an asyncio.Event when the run is doomed by a fatal,
    non-call-specific failure: credit exhaustion (after N consecutive
    hits, since the wallet might just have crossed zero) or auth failure
    (immediately on the first hit, since a bad key is deterministic).
    Once tripped, every queued task short-circuits with `_Aborted`
    instead of burning its retry budget on doomed calls.
    """

    def __init__(self, threshold: int = 3) -> None:
        self.threshold = threshold
        self._streak = 0
        self.tripped = asyncio.Event()
        self.trip_reason: Optional[str] = None

    def hit_credit(self) -> None:
        self._streak += 1
        if self._streak >= self.threshold and not self.tripped.is_set():
            self.tripped.set()
            self.trip_reason = "credit_exhausted"
            print(
                f"  ⛔ circuit breaker tripped — {self._streak} consecutive "
                f"credit-exhausted errors. Aborting remaining work; top up "
                f"credits and re-run, skip-existing will resume.",
                flush=True,
            )

    def hit_auth(self) -> None:
        if not self.tripped.is_set():
            self.tripped.set()
            self.trip_reason = "auth_failed"
            print(
                f"  ⛔ circuit breaker tripped — auth_failed (invalid API "
                f"key or permission). Aborting; fix the key and re-run, "
                f"skip-existing will resume.",
                flush=True,
            )

    def hit_other(self) -> None:
        self._streak = 0


class _Aborted(Exception):
    """Raised inside a task when the circuit breaker has tripped."""


async def _retry(
    fn: Callable[[], Awaitable[dict]],
    *,
    label: str,
    max_attempts: int,
    breaker: Optional[_CreditCircuitBreaker] = None,
) -> dict:
    """Call fn() with auto-retry. Logs each retry and its reason in real
    time. Reraises the final exception if all attempts fail. If a
    `breaker` is passed, credit-exhausted errors are non-retryable and
    trip the breaker; once tripped, every new task short-circuits with
    `_Aborted`."""
    last_exc: Optional[BaseException] = None
    for attempt in range(1, max_attempts + 1):
        if breaker is not None and breaker.tripped.is_set():
            raise _Aborted(f"{label} aborted: credit circuit breaker tripped")
        try:
            result = await fn()
            if breaker is not None:
                breaker.hit_other()
            if attempt > 1:
                print(f"  ✓ {label} ok on attempt {attempt}/{max_attempts}", flush=True)
            return result
        except BaseException as exc:
            last_exc = exc
            reason = _classify_retry_reason(exc)
            if reason == "credit_exhausted":
                if breaker is not None:
                    breaker.hit_credit()
                # never retry — wallet is the bottleneck, not the call
                if attempt == 1:
                    print(f"  ✗ {label} credit_exhausted (no retry)", flush=True)
                raise
            if reason == "auth_failed":
                if breaker is not None:
                    breaker.hit_auth()
                # never retry — a bad key won't become a good one
                if attempt == 1:
                    print(f"  ✗ {label} auth_failed (no retry)", flush=True)
                raise
            if breaker is not None:
                breaker.hit_other()
            if reason is None or attempt == max_attempts:
                if attempt > 1:
                    why = reason or "non-retryable"
                    print(f"  ✗ {label} gave up after {attempt} attempts ({why})", flush=True)
                raise
            wait = _backoff_seconds(reason, attempt)
            print(
                f"  ⟳ {label} retry {attempt}/{max_attempts - 1} "
                f"({reason}; waiting {wait:.0f}s)",
                flush=True,
            )
            await asyncio.sleep(wait)
    raise last_exc  # unreachable, but satisfies the type checker


async def _ingest_batch(
    *,
    conn: sqlite3.Connection,
    batch: list[dict],
    raw_pages: dict[str, str],
    concurrency_variants: int,
    concurrency_genes: int,
    max_attempts: int,
) -> tuple[list[dict], list[dict]]:
    sem_v = asyncio.Semaphore(concurrency_variants)
    sem_g = asyncio.Semaphore(concurrency_genes)
    breaker = _CreditCircuitBreaker(threshold=3)

    async def variant(r: dict) -> tuple[str, object]:
        async with sem_v:
            if breaker.tripped.is_set():
                return r["rsid"], _Aborted("circuit breaker tripped")
            rs = r["rsid"]
            try:
                app._write_source_page(rs, raw_pages[rs])
                v = {"rs_id": rs, "gene": r["gene"], "genotype": r["vcf_gt"]}
                scan = app._scan_snpedia_page(raw_pages[rs])
                if scan["magnitude"] == 0 and r["magnitude"] is not None:
                    scan["magnitude"] = r["magnitude"]
                registry = app._registry_entry(conn, rs)
                async def _do() -> dict:
                    return await app._compile_variant_page(
                        variant=v, scan=scan,
                        source_rel=f"sources/snpedia/{rs}", registry=registry,
                    )
                return rs, await _retry(_do, label=rs, max_attempts=max_attempts, breaker=breaker)
            except Exception as e:
                return rs, e

    async def gene(g: str, rels: list[str]) -> tuple[str, object]:
        async with sem_g:
            if breaker.tripped.is_set():
                return g, _Aborted("circuit breaker tripped")
            try:
                async def _do() -> dict:
                    return await app._compile_gene_page(gene=g, variant_rels=rels)
                return g, await _retry(_do, label=g, max_attempts=max_attempts, breaker=breaker)
            except Exception as e:
                return g, e

    async def system(s: str, rels: list[str]) -> tuple[str, object]:
        async with sem_g:
            if breaker.tripped.is_set():
                return s, _Aborted("circuit breaker tripped")
            try:
                async def _do() -> dict:
                    return await app._compile_system_page(system=s, gene_rels=rels)
                return s, await _retry(_do, label=s, max_attempts=max_attempts, breaker=breaker)
            except Exception as e:
                return s, e

    print(f"[variants] {len(batch)} pages, concurrency={concurrency_variants}…", flush=True)
    t0 = time.time()
    v_results = await asyncio.gather(*(variant(r) for r in batch))
    v_elapsed = time.time() - t0

    v_ok = 0
    v_failures: list[dict] = []
    new_genes: dict[str, list[str]] = defaultdict(list)
    for rs, res in v_results:
        if isinstance(res, Exception):
            v_failures.append({"rs_id": rs, "error": str(res)[:200]})
        else:
            v_ok += 1
            path = res.get("path", "")
            if path.startswith("wiki/variants/"):
                stem = path.rsplit("/", 1)[1].rsplit(".", 1)[0]
                if "_" in stem:
                    g = stem.rsplit("_", 1)[1]
                    if g and g != "UNK":
                        new_genes[g].append(path)
    print(f"  variants: {v_elapsed:.1f}s — {v_ok}/{len(batch)} ok, {len(v_failures)} errors")

    all_v = {p.name: f"wiki/variants/{p.name}"
             for p in (app.GENOME_WIKI_ROOT / "wiki" / "variants").glob("*.md")}
    for g in list(new_genes.keys()):
        seen = set(new_genes[g])
        for fname, rel in all_v.items():
            if fname.endswith(f"_{g}.md") and rel not in seen:
                new_genes[g].append(rel)
                seen.add(rel)

    existing_genes = {p.stem for p in (app.GENOME_WIKI_ROOT / "wiki" / "genes").glob("*.md")}
    to_compile = {g: r for g, r in new_genes.items() if g not in existing_genes and r}

    print(f"[genes] {len(to_compile)} new genes, concurrency={concurrency_genes}…", flush=True)
    t1 = time.time()
    g_results = await asyncio.gather(*(gene(g, r) for g, r in to_compile.items())) if to_compile else []
    g_elapsed = time.time() - t1

    g_ok = 0
    g_failures: list[dict] = []
    for g, res in g_results:
        if isinstance(res, Exception):
            g_failures.append({"gene": g, "error": str(res)[:200]})
        elif isinstance(res, dict) and res.get("errors"):
            g_failures.append({"gene": g, "error": res["errors"]})
        else:
            g_ok += 1
    print(f"  genes: {g_elapsed:.1f}s — {g_ok}/{len(to_compile)} ok, {len(g_failures)} errors")

    await _compile_systems_pass(
        conn=conn,
        concurrency=concurrency_genes,
        max_attempts=max_attempts,
        skip_existing=True,
    )

    return v_failures, g_failures


async def _compile_systems_pass(
    *,
    conn: sqlite3.Connection,
    concurrency: int,
    max_attempts: int,
    skip_existing: bool,
) -> dict:
    """Compile wiki/systems/<system>.md from system_tags mined off
    wiki/genes/*.md. Mirrors POST /api/genome-wiki/recompile-systems but
    inherits the script's bounded concurrency + retry policy.

    Returns a summary dict for callers (currently only the CLI uses it).
    """
    grouped, raw_counts = app._mine_systems_from_genes(conn)
    qualifying = {s: rels for s, rels in grouped.items() if len(rels) >= 2}
    existing = {p.stem for p in (app.GENOME_WIKI_ROOT / "wiki" / "systems").glob("*.md")} if skip_existing else set()
    to_compile = {s: rels for s, rels in qualifying.items() if s not in existing}

    print(
        f"[systems] {len(grouped)} mined / {len(qualifying)} ≥2-genes / "
        f"{len(existing)} on disk / {len(to_compile)} to compile "
        f"(concurrency={concurrency})",
        flush=True,
    )
    if raw_counts:
        unmapped = sorted(
            (raw, n) for raw, n in raw_counts.items()
            if app._normalise_system_key(raw) not in qualifying
        )
        if unmapped:
            print(
                f"  note: {len(unmapped)} raw tag values map to systems "
                "with <2 genes (won't be compiled): "
                + ", ".join(f"{raw}×{n}" for raw, n in unmapped[:8])
                + ("…" if len(unmapped) > 8 else ""),
                flush=True,
            )

    if not to_compile:
        return {"written": [], "errors": [], "skipped_below_threshold": {}, "raw_counts": raw_counts}

    sem = asyncio.Semaphore(concurrency)
    # Same circuit breaker as `_ingest_batch` — without it, the systems
    # pass would burn through every queued task firing credit_exhausted /
    # auth_failed errors at a dead provider before exiting (observed: 22
    # systems × 1 attempt against an empty-credit account = 22 doomed
    # calls instead of 3).
    breaker = _CreditCircuitBreaker(threshold=3)

    async def system(s: str, rels: list[str]) -> tuple[str, object]:
        async with sem:
            if breaker.tripped.is_set():
                return s, _Aborted("circuit breaker tripped")
            try:
                async def _do() -> dict:
                    return await app._compile_system_page(system=s, gene_rels=rels)
                return s, await _retry(_do, label=s, max_attempts=max_attempts, breaker=breaker)
            except Exception as e:
                return s, e

    t0 = time.time()
    results = await asyncio.gather(*(system(s, r) for s, r in to_compile.items()))
    elapsed = time.time() - t0

    ok = 0
    written: list[str] = []
    errors: list[dict] = []
    for s, res in results:
        if isinstance(res, Exception):
            errors.append({"system": s, "error": str(res)[:200]})
            print(f"    ✗ {s}: {str(res)[:160]}")
        elif isinstance(res, dict) and res.get("errors"):
            errors.append({"system": s, "error": res["errors"]})
            print(f"    ✗ {s}: {res['errors']}")
        else:
            ok += 1
            written.append(res["path"])
            print(f"    ✓ {s} → {res['path']}")
    print(f"  systems: {elapsed:.1f}s — {ok}/{len(to_compile)} ok")
    return {
        "written": written,
        "errors": errors,
        "skipped_below_threshold": {s: len(r) for s, r in grouped.items() if len(r) < 2},
        "raw_counts": raw_counts,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n", 1)[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--top-n", type=int, default=30,
                        help="how many ranked rsids to ingest from the unified "
                             "list (magnitude-ranked first, no-magnitude "
                             "lexicographic after; default 30)")
    parser.add_argument("--start", type=int, default=0,
                        help="skip the first K ranked rsids (default 0)")
    parser.add_argument("--vcf", type=Path, default=None,
                        help="VCF path; defaults to the latest genome_upload")
    parser.add_argument("--rank-cache", type=Path, default=DEFAULT_RANK_CACHE,
                        help=f"path to cached rank TSV (default {DEFAULT_RANK_CACHE})")
    parser.add_argument("--rebuild-rank", action="store_true",
                        help="recompute the rank TSV even if the cache exists")
    parser.add_argument("--force", action="store_true",
                        help="ignore the on-disk skip set and recompile selected rsids")
    parser.add_argument("--concurrency-variants", type=int, default=3,
                        help="parallel variant compiles (default 3 — rate-limit safe)")
    parser.add_argument("--concurrency-genes", type=int, default=2,
                        help="parallel gene/system compiles (default 2)")
    parser.add_argument("--max-attempts", type=int, default=3,
                        help="total attempts per page including retries "
                             "(default 3; set 1 to disable retries)")
    parser.add_argument("--systems-only", action="store_true",
                        help="skip the variant/gene compile and only run the "
                             "system pass over already-compiled wiki/genes/*.md "
                             "(equivalent to POST /api/genome-wiki/recompile-systems "
                             "but inherits this script's retry + concurrency)")
    parser.add_argument("--rebuild-systems", action="store_true",
                        help="with --systems-only, also recompile systems "
                             "whose wiki/systems/<x>.md already exists "
                             "(default skips them)")
    parser.add_argument("--model", default=None,
                        help="override the AI model for this run (defaults to "
                             "$VITALSCOPE_AI_MODEL or the provider default). "
                             "e.g. claude-opus-4-7, claude-haiku-4-5-20251001, "
                             "anthropic/claude-sonnet-4.6 for openrouter")
    parser.add_argument("--ask", metavar="QUESTION", default=None,
                        help="ask a question against the compiled wiki and print "
                             "the answer (equivalent to POST /api/genome-wiki/query). "
                             "Files the QA back to wiki/synthesis/qa/<slug>.md. "
                             "Mutually exclusive with --report and --systems-only.")
    parser.add_argument("--report", metavar="TOPIC", default=None,
                        choices=["pharmacogenomics", "longevity", "performance",
                                 "nutrition", "methylation"],
                        help="generate a topical report from the wiki "
                             "(equivalent to POST /api/genome-wiki/report). "
                             "Writes to wiki/synthesis/reports/<topic>_<date>.md. "
                             "Mutually exclusive with --ask and --systems-only.")
    parser.add_argument("--annotate-vcf", metavar="OUT_VCF", type=Path, default=None,
                        help="read the input VCF (--vcf or the latest genome_upload), "
                             "fill in missing rsids by matching variant positions "
                             "against SNPedia's hg38/hg19 catalog, and write the "
                             "annotated VCF to OUT_VCF. Build is auto-detected. "
                             "Skips the rank/variant/gene/system passes — run the "
                             "ingest separately afterwards with --vcf OUT_VCF. "
                             "Mutually exclusive with --ask / --report / --systems-only.")
    args = parser.parse_args(argv)

    selected_modes = sum(1 for x in (args.ask, args.report, args.systems_only, args.annotate_vcf) if x)
    if selected_modes > 1:
        parser.error("--ask / --report / --systems-only / --annotate-vcf are mutually exclusive")

    if args.model:
        app.AI_MODEL = args.model
        app._ai_provider = None
    print(f"[setup] AI provider={app.AI_PROVIDER} model={app.AI_MODEL}", flush=True)

    conn = sqlite3.connect(str(app.DB_PATH))
    conn.row_factory = sqlite3.Row

    if args.ask:
        question = args.ask.strip()
        print(f"[mode] ask — {question[:120]}{'…' if len(question) > 120 else ''}", flush=True)
        t0 = time.time()
        try:
            res = asyncio.run(app.query_genome_wiki(app.GenomeWikiQueryIn(question=question)))
        except Exception as e:
            print(f"  ✗ {e}", flush=True)
            conn.close()
            return 1
        conn.close()
        print(f"\n=== wrote {res['path']} in {time.time() - t0:.1f}s ===\n")
        fm = res["frontmatter"] or {}
        if fm.get("title"):
            print(f"# {fm['title']}\n")
        if fm.get("summary"):
            print(f"{fm['summary']}\n")
        print(res["body"] or "")
        return 0

    if args.report:
        print(f"[mode] report — topic={args.report}", flush=True)
        t0 = time.time()
        try:
            res = asyncio.run(app.generate_genome_wiki_report(
                app.GenomeWikiReportIn(topic=args.report)
            ))
        except Exception as e:
            print(f"  ✗ {e}", flush=True)
            conn.close()
            return 1
        conn.close()
        print(f"\n=== wrote {res['path']} in {time.time() - t0:.1f}s ===\n")
        fm = res["frontmatter"] or {}
        if fm.get("title"):
            print(f"# {fm['title']}\n")
        if fm.get("summary"):
            print(f"{fm['summary']}\n")
        print(res["body"] or "")
        return 0

    if args.annotate_vcf:
        in_vcf = _resolve_vcf(conn, args.vcf)
        out_vcf = args.annotate_vcf
        print(f"[mode] annotate-vcf — input={in_vcf} output={out_vcf}", flush=True)
        t0 = time.time()
        hg38 = _build_hg38_position_lookup(conn, DEFAULT_HG38_POSITIONS_CACHE)
        hg19 = _build_hg19_position_lookup(hg38, DEFAULT_HG19_POSITIONS_CACHE)
        build = _detect_vcf_build(in_vcf, hg38, hg19)
        print(f"[positions] detected VCF build: {build}", flush=True)
        if build == "hg38":
            lookup = hg38
        elif build == "hg19":
            lookup = hg19
        else:
            print("[positions] could not detect build (no SNPedia matches in first 500 lines); aborting", flush=True)
            conn.close()
            return 1
        if not lookup:
            print("[positions] empty position lookup; aborting", flush=True)
            conn.close()
            return 1
        total, had, annotated, canonicalised = _annotate_vcf_in_place(in_vcf, out_vcf, lookup)
        conn.close()
        print(
            f"\n=== done in {time.time() - t0:.1f}s ===\n"
            f"  variants:        {total:,}\n"
            f"  already canonical: {had:,}\n"
            f"  newly annotated:   {annotated:,} (was '.' / non-rs ID, now rsid)\n"
            f"  canonicalised:     {canonicalised:,} (existing rsid replaced with SNPedia's older / merged-into one)\n"
            f"  output:          {out_vcf}",
            flush=True,
        )
        return 0

    if args.systems_only:
        print("[mode] systems-only — skipping VCF, rank, variant, and gene passes", flush=True)
        t0 = time.time()
        summary = asyncio.run(_compile_systems_pass(
            conn=conn,
            concurrency=args.concurrency_genes,
            max_attempts=args.max_attempts,
            skip_existing=not args.rebuild_systems,
        ))
        try:
            app._rebuild_wiki_index(conn)
            app._render_index_md(conn)
        except Exception as e:
            print(f"  WARN: index rebuild failed: {e}")
        app._append_log(
            f"INGEST systems-only written={len(summary['written'])} "
            f"errors={len(summary['errors'])} skipped_lt_threshold={len(summary['skipped_below_threshold'])}"
        )
        conn.close()
        print(f"\n=== done in {time.time() - t0:.1f}s ===")
        return 0 if not summary["errors"] else 1

    vcf_path = _resolve_vcf(conn, args.vcf)
    print(f"[setup] VCF: {vcf_path}", flush=True)

    if args.rebuild_rank or not args.rank_cache.is_file():
        ranked = _rank(vcf_path, conn)
        _write_rank_cache(ranked, args.rank_cache)
        print(f"[rank] wrote {args.rank_cache} ({len(ranked):,} rows)")
    else:
        ranked = _read_rank_cache(args.rank_cache)
        print(f"[rank] loaded {args.rank_cache} ({len(ranked):,} rows)")

    candidates = ranked[args.start: args.start + args.top_n]
    if not candidates:
        print("no rsids in selected range")
        return 0

    n_with_mag = sum(1 for r in candidates if r["magnitude"] is not None)
    n_no_mag = len(candidates) - n_with_mag
    skip = set() if args.force else _existing_variant_rsids()
    fresh = [r for r in candidates if r["rsid"] not in skip]
    print(
        f"\n[batch] selected {len(candidates)} (start={args.start}); "
        f"{n_with_mag} with magnitude / {n_no_mag} without; "
        f"{len(candidates) - len(fresh)} already on disk, {len(fresh)} to compile"
    )
    if not fresh:
        print("nothing to do")
        return 0

    raw_pages: dict[str, str] = {}
    out_dir = app.GENOME_WIKI_ROOT / "raw" / "snpedia"
    out_dir.mkdir(parents=True, exist_ok=True)
    for r in fresh:
        rs = r["rsid"]
        row = conn.execute(
            "SELECT p.raw_json FROM snpedia_pages p "
            "JOIN snpedia_variants v ON v.page_id = p.page_id "
            "WHERE v.rsid = ?",
            (rs,),
        ).fetchone()
        if not row:
            print(f"  WARN: {rs} not in snpedia_pages; skipping")
            continue
        text = json.loads(row["raw_json"])["revisions"][0]["*"]
        raw_pages[rs] = text
        m = _GENE_FIELD_RE.search(text)
        r["gene"] = _normalise_gene(m.group(1) if m else None)
        (out_dir / f"{rs}.md").write_text(text, encoding="utf-8")

    fresh = [r for r in fresh if r["rsid"] in raw_pages]
    if not fresh:
        print("none of the candidates are in snpedia_pages")
        return 0

    genome_id = _ensure_genome_upload_id(conn)
    now = datetime.utcnow().isoformat(timespec="seconds")
    existing = {(row["rs_id"] or "").lower() for row in conn.execute(
        "SELECT DISTINCT rs_id FROM genome_variants WHERE genome_upload_id=?", (genome_id,)
    )}
    inserted = 0
    for r in fresh:
        if r["rsid"] in existing:
            continue
        conn.execute(
            "INSERT INTO genome_variants "
            "(genome_upload_id, rs_id, gene, genotype, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (genome_id, r["rsid"], r["gene"], r["vcf_gt"], now),
        )
        inserted += 1
    conn.commit()
    print(f"[setup] inserted {inserted} new genome_variants rows")

    print("\ngene assignments:")
    for r in fresh:
        mag_str = "—" if r["magnitude"] is None else f"{r['magnitude']:>4}"
        print(f"  {r['rsid']:<12} mag={mag_str} {r['user_genotype']:<6} → {r['gene']}")

    t_start = time.time()
    v_failures, g_failures = asyncio.run(_ingest_batch(
        conn=conn,
        batch=fresh,
        raw_pages=raw_pages,
        concurrency_variants=args.concurrency_variants,
        concurrency_genes=args.concurrency_genes,
        max_attempts=args.max_attempts,
    ))
    total = time.time() - t_start

    try:
        app._rebuild_wiki_index(conn)
        app._render_index_md(conn)
    except Exception as e:
        print(f"  WARN: index rebuild failed: {e}")
    app._append_log(
        f"INGEST top-N start={args.start} n={args.top_n} fresh={len(fresh)} "
        f"v_failed={len(v_failures)} g_failed={len(g_failures)}"
    )
    conn.close()

    print(f"\n=== done in {total:.1f}s ===")
    if v_failures:
        print(f"variant failures ({len(v_failures)}):")
        for f in v_failures:
            print(f"  ✗ {f['rs_id']}: {str(f['error'])[:160]}")
    if g_failures:
        print(f"gene failures ({len(g_failures)}):")
        for f in g_failures:
            print(f"  ✗ {f['gene']}: {str(f['error'])[:160]}")
    return 0 if not (v_failures or g_failures) else 1


if __name__ == "__main__":
    sys.exit(main())
