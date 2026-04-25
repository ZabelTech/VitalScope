#!/usr/bin/env python3
"""Sync CGM (continuous glucose monitoring) readings via LibreLinkUp.

Incremental by default (re-fetches last 2 days). Supports --full / --all for
a complete re-pull of whatever the API exposes (typically ~14 days of graph
data + logbook entries).

Provider selection via CGM_PROVIDER env var (default: "libre").
For LibreLinkUp, set LIBRE_EMAIL, LIBRE_PASSWORD, and optionally LIBRE_REGION.
Token cached at ~/.cgmapp/token.json.
"""

import argparse
import json
import math
import os
import sqlite3
import statistics
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

TOKEN_DIR = Path("~/.cgmapp").expanduser()
TOKEN_FILE = TOKEN_DIR / "token.json"
DB_PATH = Path(os.environ.get("VITALSCOPE_DB") or Path(__file__).parent / "vitalscope.db")

CGM_PROVIDER = os.environ.get("CGM_PROVIDER", "libre").lower()

# LibreLinkUp region → base URL mapping
LIBRE_REGIONS: dict[str, str] = {
    "ae": "https://api-ae.libreview.io",
    "ap": "https://api-ap.libreview.io",
    "au": "https://api-au.libreview.io",
    "ca": "https://api-ca.libreview.io",
    "de": "https://api-de.libreview.io",
    "eu": "https://api-eu.libreview.io",
    "fr": "https://api-fr.libreview.io",
    "jp": "https://api-jp.libreview.io",
    "us": "https://api-us.libreview.io",
    "us2": "https://api-us2.libreview.io",
}
LIBRE_REGION = os.environ.get("LIBRE_REGION", "eu").lower()
LIBRE_BASE_URL = LIBRE_REGIONS.get(LIBRE_REGION, LIBRE_REGIONS["eu"])

_LIBRE_HEADERS = {
    "Content-Type": "application/json",
    "product": "llu.android",
    "version": "4.7.0",
    "Accept": "application/json",
}

