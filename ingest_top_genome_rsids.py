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

VCF source: by default the latest entry in `genome_uploads` (its file
under VITALSCOPE_UPLOADS). Override with --vcf. On first run the VCF is
streamed into `genome_upload_vcf_rows` and rsids are derived into
`genome_upload_rsids`; subsequent runs reuse those rows directly.

Rank cache: lives in `genome_upload_ranked_variants` keyed by
genome_upload_id. Pass --rebuild-rank after adding new SNPedia data or
re-running against a refreshed VCF.

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
import gzip
import io
import json
import random
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable, Optional

import backend.app as app

DEFAULT_HG38_POSITIONS_CACHE = app.GENOME_WIKI_ROOT / "rsid_positions_hg38.tsv"
DEFAULT_HG19_POSITIONS_CACHE = app.GENOME_WIKI_ROOT / "rsid_positions_hg19.tsv"
DEFAULT_GENE_INTERVALS_CACHE = app.GENOME_WIKI_ROOT / "snpedia_gene_intervals_hg38.tsv"
DEFAULT_DBSNP_GENE_LOOKUP   = app.GENOME_WIKI_ROOT / "dbsnp_gene_lookup.tsv"
DEFAULT_ENSEMBL_GENE_CACHE  = app.GENOME_WIKI_ROOT / "ensembl_gene_at_position_hg38.tsv"

# Gene-interval resolver knobs. Padding accounts for regulatory regions just
# outside the curated CDS extents; nearest-gene radius is the max distance
# we'll claim a "near this gene" attribution for an intergenic position.
_GENE_INTERVAL_PAD_BP = 5_000
_GENE_INTERVAL_PAD_BP_SINGLETON = 10_000  # genes with only one SNPedia variant
_GENE_NEAREST_RADIUS_BP = 50_000

# Ensembl REST is rate-limited to 15 req/s; we throttle to 10 req/s with a
# small safety margin and 30s timeout per request.
_ENSEMBL_MIN_INTERVAL_S = 0.10
_ENSEMBL_TIMEOUT_S = 30
_ENSEMBL_BASE = "https://rest.ensembl.org"

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
        try:
            text = json.loads(row["raw_json"])["revisions"][0]["*"]
        except Exception:
            continue
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


# Magic bytes used when the file extension doesn't carry the gzip hint
# (e.g. someone hands us a `.vcf` that's actually gzipped, or a `.gz` whose
# extension was stripped). Sniff once and let the open helpers branch.
_GZIP_MAGIC = b"\x1f\x8b"


def _is_gzipped(path: Path) -> bool:
    """Return True if `path` is gzip-compressed regardless of extension.

    Trusts file content over extension — covers `.vcf.gz`, `.vcf.bgz`
    (BGZF, gzip-compatible), and the corner case of a `.vcf` that's
    actually gzipped because someone renamed it.
    """
    if path.suffix in {".gz", ".bgz"} or str(path).endswith(".vcf.gz"):
        return True
    try:
        with path.open("rb") as fh:
            return fh.read(2) == _GZIP_MAGIC
    except OSError:
        return False


def _open_vcf_read(path: Path) -> io.TextIOBase:
    """Open a VCF for text-mode reading, transparent gzip support.

    Used by every VCF-streaming code path so the script accepts `.vcf`,
    `.vcf.gz`, and `.vcf.bgz` interchangeably without per-caller branching.
    """
    if _is_gzipped(path):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def _open_vcf_write(path: Path) -> io.TextIOBase:
    """Open a VCF for text-mode writing, transparent gzip output by extension.

    `.vcf.gz` / `.gz` / `.bgz` outputs are written through gzip; everything
    else is plain text. Mirror of _open_vcf_read so a round-trip
    (read → annotate → write) preserves the user's compression choice.
    """
    if path.suffix in {".gz", ".bgz"} or str(path).endswith(".vcf.gz"):
        return gzip.open(path, "wt", encoding="utf-8")
    return path.open("w", encoding="utf-8")


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
    with _open_vcf_read(vcf_path) as fh:
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


_VCF_BULK_CHUNK = 5000
_VCF_PROGRESS_EVERY = 100_000


def _vcf_row_count(conn: sqlite3.Connection, genome_upload_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM genome_upload_vcf_rows WHERE genome_upload_id = ?",
        (genome_upload_id,),
    ).fetchone()
    return int(row[0]) if row else 0


def _rsid_row_count(conn: sqlite3.Connection, genome_upload_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM genome_upload_rsids WHERE genome_upload_id = ?",
        (genome_upload_id,),
    ).fetchone()
    return int(row[0]) if row else 0


