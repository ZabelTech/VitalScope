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
API_BASE = os.environ.get("SNPEDIA_API_BASE", "https://bots.snpedia.com/api.php")
# SNPedia's bot policy ( https://bots.snpedia.com/index.php/Bulk ) asks bots
# to identify themselves with name + contact info, so they can reach out
# rather than IP-ban on suspicion. Override via SNPEDIA_USER_AGENT.
USER_AGENT = os.environ.get(
  "SNPEDIA_USER_AGENT",
  "VitalScope-SNPediaSync/1.0 (rbrtzbl@googlemail.com; "
  "https://github.com/Rbrtzbl/vitalscope) requests/python",
)
# MediaWiki maxlag parameter — server returns 503 with retry-after when
# replication lag exceeds this. Lets the API gracefully throttle us.
SNPEDIA_MAXLAG = int(os.environ.get("SNPEDIA_MAXLAG", "5"))

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
PMID_RE = re.compile(r"\bpmid\s*[=:|\s]\s*(\d+)\b", re.IGNORECASE)
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


def _get_with_retry(
  session: requests.Session, url: str, params: dict, max_attempts: int = 8,
) -> requests.Response:
  """GET with exponential backoff on 5xx / network errors, plus MediaWiki
  maxlag-aware retry. The server returns 503 + Retry-After when replication
  lag exceeds `maxlag`; honour that header. SNPedia also 502s frequently
  under sustained load; without retries a single 502 kills the subprocess.
  """
  attempt = 0
  while True:
    attempt += 1
    try:
      response = session.get(url, params=params, timeout=60)
      # 503 + Retry-After (or X-Database-Lag) is the maxlag signal.
      if response.status_code == 503:
        retry_after = response.headers.get("Retry-After")
        try:
          wait_s = float(retry_after) if retry_after else 5
        except ValueError:
          wait_s = 5
        wait_s = min(wait_s, 30)
        print(
          f"  [maxlag] 503 (lag>{params.get('maxlag','?')}s); "
          f"sleeping {wait_s}s",
          flush=True,
        )
        time.sleep(wait_s)
        continue
      if response.status_code < 500:
        response.raise_for_status()
        return response
      err_status = response.status_code
    except (requests.ConnectionError, requests.Timeout) as exc:
      err_status = f"{type(exc).__name__}"
    if attempt >= max_attempts:
      response.raise_for_status() if 'response' in locals() and response is not None else None
      raise requests.HTTPError(f"giving up after {attempt} attempts (last={err_status})")
    sleep_s = min(60, 2 ** min(attempt, 6))
    print(
      f"  [retry] {err_status} on attempt {attempt}/{max_attempts}; "
      f"sleeping {sleep_s}s",
      flush=True,
    )
    time.sleep(sleep_s)


