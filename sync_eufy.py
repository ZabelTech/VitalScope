#!/usr/bin/env python3
"""Sync body composition data from the EufyLife cloud and store in SQLite."""

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

TOKEN_DIR = Path("~/.eufylife").expanduser()
TOKEN_FILE = TOKEN_DIR / "token.json"
DB_PATH = Path(os.environ.get("VITALSCOPE_DB") or Path(__file__).parent / "vitalscope.db")

API_BASE_URL = "https://appliances-api-eu.eufylife.com"
LOGIN_URL = f"{API_BASE_URL}/v1/user/v2/email/login"
DEVICE_DATA_URL = f"{API_BASE_URL}/v1/device/data"

CLIENT_ID = "eufy-app"
CLIENT_SECRET = "8FHf22gaTKu7MZXqz5zytw"
USER_AGENT = "Eufylife-iOS-3.3.7-281"

SCHEMA = """
CREATE TABLE IF NOT EXISTS weight_daily (
    date              TEXT PRIMARY KEY,
    weight_kg         REAL,
    body_fat_pct      REAL,
    muscle_mass_kg    REAL,
    bone_mass_kg      REAL,
    water_pct         REAL,
    bmi               REAL,
    visceral_fat      REAL,
    bmr               INTEGER,
    protein_pct       REAL,
    lean_body_mass_kg REAL,
    body_age          INTEGER,
    heart_rate        INTEGER
);

CREATE TABLE IF NOT EXISTS weight_readings (
    timestamp         TEXT NOT NULL,
    date              TEXT NOT NULL,
    customer_id       TEXT NOT NULL,
    weight_kg         REAL,
    body_fat_pct      REAL,
    muscle_mass_kg    REAL,
    bone_mass_kg      REAL,
    water_pct         REAL,
    bmi               REAL,
    visceral_fat      REAL,
    bmr               INTEGER,
    protein_pct       REAL,
    lean_body_mass_kg REAL,
    body_age          INTEGER,
    heart_rate        INTEGER,
    PRIMARY KEY (date, timestamp, customer_id)
);
"""

WEIGHT_DAILY_COLS = [
    "weight_kg", "body_fat_pct", "muscle_mass_kg", "bone_mass_kg",
    "water_pct", "bmi", "visceral_fat", "bmr", "protein_pct",
    "lean_body_mass_kg", "body_age", "heart_rate",
]


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