def _bulk_load_vcf_rows(
    conn: sqlite3.Connection,
    genome_upload_id: int,
    vcf_path: Path,
) -> int:
    """Stream the VCF and load every data line into genome_upload_vcf_rows.

    Idempotent: drops prior rows (and cascades into genome_upload_rsids) before
    inserting. Emits a progress line every _VCF_PROGRESS_EVERY rows so the
    `[setup]` stage in the ingest-jobs modal doesn't look stalled.
    """
    conn.execute(
        "DELETE FROM genome_upload_rsids WHERE genome_upload_id = ?",
        (genome_upload_id,),
    )
    conn.execute(
        "DELETE FROM genome_upload_vcf_rows WHERE genome_upload_id = ?",
        (genome_upload_id,),
    )
    conn.commit()

    sql = (
        "INSERT INTO genome_upload_vcf_rows "
        "(genome_upload_id, line_no, chrom, pos, raw_id, ref, alt, "
        " qual, filter, info, format, sample) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )

    chunk: list[tuple] = []
    line_no = 0
    with _open_vcf_read(vcf_path) as fh:
        for raw in fh:
            if raw.startswith("#"):
                continue
            parts = raw.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            line_no += 1
            try:
                pos = int(parts[1])
            except ValueError:
                continue
            chrom = parts[0]
            raw_id = parts[2] if len(parts) > 2 else "."
            ref = parts[3] if len(parts) > 3 else ""
            alt = parts[4] if len(parts) > 4 else ""
            qual = parts[5] if len(parts) > 5 else None
            filt = parts[6] if len(parts) > 6 else None
            info = parts[7] if len(parts) > 7 else None
            fmt = parts[8] if len(parts) > 8 else None
            sample = parts[9] if len(parts) > 9 else None
            chunk.append((
                genome_upload_id, line_no, chrom, pos, raw_id, ref, alt,
                qual, filt, info, fmt, sample,
            ))
            if len(chunk) >= _VCF_BULK_CHUNK:
                conn.executemany(sql, chunk)
                chunk.clear()
            if line_no % _VCF_PROGRESS_EVERY == 0:
                print(f"[setup] loaded {line_no:,} VCF rows…", flush=True)
    if chunk:
        conn.executemany(sql, chunk)
    conn.commit()
    return line_no


def _extract_rsids_from_vcf_rows(
    conn: sqlite3.Connection,
    genome_upload_id: int,
    known_rsids: set[str],
) -> int:
    """Derive `genome_upload_rsids` rows from `genome_upload_vcf_rows`.

    Applies the existing filter rules from the old in-memory VCF stream:
      - FILTER must be PASS or "."
      - FORMAT must contain a GT field
      - the resolved allele pair must be single-base A/C/G/T
      - the resolved rsid must be in `known_rsids` (SNPedia-known)

    Compound IDs (`rs1;rs2`) are split — each rsid becomes its own row pointing
    back at the same VCF line_no, with resolution_source='multi_allele_split'.
    Single rsid IDs use resolution_source='id_column'.
    Position-based fill-in for "." IDs happens later via
    `_annotate_rsids_by_position`.
    """
    cur = conn.execute(
        "SELECT line_no, raw_id, ref, alt, filter, format, sample "
        "FROM genome_upload_vcf_rows WHERE genome_upload_id = ?",
        (genome_upload_id,),
    )
    rows_to_insert: list[tuple] = []
    for row in cur:
        line_no = row["line_no"] if isinstance(row, sqlite3.Row) else row[0]
        raw_id = row["raw_id"] if isinstance(row, sqlite3.Row) else row[1]
        ref = (row["ref"] if isinstance(row, sqlite3.Row) else row[2]) or ""
        alt = (row["alt"] if isinstance(row, sqlite3.Row) else row[3]) or ""
        filt = row["filter"] if isinstance(row, sqlite3.Row) else row[4]
        fmt = row["format"] if isinstance(row, sqlite3.Row) else row[5]
        sample = row["sample"] if isinstance(row, sqlite3.Row) else row[6]
        if filt not in (None, "", "PASS", "."):
            continue
        if not fmt or not sample:
            continue
        fmt_fields = fmt.split(":")
        sample_fields = sample.split(":")
        try:
            gt_idx = fmt_fields.index("GT")
        except ValueError:
            continue
        if gt_idx >= len(sample_fields):
            continue
        gt_raw = sample_fields[gt_idx].replace("|", "/")
        if "." in gt_raw:
            continue
        try:
            a_idx, b_idx = (int(x) for x in gt_raw.split("/"))
        except ValueError:
            continue
        ref_u = ref.upper()
        alts = [a.upper() for a in alt.split(",")]

        def _resolve(i: int) -> Optional[str]:
            if i == 0:
                return ref_u
            if 1 <= i <= len(alts):
                return alts[i - 1]
            return None

        a1, a2 = _resolve(a_idx), _resolve(b_idx)
        if not a1 or not a2 or len(a1) != 1 or len(a2) != 1 or a1 not in "ACGT" or a2 not in "ACGT":
            continue
        candidates = [c.strip() for c in (raw_id or "").split(";") if c.strip()]
        rs_candidates = [c.lower() for c in candidates if c.lower().startswith("rs")]
        if not rs_candidates:
            continue
        source = "id_column" if len(rs_candidates) == 1 else "multi_allele_split"
        for rsid_lc in rs_candidates:
            if rsid_lc not in known_rsids:
                continue
            rows_to_insert.append((
                genome_upload_id, rsid_lc, line_no, a1, a2, gt_raw, source,
            ))
    if rows_to_insert:
        conn.executemany(
            "INSERT OR REPLACE INTO genome_upload_rsids "
            "(genome_upload_id, rs_id, vcf_row_line_no, allele1, allele2, vcf_gt, resolution_source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows_to_insert,
        )
        conn.commit()
    return len(rows_to_insert)


def _annotate_rsids_by_position(
    conn: sqlite3.Connection,
    genome_upload_id: int,
    position_to_rsid: dict[tuple[str, int], str],
    known_rsids: set[str],
) -> int:
    """Fill in `genome_upload_rsids` rows for VCF lines whose ID column was '.'.

    Only walks VCF rows that yielded zero rsid rows during
    `_extract_rsids_from_vcf_rows` (i.e. raw_id was empty / '.' / non-rs).
    For each (chrom, pos) that SNPedia knows, inserts one row with
    resolution_source='position_lookup'. One VCF line can produce multiple
    rsid rows here when the position lookup is ambiguous — the back-pointer
    via vcf_row_line_no keeps the relationship explicit.
    """
    if not position_to_rsid:
        return 0
    rows_to_insert: list[tuple] = []
    cur = conn.execute(
        "SELECT v.line_no, v.chrom, v.pos, v.ref, v.alt, v.format, v.sample "
        "FROM genome_upload_vcf_rows v "
        "WHERE v.genome_upload_id = ? AND NOT EXISTS ("
        "    SELECT 1 FROM genome_upload_rsids r "
        "    WHERE r.genome_upload_id = v.genome_upload_id "
        "      AND r.vcf_row_line_no = v.line_no"
        ")",
        (genome_upload_id,),
    )
    for row in cur:
        line_no = row["line_no"]
        chrom = (row["chrom"] or "").removeprefix("chr").upper()
        pos = row["pos"]
        rsid = position_to_rsid.get((chrom, pos))
        if not rsid:
            continue
        rsid_lc = rsid.lower()
        if rsid_lc not in known_rsids:
            continue
        ref = (row["ref"] or "").upper()
        alts = [a.upper() for a in (row["alt"] or "").split(",")]
        fmt = row["format"] or ""
        sample = row["sample"] or ""
        fmt_fields = fmt.split(":")
        sample_fields = sample.split(":")
        try:
            gt_idx = fmt_fields.index("GT")
        except ValueError:
            continue
        if gt_idx >= len(sample_fields):
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
        rows_to_insert.append((
            genome_upload_id, rsid_lc, line_no, a1, a2, gt_raw, "position_lookup",
        ))
    if rows_to_insert:
        conn.executemany(
            "INSERT OR REPLACE INTO genome_upload_rsids "
            "(genome_upload_id, rs_id, vcf_row_line_no, allele1, allele2, vcf_gt, resolution_source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows_to_insert,
        )
        conn.commit()
    return len(rows_to_insert)


def _iter_db_rsids(
    conn: sqlite3.Connection, genome_upload_id: int,
) -> list[tuple[str, str, str, str]]:
    rows = conn.execute(
        "SELECT rs_id, allele1, allele2, vcf_gt FROM genome_upload_rsids "
        "WHERE genome_upload_id = ? ORDER BY rs_id",
        (genome_upload_id,),
    ).fetchall()
    return [(r["rs_id"], r["allele1"], r["allele2"], r["vcf_gt"]) for r in rows]


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
    with _open_vcf_read(in_path) as fin, _open_vcf_write(out_path) as fout:
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


_RSNUM_SUMMARY_RE = re.compile(r"\|\s*Summary\s*=\s*([^\n|}]+)", re.IGNORECASE)


_RSNUM_GENE_RE = re.compile(r"\|\s*Gene\s*=\s*([A-Za-z0-9._-]+)", re.IGNORECASE)

# Content-signal regexes for the variant-page fallback gate. The previous
# 2000-char body cutoff dropped ~17k pages with real PMID/ClinVar/prose
# content because PMID Auto templates are dense (small wikitext, large
# rendered footprint). Audit (audit_ingest_gates.py) showed ~94% of those
# drops were false negatives — e.g. rs616338 ABI3 Alzheimer's OR=1.43
# P=4.56e-10 in 483 chars of wikitext.
#
# PMID detection covers three styles seen in the SNPedia mirror:
#   {{PMID|12345}}, {{PMID Auto |PMID=12345 ...}}, and bare "PMID: 12345"
#   in older pages (rs10766071's circadian-disorder citation block).
_PMID_RE    = re.compile(r"\{\{PMID(\s*Auto)?\b|\bPMID\s*:?\s*\d{4,}", re.IGNORECASE)
_CLINVAR_RE = re.compile(r"\{\{ClinVar\b", re.IGNORECASE)
# Narrative line: starts with any wikilink ([[rs...]] or [[Gene]] or
# [[condition]]), or italicised text, or a sentence-cased letter, or a
# raw URL (rs984924 cites a biorxiv URL outside any template).
_PROSE_RE   = re.compile(
    r"^\s*(\[\[[A-Za-z]|''?[A-Z]|https?://)", re.MULTILINE)


def _build_variant_page_summary_lookup(
    conn: sqlite3.Connection,
) -> dict[str, dict]:
    """Map rsid → metadata dict from canonical Rs<N> variant pages.

    Used as a fallback when SNPedia has a variant page for a rsid but no
    per-genotype subpage matches the user's allele combo (common for
    SLC6A4, DRD5, MAOA, and ~half of HLA / immune variants — the
    pharmacology lives on the parent page, not split per allele).

    Eligibility rules — a rsid enters the lookup if EITHER:
      a) the Rsnum infobox has a non-empty `|Summary=` field (always
         passes — the curator wrote a summary), OR
      b) the page has at least one of:
           - `{{PMID...}}` / `{{PMID Auto...}}` template OR plain `PMID: NNNN`
           - `{{ClinVar...}}` block
           - narrative prose line (wikilink, italics, sentence-cased start, URL)
         The `|Gene=` field is no longer required; pages without one get
         `gene=None` here and are resolved by position downstream.

    Returned value is a dict per rsid:
      summary  — short human-readable display string for the rank cache
      gene     — gene symbol from |Gene= (None if missing — defer to
                 position-based resolver)
      chrom    — chromosome string from |Chromosome= (None if missing)
      pos      — int hg38 position from |position= (None if missing)
      signals  — list of which signals matched ("Summary", "PMID", "ClinVar",
                 "prose"); useful for rank-cache provenance
    """
    print("[rank] indexing SNPedia variant pages for fallback summaries…", flush=True)
    out: dict[str, dict] = {}
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

        gene_m = _RSNUM_GENE_RE.search(block)
        chr_m = _RSNUM_CHR_RE.search(block)
        pos_m = _RSNUM_POS_RE.search(block)
        gene = _normalise_gene(gene_m.group(1)) if gene_m else None
        if gene == "UNK":
            gene = None
        chrom = chr_m.group(1).upper() if chr_m else None
        try:
            pos = int(pos_m.group(1)) if pos_m else None
        except ValueError:
            pos = None

        sum_m = _RSNUM_SUMMARY_RE.search(block)
        if sum_m and sum_m.group(1).strip():
            out[rsid] = {
                "summary": sum_m.group(1).strip(),
                "gene": gene, "chrom": chrom, "pos": pos,
                "signals": ["Summary"],
            }
            continue

        signals = []
        if _PMID_RE.search(text):
            signals.append("PMID")
        if _CLINVAR_RE.search(text):
            signals.append("ClinVar")
        if _PROSE_RE.search(text):
            signals.append("prose")
        if not signals:
            continue
        sig_label = "+".join(signals)
        if gene:
            summary = f"(SNPedia variant page for {gene} — {sig_label})"
        else:
            summary = f"(SNPedia variant page; no |Gene= field — signals: {sig_label})"
        out[rsid] = {
            "summary": summary,
            "gene": gene, "chrom": chrom, "pos": pos,
            "signals": signals,
        }
    return out


def _build_gene_intervals_hg38(
    conn: sqlite3.Connection, cache_path: Path,
) -> dict[str, list[tuple[str, int, int]]]:
    """Build per-chromosome gene intervals from SNPedia parent pages.

    Aggregates every Rs<N> page that has `|Gene=` + `|Chromosome=` +
    `|position=` into per-(chrom, gene) extents (min position, max
    position) padded by _GENE_INTERVAL_PAD_BP. Genes with only a single
    SNPedia variant get a wider symmetric pad so the position lookup has
    something to hit. Restricts to hg38 records (matches the rest of the
    SNPedia data in this DB).

    Used downstream by `_resolve_gene_at_position` to fill in the gene
    field for variant pages that have no `|Gene=` infobox entry but do
    have content signal (PMID/ClinVar/prose). Without this, those pages
    would land as `gene=UNK` and miss gene-level synthesis.

    Returned shape: dict[chrom] -> list of (gene, start, end), unsorted.
    Cached as a TSV under the wiki root because indexing all 108K parent
    pages takes ~30s.
    """
    if cache_path.is_file():
        out: dict[str, list[tuple[str, int, int]]] = defaultdict(list)
        with cache_path.open() as fh:
            next(fh)
            for line in fh:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 4:
                    continue
                try:
                    out[parts[0]].append((parts[1], int(parts[2]), int(parts[3])))
                except ValueError:
                    continue
        n = sum(len(v) for v in out.values())
        print(f"[gene-resolver] loaded {n:,} gene intervals from {cache_path}",
              flush=True)
        return out

    print("[gene-resolver] building gene intervals from SNPedia parent pages…",
          flush=True)
    per_gene: dict[tuple[str, str], list[int]] = defaultdict(list)
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
        gene_m = _RSNUM_GENE_RE.search(block)
        chr_m = _RSNUM_CHR_RE.search(block)
        pos_m = _RSNUM_POS_RE.search(block)
        if not (gene_m and chr_m and pos_m):
            continue
        asm_m = _RSNUM_ASM_RE.search(block)
        if asm_m and asm_m.group(1) != "38":
            continue
        gene = _normalise_gene(gene_m.group(1))
        if gene == "UNK":
            continue
        try:
            pos = int(pos_m.group(1))
        except ValueError:
            continue
        per_gene[(chr_m.group(1).upper(), gene)].append(pos)

    intervals_by_chrom: dict[str, list[tuple[str, int, int]]] = defaultdict(list)
    for (chrom, gene), positions in per_gene.items():
        positions.sort()
        if len(positions) == 1:
            pad = _GENE_INTERVAL_PAD_BP_SINGLETON
            start, end = positions[0] - pad, positions[0] + pad
        else:
            start = positions[0] - _GENE_INTERVAL_PAD_BP
            end = positions[-1] + _GENE_INTERVAL_PAD_BP
        intervals_by_chrom[chrom].append((gene, start, end))

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("w") as fh:
        fh.write("chrom\tgene\tstart\tend\n")
        for chrom in sorted(intervals_by_chrom):
            for gene, start, end in sorted(intervals_by_chrom[chrom]):
                fh.write(f"{chrom}\t{gene}\t{start}\t{end}\n")
    n = sum(len(v) for v in intervals_by_chrom.values())
    print(f"[gene-resolver] cached {n:,} gene intervals to {cache_path}",
          flush=True)
    return intervals_by_chrom


def _resolve_gene_at_position(
    chrom: Optional[str], pos: Optional[int],
    intervals_by_chrom: dict[str, list[tuple[str, int, int]]],
) -> Optional[str]:
    """Return the gene whose SNPedia-derived interval best matches (chrom, pos).

    Picks the smallest-span containing interval if any contain the position;
    otherwise the nearest gene within _GENE_NEAREST_RADIUS_BP. Returns None
    when neither succeeds (truly intergenic, no nearby annotated gene).
    """
    if not chrom or pos is None:
        return None
    candidates = intervals_by_chrom.get(chrom)
    if not candidates:
        return None
    contained = [
        (gene, end - start)
        for gene, start, end in candidates
        if start <= pos <= end
    ]
    if contained:
        contained.sort(key=lambda x: x[1])
        return contained[0][0]
    nearby = [
        (gene, min(abs(pos - start), abs(pos - end)))
        for gene, start, end in candidates
        if abs(pos - start) < _GENE_NEAREST_RADIUS_BP
            or abs(pos - end) < _GENE_NEAREST_RADIUS_BP
    ]
    if nearby:
        nearby.sort(key=lambda x: x[1])
        return nearby[0][0]
    return None


def _load_dbsnp_gene_lookup(
    path: Path, relevant_rsids: Optional[set[str]] = None,
) -> dict[str, str]:
    """Stream-load rsid → gene-symbol from build_dbsnp_gene_lookup.py output.

    The full TSV is ~13 GB / 493 M rows; loading all into memory takes 30+ GB.
    Pass `relevant_rsids` (typically the SNPedia variant set, ~115 K rsids) to
    keep memory bounded — only matching rows enter the dict. Returns the
    *first* gene symbol when a variant overlaps multiple genes (the primary
    feature; downstream wiki organisation needs a single gene anchor).

    If `path` is missing returns an empty dict and prints guidance, so the
    resolver silently falls back to the position-interval and Ensembl tiers.
    """
    if not path.is_file():
        print(f"[dbsnp-lookup] {path} not found — run "
              f"build_dbsnp_gene_lookup.py to enable this resolver tier",
              flush=True)
        return {}
    print(f"[dbsnp-lookup] streaming {path} "
          f"(filter set: {len(relevant_rsids) if relevant_rsids else 'none'})",
          flush=True)
    t0 = time.time()
    out: dict[str, str] = {}
    n_rows = 0
    with path.open() as fh:
        next(fh)
        for line in fh:
            n_rows += 1
            parts = line.rstrip("\n").split("\t", 2)
            if len(parts) < 2 or not parts[1]:
                continue
            rsid = parts[0]
            if relevant_rsids is not None and rsid not in relevant_rsids:
                continue
            # Symbol pipe-separation comes from multi-gene GENEINFO; first wins.
            symbols = parts[1].split("|", 1)
            out[rsid] = symbols[0]
    elapsed = time.time() - t0
    print(f"[dbsnp-lookup] {n_rows:,} rows scanned in {elapsed:.1f}s; "
          f"{len(out):,} kept after filter",
          flush=True)
    return out


class _EnsemblGeneResolver:
    """Position-based gene lookup against Ensembl REST `/overlap/region`.

    Used as the LAST fallback in the resolver chain — only called when (a)
    SNPedia has no |Gene= field, (b) the dbSNP lookup misses, and (c) the
    SNPedia-derived position intervals find nothing within 50kb. Caches
    every (chrom, pos) → gene answer to disk so re-runs are free; negative
    answers (no gene at this coordinate) are cached as empty string to
    avoid re-asking.

    Rate-limited to ~10 req/sec (Ensembl's published cap is 15). Disabled
    by passing `enabled=False` (CLI: --no-ensembl-fallback).
    """

    def __init__(self, cache_path: Path, enabled: bool = True) -> None:
        self.cache_path = cache_path
        self.enabled = enabled
        self.cache: dict[tuple[str, int], str] = {}
        self.last_call_t = 0.0
        self.hits = 0
        self.misses = 0
        self.errors = 0
        if cache_path.is_file():
            with cache_path.open() as fh:
                next(fh)
                for line in fh:
                    parts = line.rstrip("\n").split("\t")
                    if len(parts) < 3:
                        continue
                    try:
                        self.cache[(parts[0], int(parts[1]))] = parts[2]
                    except ValueError:
                        continue
            print(f"[ensembl] loaded {len(self.cache):,} cached "
                  f"(chrom, pos) → gene answers from {cache_path}",
                  flush=True)
        elif enabled:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            with cache_path.open("w") as fh:
                fh.write("chrom\tpos\tgene\n")
        if not enabled:
            print("[ensembl] disabled (--no-ensembl-fallback)", flush=True)

    def resolve(self, chrom: Optional[str], pos: Optional[int]) -> Optional[str]:
        if not chrom or pos is None or not self.enabled:
            return None
        key = (chrom, pos)
        if key in self.cache:
            self.hits += 1
            return self.cache[key] or None
        # Throttle
        delta = time.time() - self.last_call_t
        if delta < _ENSEMBL_MIN_INTERVAL_S:
            time.sleep(_ENSEMBL_MIN_INTERVAL_S - delta)
        self.last_call_t = time.time()
        url = (f"{_ENSEMBL_BASE}/overlap/region/human/"
               f"{chrom}:{pos}-{pos}?feature=gene")
        try:
            req = urllib.request.Request(
                url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=_ENSEMBL_TIMEOUT_S) as r:
                data = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError,
                json.JSONDecodeError, TimeoutError) as e:
            self.errors += 1
            return None
        # Prefer protein_coding over lncRNA / pseudogene; smallest-extent
        # gene wins on tie (most specific feature).
        candidates = []
        for g in data:
            name = g.get("external_name") or g.get("gene_id")
            if not name:
                continue
            biotype = g.get("biotype") or ""
            extent = (g.get("end") or 0) - (g.get("start") or 0)
            biotype_rank = 0 if biotype == "protein_coding" else 1
            candidates.append((biotype_rank, extent, name))
        gene = candidates[0][2] if (candidates := sorted(candidates)) else ""
        self.cache[key] = gene
        self.misses += 1
        # Append-only persistence — cheap, survives interruption
        with self.cache_path.open("a") as fh:
            fh.write(f"{chrom}\t{pos}\t{gene}\n")
        return gene or None

    def report(self) -> None:
        if not self.enabled:
            return
        total = self.hits + self.misses
        if not total:
            return
        print(f"[ensembl] {self.hits:,} cache hits, {self.misses:,} new lookups, "
              f"{self.errors:,} errors", flush=True)