def fetch_all_pages(
  session: requests.Session,
  start_from: str | None,
  limit: int | None,
  end_at: str | None = None,
):
  base_params = {
    "action": "query",
    "format": "json",
    "generator": "allpages",
    "gaplimit": "max",
    "prop": "revisions|extlinks",
    "rvprop": "ids|timestamp|content",
    "ellimit": "max",
    "gapnamespace": 0,
    "maxlag": str(SNPEDIA_MAXLAG),
  }
  cont_params: dict[str, str] = {}
  if start_from:
    cont_params["gapcontinue"] = start_from
  current_gap = start_from
  accumulated: dict[int, dict] = {}
  seen = 0
  while True:
    params = {**base_params, **cont_params}
    response = _get_with_retry(session, API_BASE, params)
    payload = response.json()
    pages = (payload.get("query") or {}).get("pages") or {}
    for pid_str, page in pages.items():
      pid = int(pid_str)
      if pid in accumulated:
        existing = accumulated[pid]
        if page.get("extlinks"):
          existing.setdefault("extlinks", []).extend(page["extlinks"])
        if page.get("revisions") and not existing.get("revisions"):
          existing["revisions"] = page["revisions"]
      else:
        accumulated[pid] = dict(page)
    cont = payload.get("continue") or {}
    next_gap = cont.get("gapcontinue", current_gap if cont else None)
    gap_advanced = bool(cont) and "gapcontinue" in cont and cont["gapcontinue"] != current_gap
    if not cont or gap_advanced:
      batch = list(accumulated.values())
      yield batch, payload
      seen += len(batch)
      accumulated = {}
      current_gap = next_gap
      if not cont:
        return
      if limit and seen >= limit:
        return
      if end_at is not None and current_gap is not None and current_gap >= end_at:
        return
    cont_params = {k: str(v) for k, v in cont.items()}


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
  title_lower = title.lower()
  for rsid in rsids:
    if title_lower == rsid:
      conn.execute(
        "INSERT INTO snpedia_variants(rsid, page_id, source_title) VALUES (?, ?, ?) ON CONFLICT(rsid) DO UPDATE SET page_id=excluded.page_id, source_title=excluded.source_title",
        (rsid, page_id, title),
      )
    else:
      conn.execute(
        "INSERT OR IGNORE INTO snpedia_variants(rsid, page_id, source_title) VALUES (?, ?, ?)",
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


def reparse_local(conn: sqlite3.Connection, progress_every: int) -> None:
  total = conn.execute("SELECT COUNT(*) FROM snpedia_pages").fetchone()[0]
  progress = Progress(started_at=time.time(), total=total)
  print(f"reparsing {total} stored pages — wiping derived tables", flush=True)
  conn.execute("DELETE FROM snpedia_variants")
  conn.execute("DELETE FROM snpedia_genotypes")
  conn.execute("DELETE FROM snpedia_external_links")
  conn.execute("DELETE FROM snpedia_references")
  conn.commit()
  cur = conn.execute("SELECT raw_json FROM snpedia_pages")
  while True:
    rows = cur.fetchmany(500)
    if not rows:
      break
    for (raw,) in rows:
      if not raw:
        continue
      page = json.loads(raw)
      save_page(conn, page)
      progress.processed += 1
      if progress.processed % progress_every == 0:
        progress.emit()
    conn.commit()
  progress.emit()


def fetch_pages_for_rsid(
  session: requests.Session, conn: sqlite3.Connection, rsid: str,
) -> int:
  """Fetch one rsid's main page + all genotype subpages (e.g. Rs1234,
  Rs1234(C;T), Rs1234(C;G), …) via a single allpages-prefix call.
  Returns the number of pages saved.

  Polite: respects the same SNPEDIA_REQUEST_DELAY_S / maxlag / retry
  policy as the bulk walker.
  """
  rsid_clean = rsid.strip()
  if not rsid_clean.lower().startswith("rs"):
    return 0
  # SNPedia normalises rsid titles as "Rs<digits>" (capital R).
  prefix = "Rs" + rsid_clean[2:]
  base = {
    "action": "query",
    "format": "json",
    "generator": "allpages",
    "gapprefix": prefix,
    "gaplimit": "max",
    "gapnamespace": 0,
    "prop": "revisions|extlinks",
    "rvprop": "ids|timestamp|content",
    "ellimit": "max",
    "maxlag": str(SNPEDIA_MAXLAG),
  }
  cont: dict[str, str] = {}
  saved = 0
  while True:
    params = {**base, **cont}
    response = _get_with_retry(session, API_BASE, params)
    payload = response.json()
    pages = (payload.get("query") or {}).get("pages") or {}
    for page in pages.values():
      save_page(conn, page)
      saved += 1
    conn.commit()
    cont_block = payload.get("continue") or {}
    if not cont_block:
      break
    cont = {k: str(v) for k, v in cont_block.items()}
  return saved


def fetch_rsids_on_demand(
  conn: sqlite3.Connection, rsids: list[str], progress_every: int = 50,
) -> tuple[int, int]:
  """Fetch a list of rsids' SNPedia pages on demand. Returns
  (rsids_processed, pages_saved). UPSERTs into snpedia_pages.
  """
  session = requests.Session()
  session.headers["User-Agent"] = USER_AGENT
  total_pages = 0
  t0 = time.time()
  for i, rsid in enumerate(rsids, 1):
    try:
      total_pages += fetch_pages_for_rsid(session, conn, rsid)
    except requests.HTTPError as exc:
      print(f"  ✗ {rsid} {exc}", flush=True)
      continue
    if i % progress_every == 0:
      elapsed = time.time() - t0
      rate = i / elapsed if elapsed > 0 else 0.0
      print(
        f"[fetch-rsids] {i}/{len(rsids)} rsids → {total_pages:,} pages "
        f"({rate:.2f} rsids/s)",
        flush=True,
      )
  return len(rsids), total_pages


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--full", action="store_true")
  parser.add_argument("--limit", type=int)
  parser.add_argument("--progress-every", type=int, default=250)
  parser.add_argument("--reparse", action="store_true", help="re-derive variants/genotypes/extlinks/references from stored raw_json without hitting the API")
  parser.add_argument("--start-at", type=str, default=None,
                      help="override saved cursor; start the allpages walk at this title prefix")
  parser.add_argument("--end-at", type=str, default=None,
                      help="stop when the cursor advances past this title prefix (exclusive). "
                           "Used with --start-at to slice the alphabet across parallel workers.")
  parser.add_argument("--fetch-rsids", type=str, default=None,
                      help="path to a newline-separated rsid list (or '-' for stdin); "
                           "fetch ONLY those rsids' pages + genotype subpages")
  parser.add_argument("--fetch-rsids-from-vcf", type=str, default=None,
                      help="path to a VCF; extract rsids in the ID column and fetch them")
  args = parser.parse_args()

  conn = open_db()

  if args.reparse:
    try:
      reparse_local(conn, args.progress_every)
    finally:
      conn.close()
    return

  if args.fetch_rsids or args.fetch_rsids_from_vcf:
    rsids: list[str] = []
    if args.fetch_rsids:
      src = sys.stdin if args.fetch_rsids == "-" else open(args.fetch_rsids, "r")
      try:
        rsids = [line.strip() for line in src if line.strip().lower().startswith("rs")]
      finally:
        if src is not sys.stdin:
          src.close()
    if args.fetch_rsids_from_vcf:
      import gzip as _gz
      path = Path(args.fetch_rsids_from_vcf)
      opener = _gz.open if path.suffix == ".gz" else open
      seen: set[str] = set()
      with opener(path, "rt", errors="replace") as fh:
        for line in fh:
          if line.startswith("#"):
            continue
          parts = line.rstrip("\n").split("\t")
          if len(parts) < 3:
            continue
          rsid = parts[2]
          if rsid.lower().startswith("rs"):
            seen.add(rsid.lower())
      rsids.extend(sorted(seen))
    # Intersect with the catalog so we don't waste calls on rsids
    # SNPedia doesn't carry. The catalog has lowercase rsids.
    cat_known: set[str] = {
      row[0] for row in conn.execute("SELECT rsid FROM snpedia_rsid_catalog")
    }
    if cat_known:
      filtered = [r for r in rsids if r.lower() in cat_known]
      print(
        f"[fetch-rsids] {len(rsids):,} requested, "
        f"{len(filtered):,} in SNPedia catalog",
        flush=True,
      )
      rsids = filtered
    else:
      print(
        f"[fetch-rsids] catalog empty (run snpedia_catalog.py first); "
        f"trying all {len(rsids)} requested rsids",
        flush=True,
      )
    # Skip rsids whose main page is already mirrored — makes repeat
    # ingests near-instant once the cache is warm.
    already_have: set[str] = {
      row[0].lower() for row in conn.execute(
        "SELECT title FROM snpedia_pages "
        "WHERE title GLOB 'Rs[0-9]*' AND title NOT GLOB '*(*'"
      )
    }
    if already_have:
      before = len(rsids)
      rsids = [r for r in rsids if r.lower() not in already_have]
      skipped = before - len(rsids)
      print(
        f"[fetch-rsids] {skipped:,} already in snpedia_pages → skipping; "
        f"{len(rsids):,} new to fetch",
        flush=True,
      )
    n_rsids, n_pages = fetch_rsids_on_demand(conn, rsids)
    print(f"\n=== done: {n_rsids} rsids, {n_pages:,} pages saved ===")
    conn.close()
    return

  session = requests.Session()
  session.headers["User-Agent"] = USER_AGENT

  # Normalise empty-string to None so the shell-friendly form
  # `--end-at ""` reads as "no upper bound" instead of "<= empty",
  # which `current_gap >= end_at` would otherwise satisfy immediately.
  start_at = args.start_at if args.start_at else None
  end_at = args.end_at if args.end_at else None
  use_shared_state = start_at is None and end_at is None
  if start_at is not None:
    start_from = start_at
  else:
    start_from = None if args.full else get_state(conn)
  args_end_at = end_at
  total_guess = args.limit or 1
  progress = Progress(started_at=time.time(), total=total_guess)
  prefix = ""
  if args.start_at or args.end_at:
    prefix = f"[slice {args.start_at or ''}..{args.end_at or ''}] "
  print(f"{prefix}starting at apcontinue={start_from!r}", flush=True)

  try:
    for pages, payload in fetch_all_pages(
      session,
      start_from=start_from,
      limit=args.limit,
      end_at=args_end_at,
    ):
      if use_shared_state and payload.get("continue") and payload["continue"].get("gapcontinue"):
        save_state(conn, payload["continue"]["gapcontinue"], completed=False)
      if pages:
        progress.total = max(progress.total, progress.processed + len(pages))
      for page in pages:
        save_page(conn, page)
        progress.processed += 1
        if progress.processed % args.progress_every == 0:
          progress.emit()
      conn.commit()
    if use_shared_state:
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
