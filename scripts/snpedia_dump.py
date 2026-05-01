#!/usr/bin/env python3
import argparse
import json
import os
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import requests

DB_PATH = Path(os.environ.get("VITALSCOPE_DB") or Path(__file__).resolve().parents[1] / "vitalscope.db")
API_BASE = os.environ.get("SNPEDIA_API_BASE", "https://www.snpedia.com/api.php")
USER_AGENT = os.environ.get("SNPEDIA_USER_AGENT", "VitalScope-SNPediaSync/1.0 (personal health dashboard)")

SCHEMA = """
CREATE TABLE IF NOT EXISTS snpedia_pages (
  page_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  ns INTEGER,
  latest_revid INTEGER,
  latest_rev_ts TEXT,
  fetched_at TEXT,
  raw_json TEXT
);
CREATE TABLE IF NOT EXISTS snpedia_variants (
  rsid TEXT PRIMARY KEY,
  page_id INTEGER,
  source_title TEXT,
  FOREIGN KEY(page_id) REFERENCES snpedia_pages(page_id)
);
CREATE TABLE IF NOT EXISTS snpedia_genotypes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rsid TEXT NOT NULL,
  genotype_text TEXT,
  allele1 TEXT,
  allele2 TEXT,
  source_title TEXT,
  UNIQUE(rsid, genotype_text, source_title)
);
CREATE TABLE IF NOT EXISTS snpedia_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  domain TEXT,
  link_type TEXT NOT NULL,
  UNIQUE(page_id, url, link_type)
);
CREATE TABLE IF NOT EXISTS snpedia_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  ref_text TEXT NOT NULL,
  doi TEXT,
  pmid TEXT,
  url TEXT,
  UNIQUE(page_id, ref_text)
);
CREATE TABLE IF NOT EXISTS snpedia_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  apcontinue TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

RSID_RE = re.compile(r"\brs\d+\b", re.IGNORECASE)
GENOTYPE_TITLE_RE = re.compile(r"\b(rs\d+)\(([ACGT]);([ACGT])\)", re.IGNORECASE)
DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
PMID_RE = re.compile(r"\bpmid\s*[: ]\s*(\d+)\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://[^\s\]|}]+", re.IGNORECASE)


@dataclass
class Progress:
  started_at: float
  processed: int = 0
  total: int = 0

  def emit(self) -> None:
    elapsed = max(0.001, time.time() - self.started_at)
    speed = self.processed / elapsed
    pct = (self.processed / self.total * 100.0) if self.total > 0 else 0.0
    print(f"progress={pct:.2f}% ({self.processed}/{self.total}) speed={speed:.2f} items/s", flush=True)


def open_db() -> sqlite3.Connection:
  conn = sqlite3.connect(str(DB_PATH))
  conn.executescript(SCHEMA)
  return conn


def get_state(conn: sqlite3.Connection) -> str | None:
  row = conn.execute("SELECT apcontinue FROM snpedia_sync_state WHERE id = 1").fetchone()
  return row[0] if row else None


def save_state(conn: sqlite3.Connection, apcontinue: str | None, completed: bool) -> None:
  conn.execute(
    """
    INSERT INTO snpedia_sync_state(id, apcontinue, completed, updated_at)
    VALUES (1, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      apcontinue=excluded.apcontinue,
      completed=excluded.completed,
      updated_at=CURRENT_TIMESTAMP
    """,
    (apcontinue, int(completed)),
  )


def fetch_all_pages(session: requests.Session, start_from: str | None, limit: int | None):
  apcontinue = start_from
  seen = 0
  while True:
    params = {
      "action": "query",
      "format": "json",
      "generator": "allpages",
      "gaplimit": "max",
      "prop": "revisions|extlinks",
      "rvprop": "ids|timestamp|content",
      "ellimit": "max",
      "gapnamespace": 0,
    }
    if apcontinue:
      params["gapcontinue"] = apcontinue
    response = session.get(API_BASE, params=params, timeout=60)
    response.raise_for_status()
    payload = response.json()
    pages = list((payload.get("query") or {}).get("pages", {}).values())
    yield pages, payload
    seen += len(pages)
    if limit and seen >= limit:
      break
    cont = payload.get("continue") or {}
    apcontinue = cont.get("gapcontinue")
    if not apcontinue:
      break


def save_page(conn: sqlite3.Connection, page: dict) -> None:
  rev = (page.get("revisions") or [{}])[0]
  page_id = int(page.get("pageid") or 0)
  title = str(page.get("title") or "")
  conn.execute(
    """
    INSERT INTO snpedia_pages(page_id, title, ns, latest_revid, latest_rev_ts, fetched_at, raw_json)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(page_id) DO UPDATE SET
      title=excluded.title,
      ns=excluded.ns,
      latest_revid=excluded.latest_revid,
      latest_rev_ts=excluded.latest_rev_ts,
      fetched_at=CURRENT_TIMESTAMP,
      raw_json=excluded.raw_json
    """,
    (
      page_id,
      title,
      page.get("ns"),
      rev.get("revid"),
      rev.get("timestamp"),
      json.dumps(page),
    ),
  )
  text = str(rev.get("*") or rev.get("slots", {}).get("main", {}).get("*") or "")
  rsids = {m.group(0).lower() for m in RSID_RE.finditer(title + "\n" + text)}
  for rsid in rsids:
    conn.execute(
      "INSERT INTO snpedia_variants(rsid, page_id, source_title) VALUES (?, ?, ?) ON CONFLICT(rsid) DO UPDATE SET page_id=excluded.page_id, source_title=excluded.source_title",
      (rsid, page_id, title),
    )

  for m in GENOTYPE_TITLE_RE.finditer(title):
    rsid = m.group(1).lower()
    allele1 = m.group(2).upper()
    allele2 = m.group(3).upper()
    genotype = f"{allele1};{allele2}"
    conn.execute(
      "INSERT OR IGNORE INTO snpedia_genotypes(rsid, genotype_text, allele1, allele2, source_title) VALUES (?, ?, ?, ?, ?)",
      (rsid, genotype, allele1, allele2, title),
    )

  for ext in page.get("extlinks") or []:
    url = ext.get("*")
    if not url:
      continue
    domain = urlparse(url).netloc.lower()
    conn.execute(
      "INSERT OR IGNORE INTO snpedia_external_links(page_id, url, domain, link_type) VALUES (?, ?, ?, 'extlink')",
      (page_id, url, domain),
    )

  for line in text.splitlines():
    lower = line.lower()
    if "<ref" not in lower and "pmid" not in lower and "doi" not in lower:
      continue
    doi = (DOI_RE.search(line).group(0) if DOI_RE.search(line) else None)
    pmid = (PMID_RE.search(line).group(1) if PMID_RE.search(line) else None)
    url = (URL_RE.search(line).group(0) if URL_RE.search(line) else None)
    conn.execute(
      "INSERT OR IGNORE INTO snpedia_references(page_id, ref_text, doi, pmid, url) VALUES (?, ?, ?, ?, ?)",
      (page_id, line.strip(), doi, pmid, url),
    )


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--full", action="store_true")
  parser.add_argument("--limit", type=int)
  parser.add_argument("--progress-every", type=int, default=250)
  args = parser.parse_args()

  session = requests.Session()
  session.headers["User-Agent"] = USER_AGENT

  conn = open_db()
  start_from = None if args.full else get_state(conn)
  total_guess = args.limit or 1
  progress = Progress(started_at=time.time(), total=total_guess)

  try:
    for pages, payload in fetch_all_pages(session, start_from=start_from, limit=args.limit):
      if payload.get("continue") and payload["continue"].get("gapcontinue"):
        save_state(conn, payload["continue"]["gapcontinue"], completed=False)
      if pages:
        progress.total = max(progress.total, progress.processed + len(pages))
      for page in pages:
        save_page(conn, page)
        progress.processed += 1
        if progress.processed % args.progress_every == 0:
          progress.emit()
      conn.commit()
    save_state(conn, None, completed=True)
    conn.commit()
    progress.emit()
  finally:
    conn.close()


if __name__ == "__main__":
  try:
    main()
  except requests.HTTPError as exc:
    print(f"HTTP error: {exc}", file=sys.stderr)
    raise