def _rank(
    genome_upload_id: int, conn: sqlite3.Connection,
    use_ensembl: bool = True,
) -> list[dict]:
    """Build the ranked candidate list for ingestion.

    Each entry carries a `tier` (1/2/3) so downstream filtering with `--tier`
    can pick how aggressive a run should be:

      tier=1  Genotype subpage hit — gold; fully curated allele-effect page,
              has magnitude. AI compile produces a high-confidence variant
              page. Equivalent to the old "with magnitude" block.
      tier=2  Fallback hit (PMID/ClinVar/prose signal) AND a gene name was
              resolved via one of the four-tier gene resolver chain (see
              below). AI compile produces a gene-anchored page.
      tier=3  Fallback hit, gene unresolvable across all tiers. The page
              writes as a stub via the T3 path — no AI tokens spent —
              and gets `gene=UNK` until upgraded.

    Gene resolution chain (first hit wins):
      1. SNPedia `|Gene=` field on the parent page (curated, fastest)
      2. dbSNP GENEINFO via build_dbsnp_gene_lookup.py output (broadest;
         covers ~95% of dbSNP-known variants)
      3. SNPedia-derived gene intervals at hg38 position (covers gaps in
         dbSNP for SNPedia-curated genes)
      4. Ensembl REST `/overlap/region` at hg38 position (final fallback;
         covers anything Ensembl knows). Cached on disk.
    """
    geno_lookup = _build_genotype_lookup(conn)
    variant_page_summaries = _build_variant_page_summary_lookup(conn)
    gene_intervals = _build_gene_intervals_hg38(conn, DEFAULT_GENE_INTERVALS_CACHE)
    known_rsids = {r["rsid"].lower() for r in conn.execute("SELECT rsid FROM snpedia_variants")}
    dbsnp_gene = _load_dbsnp_gene_lookup(DEFAULT_DBSNP_GENE_LOOKUP,
                                         relevant_rsids=known_rsids)
    ensembl = _EnsemblGeneResolver(DEFAULT_ENSEMBL_GENE_CACHE, enabled=use_ensembl)
    print(
        f"[rank] {len(geno_lookup):,} genotype-magnitude pairs; "
        f"{len(variant_page_summaries):,} variant-page summaries; "
        f"{len(known_rsids):,} rsids in snpedia_variants",
        flush=True,
    )
    user_rows = _iter_db_rsids(conn, genome_upload_id)
    print(f"[rank] {len(user_rows):,} rsids from genome_upload_rsids", flush=True)
    ranked: list[dict] = []
    tier_counts: Counter[int] = Counter()
    gene_source_counts: Counter[str] = Counter()
    for rsid, a1, a2, gt_raw in user_rows:
        rec = geno_lookup.get((rsid, a1, a2)) or geno_lookup.get((rsid, a2, a1))
        if rec is not None:
            ranked.append({
                "rsid": rsid,
                "user_genotype": f"({a1};{a2})",
                "vcf_gt": gt_raw,
                "magnitude": rec["magnitude"],
                "repute": rec["repute"],
                "summary": rec["summary"],
                "tier": 1,
                "gene": None,  # gene comes from the parent page at compile time
            })
            tier_counts[1] += 1
            continue
        meta = variant_page_summaries.get(rsid)
        if meta is None:
            continue
        gene = meta["gene"]
        gene_source = "snpedia_field" if gene else None
        if not gene:
            gene = dbsnp_gene.get(rsid)
            if gene:
                gene_source = "dbsnp"
        if not gene:
            gene = _resolve_gene_at_position(meta["chrom"], meta["pos"], gene_intervals)
            if gene:
                gene_source = "snpedia_position"
        if not gene:
            gene = ensembl.resolve(meta["chrom"], meta["pos"])
            if gene:
                gene_source = "ensembl"
        if gene_source:
            gene_source_counts[gene_source] += 1
        tier = 2 if gene else 3
        ranked.append({
            "rsid": rsid,
            "user_genotype": f"({a1};{a2})",
            "vcf_gt": gt_raw,
            "magnitude": None,
            "repute": "",
            "summary": meta["summary"],
            "tier": tier,
            "gene": gene,
        })
        tier_counts[tier] += 1
    ensembl.report()
    if gene_source_counts:
        print(f"[rank] gene resolution sources: "
              f"{dict(gene_source_counts.most_common())}",
              flush=True)
    print(
        f"[rank] {len(ranked):,} ranked entries "
        f"(T1={tier_counts[1]:,} from genotype subpages, "
        f"T2={tier_counts[2]:,} from fallback with resolvable gene, "
        f"T3={tier_counts[3]:,} from fallback with no gene)",
        flush=True,
    )
    gene_updates = [(r["gene"], genome_upload_id, r["rsid"]) for r in ranked if r["gene"]]
    if gene_updates:
        conn.executemany(
            "UPDATE genome_upload_rsids SET gene = ? "
            "WHERE genome_upload_id = ? AND rs_id = ?",
            gene_updates,
        )
        conn.commit()
    # Three-phase ordering: T1 first (descending magnitude), then T2/T3 by
    # rsid. `tier` is the primary key so a `--tier 1,2` filter slice always
    # consumes T1+T2 together before any T3 enters the candidate set.
    ranked.sort(key=lambda r: (
        r.get("tier", 1),
        r["magnitude"] is None,
        -(r["magnitude"] or 0.0),
        r["rsid"],
    ))
    return ranked