# LLU trend arrow integer → short string
_TREND_MAP: dict[int, str] = {
    1: "unknown",
    2: "falling_fast",
    3: "falling",
    4: "falling_slowly",
    5: "flat",
    6: "rising_slowly",
    7: "rising",
    8: "rising_fast",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS glucose_readings (
    timestamp   TEXT NOT NULL,
    date        TEXT NOT NULL,
    mgdl        INTEGER NOT NULL,
    trend       TEXT,
    source      TEXT DEFAULT 'libre',
    PRIMARY KEY (date, timestamp)
);

CREATE TABLE IF NOT EXISTS glucose_daily (
    date            TEXT PRIMARY KEY,
    avg_mgdl        REAL,
    min_mgdl        INTEGER,
    max_mgdl        INTEGER,
    std_dev         REAL,
    cv_percent      REAL,
    tir_pct         REAL,
    readings_count  INTEGER
);
"""


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.executescript(SCHEMA)
    return conn


class LibreClient:
    """Minimal HTTP client for the LibreLinkUp (LibreView) cloud API."""

    def __init__(self) -> None:
        self.token: str | None = None
        self.account_id: str | None = None
        self.session = requests.Session()
        self.session.headers.update(_LIBRE_HEADERS)

    def _save(self) -> None:
        TOKEN_DIR.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps({
            "token": self.token,
            "account_id": self.account_id,
            "region": LIBRE_REGION,
        }))

    def _load(self) -> bool:
        if not TOKEN_FILE.exists():
            return False
        try:
            data = json.loads(TOKEN_FILE.read_text())
        except (OSError, json.JSONDecodeError):
            return False
        if data.get("region") != LIBRE_REGION:
            return False
        self.token = data.get("token")
        self.account_id = data.get("account_id")
        return bool(self.token)

    def login(self) -> None:
        email = os.environ.get("LIBRE_EMAIL")
        password = os.environ.get("LIBRE_PASSWORD")
        if not email or not password:
            raise SystemExit(
                "Set LIBRE_EMAIL and LIBRE_PASSWORD env vars "
                "(or keep a valid ~/.cgmapp/token.json around)."
            )
        r = self.session.post(
            f"{LIBRE_BASE_URL}/llu/auth/login",
            json={"email": email, "password": password},
            timeout=30,
        )
        r.raise_for_status()
        body = r.json()
        if body.get("status") != 0:
            raise SystemExit(f"LibreLinkUp login failed: {body.get('error', body)!r}")
        data = body["data"]
        # The API may redirect us to the correct regional endpoint
        if data.get("redirect"):
            region = (data.get("region") or "").lower()
            if region and region in LIBRE_REGIONS:
                raise SystemExit(
                    f"LibreLinkUp requires region={region!r}. "
                    f"Set LIBRE_REGION={region} and retry."
                )
            raise SystemExit(f"LibreLinkUp redirect: {data!r}")
        self.token = data["authTicket"]["token"]
        self.account_id = data["user"]["id"]
        self.session.headers["Authorization"] = f"Bearer {self.token}"
        self._save()

    def ensure_token(self) -> None:
        if self._load():
            self.session.headers["Authorization"] = f"Bearer {self.token}"
            return
        self.login()

    def get_connections(self) -> list[dict]:
        r = self.session.get(f"{LIBRE_BASE_URL}/llu/connections", timeout=30)
        r.raise_for_status()
        return r.json().get("data") or []

    def get_graph(self, patient_id: str) -> dict:
        r = self.session.get(
            f"{LIBRE_BASE_URL}/llu/connections/{patient_id}/graph",
            timeout=30,
        )
        r.raise_for_status()
        return r.json().get("data") or {}

    def get_logbook(self, patient_id: str) -> list[dict]:
        r = self.session.get(
            f"{LIBRE_BASE_URL}/llu/connections/{patient_id}/logbook",
            timeout=30,
        )
        r.raise_for_status()
        return r.json().get("data") or []


def _parse_reading(raw: dict) -> tuple[str, str, int, str | None] | None:
    """Return (timestamp_iso, date_iso, mgdl, trend) or None if unparseable."""
    ts_raw = raw.get("FactoryTimestamp") or raw.get("Timestamp") or raw.get("timestamp")
    if not ts_raw:
        return None
    mgdl_raw = raw.get("Value") or raw.get("value")
    if mgdl_raw is None:
        mmol = raw.get("ValueInMmol")
        if mmol is not None:
            mgdl_raw = float(mmol) * 18.0182
    if mgdl_raw is None:
        return None
    mgdl = int(round(float(mgdl_raw)))
    trend_raw = raw.get("TrendArrow") or raw.get("trendArrow")
    trend = _TREND_MAP.get(int(trend_raw)) if trend_raw is not None else None
    try:
        if isinstance(ts_raw, (int, float)):
            # Garmin-style epoch: millis if > 1e10, else seconds
            epoch = ts_raw / 1000 if ts_raw > 1e10 else ts_raw
            dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
        else:
            for fmt in (
                "%m/%d/%Y %I:%M %p",
                "%m/%d/%Y %H:%M",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S",
            ):
                try:
                    dt = datetime.strptime(ts_raw, fmt).replace(tzinfo=timezone.utc)
                    break
                except ValueError:
                    continue
            else:
                return None
    except (ValueError, TypeError, OSError):
        return None
    ts_iso = dt.strftime("%Y-%m-%dT%H:%M:%S")
    date_iso = dt.strftime("%Y-%m-%d")
    return ts_iso, date_iso, mgdl, trend


def save_readings(
    conn: sqlite3.Connection,
    readings: list[dict],
    source: str = "libre",
) -> int:
    """Insert readings and recompute daily aggregates. Returns inserted count."""
    count = 0
    by_date: dict[str, list[int]] = {}
    for raw in readings:
        parsed = _parse_reading(raw)
        if not parsed:
            continue
        ts, d, mgdl, trend = parsed
        conn.execute(
            "INSERT OR REPLACE INTO glucose_readings (timestamp, date, mgdl, trend, source) "
            "VALUES (?,?,?,?,?)",
            (ts, d, mgdl, trend, source),
        )
        by_date.setdefault(d, []).append(mgdl)
        count += 1
    for d, values in by_date.items():
        # Pull ALL values for the date (not just those in this batch) so
        # aggregates are accurate on partial incremental syncs.
        existing = [
            r[0] for r in conn.execute(
                "SELECT mgdl FROM glucose_readings WHERE date = ?", (d,)
            ).fetchall()
        ]
        all_values = existing or values
        avg = round(statistics.mean(all_values), 1)
        std = round(statistics.stdev(all_values), 1) if len(all_values) > 1 else 0.0
        cv = round(std / avg * 100, 1) if avg > 0 else 0.0
        in_range = sum(1 for v in all_values if 70 <= v <= 180)
        tir = round(in_range / len(all_values) * 100, 1)
        conn.execute(
            "INSERT OR REPLACE INTO glucose_daily "
            "(date, avg_mgdl, min_mgdl, max_mgdl, std_dev, cv_percent, tir_pct, readings_count) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (d, avg, min(all_values), max(all_values), std, cv, tir, len(all_values)),
        )
    return count


def sync_libre(conn: sqlite3.Connection) -> int:
    client = LibreClient()
    client.ensure_token()
    connections = client.get_connections()
    if not connections:
        print("cgm: no LibreLinkUp connections found", flush=True)
        return 0
    total = 0
    for entry in connections:
        patient_id = entry.get("patientId") or entry.get("id")
        if not patient_id:
            continue
        print(f"cgm: fetching data for patient {patient_id}", flush=True)
        graph = client.get_graph(patient_id)
        raw_readings: list[dict] = list(graph.get("graphData") or [])
        current = entry.get("glucoseMeasurement")
        if current:
            raw_readings.append(current)
        n = save_readings(conn, raw_readings)
        print(f"cgm: saved {n} readings from graph", flush=True)
        total += n
        try:
            logbook = client.get_logbook(patient_id)
            n2 = save_readings(conn, logbook)
            if n2:
                print(f"cgm: saved {n2} readings from logbook", flush=True)
            total += n2
        except Exception as exc:
            print(f"cgm: logbook fetch failed (non-fatal): {exc}", flush=True)
    conn.commit()
    return total


def main() -> None:
    p = argparse.ArgumentParser(description="Sync CGM glucose data")
    p.add_argument("--full", "--all", action="store_true",
                   help="Force full re-pull (same scope — API limits history)")
    p.add_argument("--days", type=int, help="Hint: expected days to fetch (informational)")
    p.add_argument("--since", help="Hint: fetch from YYYY-MM-DD (informational)")
    args = p.parse_args()

    conn = init_db()
    try:
        provider = CGM_PROVIDER
        if provider == "libre":
            n = sync_libre(conn)
        else:
            raise SystemExit(f"Unknown CGM_PROVIDER={provider!r}. Supported: libre")
        print(f"cgm: sync complete — {n} rows written", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