class EufyClient:
    """Minimal HTTP client for the reverse-engineered EufyLife cloud API."""

    def __init__(self):
        self.access_token: str | None = None
        self.user_id: str | None = None
        self.expires_at: float = 0.0
        self.session = requests.Session()

    def _save(self):
        TOKEN_DIR.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps({
            "access_token": self.access_token,
            "user_id": self.user_id,
            "expires_at": self.expires_at,
        }))

    def _load(self) -> bool:
        if not TOKEN_FILE.exists():
            return False
        try:
            data = json.loads(TOKEN_FILE.read_text())
        except (OSError, json.JSONDecodeError):
            return False
        self.access_token = data.get("access_token")
        self.user_id = data.get("user_id")
        self.expires_at = data.get("expires_at", 0)
        return bool(self.access_token and self.user_id)

    def login(self):
        email = os.environ.get("EUFY_EMAIL")
        password = os.environ.get("EUFY_PASSWORD")
        if not email or not password:
            raise SystemExit(
                "Set EUFY_EMAIL and EUFY_PASSWORD env vars "
                "(or keep a valid ~/.eufylife/token.json around)."
            )

        headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "EufyLife-iOS-3.3.7",
            "Category": "Health",
            "Language": "en",
            "Timezone": "UTC",
            "Country": "US",
        }
        payload = {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "email": email,
            "password": password,
        }
        r = self.session.post(LOGIN_URL, headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        body = r.json()
        if body.get("res_code") != 1:
            raise SystemExit(f"EufyLife login rejected: {body.get('message')!r}")

        self.access_token = body["access_token"]
        self.user_id = body["user_id"]
        self.expires_at = time.time() + body.get("expires_in", 2_592_000)
        self._save()

    def ensure_token(self):
        if self._load() and self.expires_at - time.time() > 300:
            return
        self.login()

    def _headers(self) -> dict:
        return {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": USER_AGENT,
            "Uid": self.user_id or "",
            "Token": self.access_token or "",
        }

    def get_device_data(self, after: int | None = None) -> list[dict]:
        """Fetch weigh-in records. `after` is a Unix seconds cutoff."""
        url = DEVICE_DATA_URL
        if after is not None:
            url = f"{DEVICE_DATA_URL}?after={int(after)}"

        for attempt in range(2):
            r = self.session.get(url, headers=self._headers(), timeout=30)
            if r.status_code == 401 and attempt == 0:
                self.login()
                continue
            if r.status_code == 429:
                print("\n  Rate limited — waiting 60s...")
                time.sleep(60)
                continue
            r.raise_for_status()
            body = r.json()
            if isinstance(body, list):
                return body
            if body.get("res_code") != 1:
                raise RuntimeError(f"EufyLife API error: {body.get('message')!r}")
            return body.get("data") or []
        return []


def _num(v):
    return v if isinstance(v, (int, float)) and v else None


def parse_record(record: dict) -> dict | None:
    """Map a raw Eufy device-data record to our flat schema. Returns None if unusable."""
    scale = record.get("scale_data") or {}
    update_time = record.get("update_time") or record.get("create_time")
    customer_id = record.get("customer_id") or record.get("customerId") or ""
    if not update_time or not customer_id:
        return None

    # Weight is reported in decigrams on the device_data endpoint.
    weight_dg = _num(scale.get("weight"))
    weight_kg = round(weight_dg / 10.0, 2) if weight_dg else None
    if weight_kg is None:
        return None

    ts = datetime.fromtimestamp(update_time, tz=timezone.utc)

    body_fat_pct = _num(scale.get("body_fat"))
    muscle_mass_kg = _num(scale.get("muscle_mass"))
    # Lean body mass isn't sent directly; derive from weight and body-fat when possible.
    lean_body_mass_kg = (
        round(weight_kg * (1 - body_fat_pct / 100.0), 2)
        if body_fat_pct is not None else None
    )

    return {
        "timestamp": ts.isoformat(),
        "date": ts.date().isoformat(),
        "customer_id": customer_id,
        "update_time": int(update_time),
        "weight_kg": weight_kg,
        "body_fat_pct": body_fat_pct,
        "muscle_mass_kg": muscle_mass_kg,
        "bone_mass_kg": _num(scale.get("bone_mass")),
        "water_pct": _num(scale.get("water")),
        "bmi": _num(scale.get("bmi")),
        "visceral_fat": _num(scale.get("visceral_fat")),
        "bmr": int(scale["bmr"]) if _num(scale.get("bmr")) else None,
        "protein_pct": _num(scale.get("protein_ratio")),
        "lean_body_mass_kg": lean_body_mass_kg,
        "body_age": int(scale["body_age"]) if _num(scale.get("body_age")) else None,
        "heart_rate": int(scale["heart_rate"]) if _num(scale.get("heart_rate")) else None,
    }


def save_records(conn: sqlite3.Connection, records: list[dict],
                 primary_customer: str | None) -> tuple[int, int]:
    """Insert readings and refresh weight_daily for the primary customer."""
    if not records:
        return 0, 0

    reading_cols = ["timestamp", "date", "customer_id"] + WEIGHT_DAILY_COLS
    placeholders = ", ".join(["?"] * len(reading_cols))
    sql = (
        f"INSERT OR REPLACE INTO weight_readings ({', '.join(reading_cols)}) "
        f"VALUES ({placeholders})"
    )
    conn.executemany(sql, [[r[c] for c in reading_cols] for r in records])

    # Pick the latest reading per date for the primary customer → weight_daily.
    daily: dict[str, dict] = {}
    for r in records:
        if primary_customer and r["customer_id"] != primary_customer:
            continue
        day = r["date"]
        cur = daily.get(day)
        if cur is None or r["update_time"] > cur["update_time"]:
            daily[day] = r

    if daily:
        daily_cols = ["date"] + WEIGHT_DAILY_COLS
        sql_daily = (
            f"INSERT OR REPLACE INTO weight_daily ({', '.join(daily_cols)}) "
            f"VALUES ({', '.join(['?'] * len(daily_cols))})"
        )
        conn.executemany(
            sql_daily,
            [[r[c] for c in daily_cols] for r in daily.values()],
        )

    conn.commit()
    return len(records), len(daily)


def pick_primary_customer(records: list[dict], override: str | None) -> str | None:
    if override:
        return override
    counts: dict[str, int] = {}
    for r in records:
        counts[r["customer_id"]] = counts.get(r["customer_id"], 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync EufyLife body-composition data")
    parser.add_argument(
        "--date", default=date.today().isoformat(),
        help="End date to sync (YYYY-MM-DD, default: today)",
    )
    parser.add_argument(
        "--days", type=int, default=None,
        help="Number of days back from --date to keep (default: 1)",
    )
    parser.add_argument(
        "--since",
        help="Keep all weigh-ins from this date to --date (overrides --days)",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Keep every weigh-in the API returns, ignoring --date/--days/--since.",
    )
    parser.add_argument(
        "--customer-id",
        help="Customer ID to treat as primary for weight_daily (default: most frequent).",
    )
    return parser.parse_args()


def latest_weight_timestamp(conn: sqlite3.Connection) -> int | None:
    """Return the most recent weigh-in timestamp (Unix seconds), or None."""
    try:
        row = conn.execute(
            "SELECT MAX(created_at) FROM weight_readings"
        ).fetchone()
        if row and row[0] is not None:
            return int(row[0])
    except sqlite3.OperationalError:
        pass
    try:
        row = conn.execute("SELECT MAX(date) FROM weight_daily").fetchone()
        if row and row[0]:
            d = date.fromisoformat(row[0])
            return int(datetime.combine(d, datetime.min.time()).timestamp())
    except sqlite3.OperationalError:
        pass
    return None


def main():
    args = parse_args()
    end = date.fromisoformat(args.date)
    if args.since:
        start = date.fromisoformat(args.since)
    elif args.days is not None:
        start = end - timedelta(days=args.days - 1)
    else:
        start = None  # incremental default

    print("Authenticating with EufyLife...")
    client = EufyClient()
    client.ensure_token()
    print(f"Authenticated as user {client.user_id}.\n")

    conn = init_db()
    print(f"Database: {DB_PATH}")

    t0 = time.time()

    # Determine incremental cutoff
    after: int | None = None
    if not args.all and start is None:
        latest = latest_weight_timestamp(conn)
        if latest is not None:
            # Re-fetch last 24h to catch late sync-ups
            after = latest - 86400
            cutoff_str = datetime.fromtimestamp(after).isoformat(timespec="seconds")
            print(f"Incremental: fetching data after {cutoff_str}")

    if after is not None:
        raw = client.get_device_data(after=after)
    else:
        print("Fetching all device data (this may take a moment)...")
        raw = client.get_device_data()
    print(f"  {len(raw)} raw records returned.")

    parsed: list[dict] = []
    for rec in raw:
        p = parse_record(rec)
        if p is None:
            continue
        if args.all or start is None:
            parsed.append(p)
        elif start.isoformat() <= p["date"] <= end.isoformat():
            parsed.append(p)

    if args.all:
        print(f"Keeping all {len(parsed)} weigh-ins.")
    elif start is None:
        print(f"Keeping {len(parsed)} new weigh-ins.")
    else:
        print(
            f"Keeping {len(parsed)} weigh-ins in "
            f"{start.isoformat()} → {end.isoformat()}."
        )

    primary = pick_primary_customer(parsed, args.customer_id)
    if primary:
        print(f"Primary customer for weight_daily: {primary}")
    else:
        print("No weigh-ins to store.")

    readings, days = save_records(conn, parsed, primary)
    elapsed = time.time() - t0
    print(
        f"\nDone. {readings} readings / {days} daily rows written "
        f"in {elapsed:.1f}s."
    )


if __name__ == "__main__":
    main()