def _write_rank_cache(
    conn: sqlite3.Connection, genome_upload_id: int, ranked: list[dict],
) -> None:
    """Persist `ranked` into `genome_upload_ranked_variants`, preserving
    sort order via `rank_order`. Idempotent — deletes prior rows for this
    upload first.
    """
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn.execute(
        "DELETE FROM genome_upload_ranked_variants WHERE genome_upload_id = ?",
        (genome_upload_id,),
    )
    rows = []
    for idx, r in enumerate(ranked, 1):
        summary = (r.get("summary") or "").replace("\t", " ").replace("\n", " ")[:200]
        rows.append((
            genome_upload_id,
            r["rsid"],
            r["user_genotype"],
            r["vcf_gt"],
            r["magnitude"],
            r.get("repute") or "",
            summary,
            int(r.get("tier", 1)),
            r.get("gene"),
            idx,
            now,
        ))
    if rows:
        conn.executemany(
            "INSERT OR REPLACE INTO genome_upload_ranked_variants "
            "(genome_upload_id, rs_id, user_genotype, vcf_gt, magnitude, repute, summary, "
            " tier, gene, rank_order, computed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
    conn.commit()


def _read_rank_cache(
    conn: sqlite3.Connection, genome_upload_id: int,
) -> list[dict]:
    cur = conn.execute(
        "SELECT rs_id, user_genotype, vcf_gt, magnitude, repute, summary, tier, gene "
        "FROM genome_upload_ranked_variants WHERE genome_upload_id = ? "
        "ORDER BY rank_order ASC",
        (genome_upload_id,),
    )
    return [
        {
            "rsid": row["rs_id"],
            "user_genotype": row["user_genotype"],
            "vcf_gt": row["vcf_gt"],
            "magnitude": row["magnitude"],
            "repute": row["repute"] or "",
            "summary": row["summary"] or "",
            "tier": int(row["tier"]),
            "gene": row["gene"],
        }
        for row in cur
    ]


def _ranked_count(conn: sqlite3.Connection, genome_upload_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM genome_upload_ranked_variants WHERE genome_upload_id = ?",
        (genome_upload_id,),
    ).fetchone()
    return int(row[0]) if row else 0


def _write_t3_stub(r: dict) -> Path:
    """Write a no-AI variant page for a tier-3 candidate.

    T3 entries have a SNPedia content signal (PMID/ClinVar/prose) but no
    resolvable gene name, so AI-compiling them would produce a `gene=UNK`
    page with no anchor. Instead we stamp a stub recording the user's
    genotype + the SNPedia summary + a pointer to dbSNP/ClinVar so the
    variant is visible in the wiki and can be re-processed once a gene
    is resolved (e.g. by extending GENE_REGIONS_HG19 in
    expand_gene_coverage.py or running --rebuild-rank after a SNPedia
    refresh).

    Returns the written path.
    """
    rsid = r["rsid"]
    out_dir = app.GENOME_WIKI_ROOT / "wiki" / "variants"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{rsid}_UNK.md"
    today = datetime.utcnow().date().isoformat()
    summary = r.get("summary", "").replace("\n", " ").strip()
    body = f"""---
type: variant
rsid: {rsid}
gene: UNK
my_genotype: {r['vcf_gt']}
my_zygosity: ''
snpedia_magnitude: null
evidence_strength: low
title: {rsid} (gene unresolved) — tier-3 stub
summary: {summary or 'SNPedia content signal present but no gene resolvable.'}
source_paths:
- sources/snpedia/{rsid}
related: []
last_reviewed: '{today}'
informational_only: true
provenance: tier-3-stub
---

## What it is

`{rsid}` has a SNPedia parent page with a content signal
({summary or 'PMID/ClinVar/prose detected'}) but no `|Gene=` field in the
infobox, and the SNPedia-derived gene-interval index found no annotated
gene within {_GENE_NEAREST_RADIUS_BP // 1000}kb. The variant is therefore
ingested as a tier-3 stub — visible in the wiki but not AI-compiled until a
gene anchor is established.

For curated annotation, look it up in
[dbSNP](https://www.ncbi.nlm.nih.gov/snp/{rsid}),
[ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/?term={rsid}), or
[Ensembl](https://www.ensembl.org/Homo_sapiens/Variation/Explore?v={rsid}).

## Your data

| Field | Value |
| :--- | :--- |
| User genotype (VCF) | **{r['vcf_gt']}** |
| User allele pair | {r['user_genotype']} |
| SNPedia summary | {summary or '—'} |

## What it means

Insufficient curated context in this wiki to interpret `{rsid}` on its own.
The dbSNP/ClinVar/Ensembl links above carry the live annotation; once a
gene is associated (manually, or by extending the position-based resolver
in `ingest_top_genome_rsids.py`), this stub can be upgraded to a full
variant page by re-running with `--force --tier 1,2,3`.

## What we don't know

The gene-anchor is the missing piece. The variant likely sits in an
intergenic / regulatory region not covered by SNPedia's per-variant gene
annotations. No clinical interpretation is rendered here to avoid
confabulating an effect from the SNPedia summary alone.

---
*This page is informational only and is not medical advice.*
"""
    path.write_text(body, encoding="utf-8")
    return path


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
                v = {
                    "rs_id": rs,
                    "gene": r["gene"],
                    "genotype": r["vcf_gt"],
                    "user_genotype_snpedia": r["user_genotype"],
                }
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
    parser.add_argument("--tier", default="1,2",
                        help="comma-separated tier filter applied BEFORE --start/--top-n. "
                             "1=Summary or genotype subpage hit (gold), "
                             "2=fallback signal+resolved gene (good), "
                             "3=fallback signal but no gene resolvable (writes a "
                             "stub instead of AI-compiling). "
                             "Default '1,2' — pass '1,2,3' to also stub-write the "
                             "no-gene long tail.")
    parser.add_argument("--vcf", type=Path, default=None,
                        help="VCF path; defaults to the latest genome_upload. "
                             "Only used on first run to bulk-load rows into "
                             "genome_upload_vcf_rows; subsequent runs reuse the db.")
    parser.add_argument("--rebuild-rank", action="store_true",
                        help="recompute the rank cache in the DB even if rows exist")
    parser.add_argument("--no-ensembl-fallback", action="store_true",
                        help="disable the final Ensembl REST gene-resolver tier "
                             "(useful for offline runs; cached answers in "
                             f"{DEFAULT_ENSEMBL_GENE_CACHE.name} are still used)")
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
    args = parser.parse_args(argv)

    selected_modes = sum(1 for x in (args.ask, args.report, args.systems_only) if x)
    if selected_modes > 1:
        parser.error("--ask / --report / --systems-only are mutually exclusive")

    if args.model:
        app.AI_MODEL = args.model
        app._ai_provider = None
    print(f"[setup] AI provider={app.AI_PROVIDER} model={app.AI_MODEL}", flush=True)

    conn = sqlite3.connect(str(app.DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    # busy_timeout: wait up to 30s for a writer lock instead of raising
    # "database is locked" instantly when uvicorn is concurrently
    # writing (e.g. the genome wiki ingest job-event flush loop).
    conn.execute("PRAGMA busy_timeout = 30000")

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
    genome_upload_id = _ensure_genome_upload_id(conn)
    print(f"[setup] VCF: {vcf_path} (genome_upload_id={genome_upload_id})", flush=True)

    known_rsids = {r["rsid"].lower() for r in conn.execute("SELECT rsid FROM snpedia_variants")}

    existing_vcf_rows = _vcf_row_count(conn, genome_upload_id)
    rebuild_setup = args.rebuild_rank or existing_vcf_rows == 0
    if rebuild_setup:
        n_loaded = _bulk_load_vcf_rows(conn, genome_upload_id, vcf_path)
        print(f"[setup] loaded {n_loaded:,} VCF rows into db", flush=True)
        n_rsids = _extract_rsids_from_vcf_rows(conn, genome_upload_id, known_rsids)
        print(f"[setup] derived {n_rsids:,} rsids from VCF rows (id_column / multi_allele_split)", flush=True)
        hg38 = _build_hg38_position_lookup(conn, DEFAULT_HG38_POSITIONS_CACHE)
        hg19 = _build_hg19_position_lookup(hg38, DEFAULT_HG19_POSITIONS_CACHE)
        build = _detect_vcf_build(vcf_path, hg38, hg19)
        print(f"[positions] detected VCF build: {build}", flush=True)
        if build == "hg38":
            position_lookup = hg38
        elif build == "hg19":
            position_lookup = hg19
        else:
            print("[positions] build undetected — skipping position-fill annotation", flush=True)
            position_lookup = {}
        if position_lookup:
            n_pos = _annotate_rsids_by_position(conn, genome_upload_id, position_lookup, known_rsids)
            print(f"[setup] added {n_pos:,} rsids via position_lookup", flush=True)
    else:
        existing_rsids = _rsid_row_count(conn, genome_upload_id)
        print(
            f"[setup] reusing {existing_vcf_rows:,} VCF rows / "
            f"{existing_rsids:,} rsids from db",
            flush=True,
        )

    if args.rebuild_rank or _ranked_count(conn, genome_upload_id) == 0:
        ranked = _rank(genome_upload_id, conn,
                       use_ensembl=not args.no_ensembl_fallback)
        _write_rank_cache(conn, genome_upload_id, ranked)
        print(f"[rank] wrote {len(ranked):,} ranked rows to db")
    else:
        ranked = _read_rank_cache(conn, genome_upload_id)
        print(f"[rank] loaded from db ({len(ranked):,} rows)")

    try:
        allowed_tiers = {int(t.strip()) for t in args.tier.split(",") if t.strip()}
    except ValueError:
        parser.error(f"--tier must be comma-separated integers, got {args.tier!r}")
    if not allowed_tiers <= {1, 2, 3}:
        parser.error(f"--tier values must be in {{1,2,3}}, got {sorted(allowed_tiers)}")

    tier_filtered = [r for r in ranked if r.get("tier", 1) in allowed_tiers]
    print(
        f"[tier] filtered {len(ranked):,} → {len(tier_filtered):,} "
        f"(allowed tiers={sorted(allowed_tiers)}; "
        f"by-tier: {dict(Counter(r.get('tier', 1) for r in ranked))})",
        flush=True,
    )

    candidates = tier_filtered[args.start: args.start + args.top_n]
    if not candidates:
        print("no rsids in selected range")
        return 0

    n_with_mag = sum(1 for r in candidates if r["magnitude"] is not None)
    n_no_mag = len(candidates) - n_with_mag
    skip = set() if args.force else _existing_variant_rsids()
    fresh = [r for r in candidates if r["rsid"] not in skip]
    n_t3 = sum(1 for r in fresh if r.get("tier") == 3)
    n_ai = len(fresh) - n_t3
    print(
        f"\n[batch] selected {len(candidates)} (start={args.start}); "
        f"{n_with_mag} with magnitude / {n_no_mag} without; "
        f"{len(candidates) - len(fresh)} already on disk, "
        f"{n_ai} to AI-compile (T1+T2), {n_t3} to stub-write (T3)"
    )
    if not fresh:
        print("nothing to do")
        return 0

    # Tier-3 fork: stub-write outside the AI pipeline. T3 entries don't have
    # a resolvable gene anchor, so AI-compiling them produces gene=UNK pages
    # that bloat the wiki without adding interpretation. Stub them directly
    # from VCF + SNPedia summary; users can re-process with --force --tier 3
    # later if a gene is established.
    t3_fresh = [r for r in fresh if r.get("tier") == 3]
    fresh = [r for r in fresh if r.get("tier") != 3]
    t3_written: list[Path] = []
    for r in t3_fresh:
        try:
            t3_written.append(_write_t3_stub(r))
        except OSError as e:
            print(f"  ✗ T3 stub write failed for {r['rsid']}: {e}")
    if t3_written:
        print(f"[T3] wrote {len(t3_written)} stub(s) to wiki/variants/*_UNK.md")
    if not fresh:
        print("nothing to AI-compile (T3-only batch)")
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
        try:
            text = json.loads(row["raw_json"])["revisions"][0]["*"]
        except Exception:
            print(f"  WARN: {rs} raw_json missing revisions; skipping")
            continue
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
