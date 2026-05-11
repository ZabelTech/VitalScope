#!/usr/bin/env python3
"""Build a catalog of SNPedia's rsid universe via Category:Is_a_snp.

This is the policy-recommended way to discover what rsids exist in SNPedia
( https://bots.snpedia.com/index.php/Bulk → "You must first ask which snps
are in SNPedia with a query such as Category:Is_a_snp" ). Each row in the
catalog is just the rsid title + page id — no content. Cheap to refresh,
~120k rsids / 500 per batch / ~0.6s per batch ≈ 2-3 minutes total.

The catalog backs the on-demand fetcher: when a user ingests a VCF, we
intersect their rsids with the catalog and only fetch the SNPedia pages
they actually need (vs. mirroring all 270k pages up front).

Usage:
  python3 scripts/snpedia_catalog.py            # incremental refresh
  python3 scripts/snpedia_catalog.py --full     # rewalk from start
  python3 scripts/snpedia_catalog.py --limit N  # cap pages walked
"""
import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

import requests

DB_PATH = Path(os.environ.get("VITALSCOPE_DB") or Path(__file__).resolve().parents[1] / "vitalscope.db")
API_BASE = os.environ.get("SNPEDIA_API_BASE", "https://bots.snpedia.com/api.php")
USER_AGENT = os.environ.get(
    "SNPEDIA_USER_AGENT",
    "VitalScope-SNPediaSync/1.0 (rbrtzbl@googlemail.com; "
    "https://github.com/Rbrtzbl/vitalscope) requests/python",
)
MAXLAG = int(os.environ.get("SNPEDIA_MAXLAG", "5"))


SCHEMA = """
CREATE TABLE IF NOT EXISTS snpedia_rsid_catalog (
  rsid        TEXT PRIMARY KEY,
  page_id     INTEGER NOT NULL,
  page_title  TEXT NOT NULL,
  fetched_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snpedia_rsid_catalog_pageid
  ON snpedia_rsid_catalog(page_id);

CREATE TABLE IF NOT EXISTS snpedia_catalog_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  cmcontinue   TEXT,
  completed    INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.executescript(SCHEMA)
    return conn


def get_state(conn: sqlite3.Connection) -> str | None:
    row = conn.execute(
        "SELECT cmcontinue FROM snpedia_catalog_state WHERE id = 1"
    ).fetchone()
    return row[0] if row else None


def save_state(conn: sqlite3.Connection, cmcontinue: str | None, completed: bool) -> None:
    conn.execute(
        """
        INSERT INTO snpedia_catalog_state(id, cmcontinue, completed, updated_at)
        VALUES (1, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          cmcontinue=excluded.cmcontinue,
          completed=excluded.completed,
          updated_at=CURRENT_TIMESTAMP
        """,
        (cmcontinue, int(completed)),
    )


def _get_with_retry(
    session: requests.Session, url: str, params: dict, max_attempts: int = 8,
) -> requests.Response:
    attempt = 0
    while True:
        attempt += 1
        try:
            response = session.get(url, params=params, timeout=60)
            if response.status_code == 503:
                retry_after = response.headers.get("Retry-After")
                try:
                    wait_s = float(retry_after) if retry_after else 5
                except ValueError:
                    wait_s = 5
                wait_s = min(wait_s, 30)
                print(f"  [maxlag] 503; sleeping {wait_s}s", flush=True)
                time.sleep(wait_s)
                continue
            if response.status_code < 500:
                response.raise_for_status()
                return response
            err_status = response.status_code
        except (requests.ConnectionError, requests.Timeout) as exc:
            err_status = type(exc).__name__
        if attempt >= max_attempts:
            raise requests.HTTPError(
                f"giving up after {attempt} attempts (last={err_status})"
            )
        sleep_s = min(60, 2 ** min(attempt, 6))
        print(
            f"  [retry] {err_status} attempt {attempt}/{max_attempts}; sleeping {sleep_s}s",
            flush=True,
        )
        time.sleep(sleep_s)


def walk_category(
    session: requests.Session, start_from: str | None, limit: int | None,
):
    """Yield (members, payload) tuples from Category:Is_a_snp."""
    base = {
        "action": "query",
        "format": "json",
        "list": "categorymembers",
        "cmtitle": "Category:Is_a_snp",
        "cmlimit": "max",
        "maxlag": str(MAXLAG),
    }
    cont: dict[str, str] = {}
    if start_from:
        cont["cmcontinue"] = start_from
    seen = 0
    while True:
        params = {**base, **cont}
        response = _get_with_retry(session, API_BASE, params)
        payload = response.json()
        members = (payload.get("query") or {}).get("categorymembers") or []
        yield members, payload
        seen += len(members)
        if limit and seen >= limit:
            return
        cont_block = payload.get("continue") or {}
        if not cont_block:
            return
        cont = {k: str(v) for k, v in cont_block.items()}


def save_member(conn: sqlite3.Connection, member: dict) -> None:
    title = str(member.get("title") or "")
    pageid = int(member.get("pageid") or 0)
    if not title or not pageid:
        return
    # Title is the canonical SNPedia page name (e.g. "Rs1801133").
    # Lowercase rsid form is what the rest of the codebase uses.
    rsid = title.lower()
    conn.execute(
        """
        INSERT INTO snpedia_rsid_catalog(rsid, page_id, page_title, fetched_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(rsid) DO UPDATE SET
          page_id=excluded.page_id,
          page_title=excluded.page_title,
          fetched_at=CURRENT_TIMESTAMP
        """,
        (rsid, pageid, title),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true",
                        help="rewalk from the start ignoring saved cmcontinue")
    parser.add_argument("--limit", type=int,
                        help="stop after this many members (testing)")
    parser.add_argument("--progress-every", type=int, default=2000)
    args = parser.parse_args()

    conn = open_db()
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    start_from = None if args.full else get_state(conn)
    print(f"[catalog] starting at cmcontinue={start_from!r}", flush=True)

    t0 = time.time()
    total = 0
    try:
        for members, payload in walk_category(session, start_from, args.limit):
            for m in members:
                save_member(conn, m)
                total += 1
            cont_block = payload.get("continue") or {}
            cm_next = cont_block.get("cmcontinue")
            if cm_next:
                save_state(conn, cm_next, completed=False)
            conn.commit()
            if total // args.progress_every != (total - len(members)) // args.progress_every:
                elapsed = time.time() - t0
                rate = total / elapsed if elapsed > 0 else 0.0
                print(
                    f"[catalog] {total:,} rsids ingested "
                    f"({rate:.1f}/s, elapsed {elapsed:.1f}s)",
                    flush=True,
                )
        save_state(conn, None, completed=True)
        conn.commit()
        elapsed = time.time() - t0
        rows = conn.execute("SELECT COUNT(*) FROM snpedia_rsid_catalog").fetchone()[0]
        print(
            f"\n=== done in {elapsed:.1f}s ===\n"
            f"  members ingested this run: {total:,}\n"
            f"  total rows in snpedia_rsid_catalog: {rows:,}"
        )
        return 0
    except requests.HTTPError as exc:
        print(f"HTTP error: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
