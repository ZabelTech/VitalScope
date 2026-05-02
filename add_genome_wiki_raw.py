#!/usr/bin/env python3
"""Add raw inputs to the genome wiki manually, without going through the UI.

Stages SNPedia `.md` pages into `<GENOME_WIKI_ROOT>/raw/snpedia/<rsid>.md`.
With `--ingest`, also bundles them into a zip and runs the same AI compile
pipeline as `POST /api/genome-wiki/ingest`.

Usage:
  python3 add_genome_wiki_raw.py path/to/snpedia-pages/
  python3 add_genome_wiki_raw.py path/to/rs1801133.md --rs-id rs1801133
  python3 add_genome_wiki_raw.py path/to/dir/ --ingest
  python3 add_genome_wiki_raw.py path/to/dir/ --ingest --limit 50

The RS ID for each file is inferred from its filename, then from the first
~200 chars of its body. Files where no RS ID can be inferred are skipped
with a warning. `--rs-id` overrides detection (single-file input only).

Existing pages with the same RS ID are overwritten — re-running with a
fresher snapshot is the supported refresh path.

Environment:
  VITALSCOPE_DB           SQLite DB path (default: <repo>/vitalscope.db)
  VITALSCOPE_GENOME_WIKI  Wiki root         (default: <db_dir>/genome_wiki)
  VITALSCOPE_UPLOADS      Uploads dir       (default: <db_dir>/uploads)
  VITALSCOPE_DEMO=1       Use the demo AI provider for --ingest
"""

import argparse
import asyncio
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path

# Importing backend.app has the side effect of opening the DB and creating
# tables — needed before we can insert an uploads row for --ingest.
import backend.app as app

_RS = re.compile(r"rs\d+", re.IGNORECASE)
_ACCEPTED_EXT = {".md", ".txt", ".wiki"}


def _infer_rs_id(path: Path, override: str | None) -> str | None:
    if override:
        return override.lower()
    m = _RS.search(path.name)
    if m:
        return m.group(0).lower()
    try:
        head = path.read_text(encoding="utf-8", errors="replace")[:200]
    except Exception:
        return None
    m = _RS.search(head)
    return m.group(0).lower() if m else None


def _collect(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    if target.is_dir():
        return sorted(
            p for p in target.rglob("*")
            if p.is_file() and p.suffix.lower() in _ACCEPTED_EXT
        )
    raise SystemExit(f"not a file or directory: {target}")


def _stage(pages: list[Path], rs_override: str | None, dry_run: bool):
    raw_dir = app.GENOME_WIKI_ROOT / "raw" / "snpedia"
    raw_dir.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, Path]] = []   # (rs_id, dst)
    skipped: list[tuple[Path, str]] = []
    for src in pages:
        rs = _infer_rs_id(src, rs_override)
        if not rs:
            skipped.append((src, "no RS ID found in filename or body"))
            continue
        dst = raw_dir / f"{rs}.md"
        if dry_run:
            print(f"[dry-run] would write {dst}")
        else:
            shutil.copyfile(src, dst)
        written.append((rs, dst))
    return written, skipped


async def _run_ingest(staged: list[tuple[str, Path]], limit: int | None) -> dict:
    """Bundle the just-staged files into a zip, create an uploads row, and
    invoke the same ingest endpoint the UI uses. This routes through the
    full validator pipeline rather than reimplementing it.
    """
    if not staged:
        return {"considered": 0, "written": 0, "skipped_for_cap": 0,
                "skipped_rs_ids": [], "errors": [], "written_paths": []}

    today = date.today().isoformat()
    year, month = today[:4], today[5:7]
    target_dir = app.UPLOADS_DIR / year / month
    target_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}.zip"
    zip_path = target_dir / fname
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for rs, p in staged:
            z.write(p, arcname=f"{rs}.md")

    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = sqlite3.connect(str(app.DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.execute(
        "INSERT INTO uploads (kind, date, filename, mime, bytes, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("snpedia", today, f"{year}/{month}/{fname}", "application/zip",
         zip_path.stat().st_size, now),
    )
    upload_id = cur.lastrowid
    conn.commit()
    conn.close()

    body = app.GenomeWikiIngestIn(snpedia_upload_id=upload_id, limit=limit)
    return await app.ingest_genome_wiki(body)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__.split("\n\n", 1)[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("path", help="file or directory of raw SNPedia pages")
    p.add_argument("--rs-id", default=None,
                   help="override RS ID detection (single-file input only)")
    p.add_argument("--ingest", action="store_true",
                   help="run the AI compile pipeline after staging")
    p.add_argument("--limit", type=int, default=None,
                   help="cap for the ingest run (overrides ai_config.genome_wiki_max_pages)")
    p.add_argument("--dry-run", action="store_true",
                   help="print what would be staged but write nothing")
    args = p.parse_args(argv)

    target = Path(args.path).expanduser().resolve()
    pages = _collect(target)
    if not pages:
        print(f"no {sorted(_ACCEPTED_EXT)} files found under {target}", file=sys.stderr)
        return 1
    if args.rs_id and len(pages) > 1:
        print("--rs-id only valid with a single input file", file=sys.stderr)
        return 1

    print(f"staging {len(pages)} candidate file(s) into {app.GENOME_WIKI_ROOT}/raw/snpedia/",
          flush=True)
    staged, skipped = _stage(pages, args.rs_id, args.dry_run)
    print(f"  staged: {len(staged)}; skipped: {len(skipped)}", flush=True)
    for src, why in skipped:
        print(f"    skip {src.name}: {why}", flush=True)

    if not args.ingest:
        return 0
    if args.dry_run:
        print("--dry-run + --ingest: skipping ingest", flush=True)
        return 0

    print(f"running ingest pipeline (limit={args.limit})...", flush=True)
    result = asyncio.run(_run_ingest(staged, args.limit))
    print(json.dumps(result, indent=2, default=str), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
