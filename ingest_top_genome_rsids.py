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

_GENE_FIELD_RE = re.compile(r"\|\s*Gene\s*=\s*([A-Za-z0-9._-]+)", re.IGNORECASE)
_GENO_TITLE_RE = re.compile(r"^Rs(\d+)\(([ACGT]);([ACGT])\)$", re.IGNORECASE)
_GENO_MAG_RE = re.compile(r"\|\s*magnitude\s*=\s*([\d.]+)", re.IGNORECASE)
_GENO_REPUTE_RE = re.compile(r"\|\s*repute\s*=\s*(\w+)", re.IGNORECASE)
_GENO_SUMMARY_RE = re.compile(r"\|\s*summary\s*=\s*([^\n|}]+)", re.IGNORECASE)


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


def _rank(vcf_path: Path, conn: sqlite3.Connection) -> list[dict]:
    geno_lookup = _build_genotype_lookup(conn)
    known_rsids = {r["rsid"].lower() for r in conn.execute("SELECT rsid FROM snpedia_variants")}
    print(
        f"[rank] {len(geno_lookup):,} genotype-magnitude pairs; "
        f"{len(known_rsids):,} rsids in snpedia_variants",
        flush=True,
    )
    print(f"[rank] streaming {vcf_path}…", flush=True)
    user_rows = _stream_user_vcf(vcf_path, known_rsids)
    print(f"[rank] {len(user_rows):,} VCF rows match SNPedia", flush=True)
    ranked: list[dict] = []
    for rsid, a1, a2, gt_raw in user_rows:
        rec = geno_lookup.get((rsid, a1, a2)) or geno_lookup.get((rsid, a2, a1))
        if not rec:
            continue
        ranked.append({
            "rsid": rsid,
            "user_genotype": f"({a1};{a2})",
            "vcf_gt": gt_raw,
            "magnitude": rec["magnitude"],
            "repute": rec["repute"],
            "summary": rec["summary"],
        })
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


async def _retry(
    fn: Callable[[], Awaitable[dict]],
    *,
    label: str,
    max_attempts: int,
) -> dict:
    """Call fn() with auto-retry. Logs each retry and its reason in real
    time. Reraises the final exception if all attempts fail."""
    last_exc: Optional[BaseException] = None
    for attempt in range(1, max_attempts + 1):
        try:
            result = await fn()
            if attempt > 1:
                print(f"  ✓ {label} ok on attempt {attempt}/{max_attempts}", flush=True)
            return result
        except BaseException as exc:
            last_exc = exc
            reason = _classify_retry_reason(exc)
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

    async def variant(r: dict) -> tuple[str, object]:
        async with sem_v:
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
                return rs, await _retry(_do, label=rs, max_attempts=max_attempts)
            except Exception as e:
                return rs, e

    async def gene(g: str, rels: list[str]) -> tuple[str, object]:
        async with sem_g:
            try:
                async def _do() -> dict:
                    return await app._compile_gene_page(gene=g, variant_rels=rels)
                return g, await _retry(_do, label=g, max_attempts=max_attempts)
            except Exception as e:
                return g, e

    async def system(s: str, rels: list[str]) -> tuple[str, object]:
        async with sem_g:
            try:
                async def _do() -> dict:
                    return await app._compile_system_page(system=s, gene_rels=rels)
                return s, await _retry(_do, label=s, max_attempts=max_attempts)
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

    sys_to_gene_rels: dict[str, list[str]] = defaultdict(list)
    for gp in (app.GENOME_WIKI_ROOT / "wiki" / "genes").glob("*.md"):
        sys_key = app._GENE_TO_SYSTEM.get(gp.stem)
        if sys_key:
            sys_to_gene_rels[sys_key].append(f"wiki/genes/{gp.name}")
    existing_systems = {p.stem for p in (app.GENOME_WIKI_ROOT / "wiki" / "systems").glob("*.md")}
    sys_to_compile = {s: rels for s, rels in sys_to_gene_rels.items()
                      if len(rels) >= 2 and s not in existing_systems}

    if sys_to_compile:
        print(f"[systems] {len(sys_to_compile)} systems, concurrency={concurrency_genes}…", flush=True)
        t2 = time.time()
        s_results = await asyncio.gather(*(system(s, r) for s, r in sys_to_compile.items()))
        s_elapsed = time.time() - t2
        s_ok = 0
        for s, res in s_results:
            if isinstance(res, Exception) or (isinstance(res, dict) and res.get("errors")):
                msg = res.get("errors") if isinstance(res, dict) else str(res)
                print(f"    ✗ {s}: {msg}")
            else:
                s_ok += 1
                print(f"    ✓ {s} → {res['path']}")
        print(f"  systems: {s_elapsed:.1f}s — {s_ok}/{len(sys_to_compile)} ok")
    else:
        print("[systems] no new systems with ≥2 genes; skipped")

    return v_failures, g_failures


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
    args = parser.parse_args(argv)

    conn = sqlite3.connect(str(app.DB_PATH))
    conn.row_factory = sqlite3.Row

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
        r["gene"] = m.group(1).strip() if m else "UNK"
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
