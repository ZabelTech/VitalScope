#!/usr/bin/env python3
"""Sync all activities (runs, rides, strength, etc.) from Garmin Connect into SQLite.

Garmin strength sessions are stored at the summary level only — per-set data belongs
in Strong's workouts/workout_sets tables (owned by sync_strong.py) and is intentionally
not fetched here to avoid schema clash.
"""

import argparse
import json
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from garminconnect import GarminConnectTooManyRequestsError

from sync_garmin import get_client

DB_PATH = Path(__file__).parent / "vitalscope.db"
PAGE_SIZE = 100

SCHEMA = """
CREATE TABLE IF NOT EXISTS garmin_activities (
    activity_id      INTEGER PRIMARY KEY,
    date             TEXT NOT NULL,
    start_time       TEXT NOT NULL,
    end_time         TEXT,
    name             TEXT,
    sport_type       TEXT,
    activity_type    TEXT,
    duration_sec     REAL,
    moving_time_sec  REAL,
    distance_m       REAL,
    elevation_gain_m REAL,
    avg_hr           INTEGER,
    max_hr           INTEGER,
    avg_speed_mps    REAL,
    calories         INTEGER,
    avg_power_w      REAL,
    training_effect  REAL,
    anaerobic_te     REAL,
    raw_json         TEXT
);
CREATE INDEX IF NOT EXISTS idx_garmin_activities_date ON garmin_activities(date);
"""

COLUMNS = [
    "activity_id", "date", "start_time", "end_time", "name",
    "sport_type", "activity_type", "duration_sec", "moving_time_sec",
    "distance_m", "elevation_gain_m", "avg_hr", "max_hr",
    "avg_speed_mps", "calories", "avg_power_w",
    "training_effect", "anaerobic_te", "raw_json",
]


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def _parse_gmt(ts: str | None) -> str | None:
    if not ts:
        return None
    # Garmin returns e.g. "2024-04-11 06:23:14" or ISO; normalise to ISO UTC.
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(ts, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return ts  # fall through — keep whatever Garmin gave us


def _int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def parse_activity(raw: dict) -> dict | None:
    aid = raw.get("activityId")
    if aid is None:
        return None

    start_local = raw.get("startTimeLocal") or ""
    day = start_local[:10] if start_local else None
    start_time = _parse_gmt(raw.get("startTimeGMT"))
    if not day or not start_time:
        return None

    duration = raw.get("duration")
    end_time = None
    if duration:
        try:
            end_dt = datetime.fromisoformat(start_time) + timedelta(seconds=float(duration))
            end_time = end_dt.isoformat()
        except ValueError:
            pass

    sport_type = (raw.get("activityType") or {}).get("typeKey")
    activity_type = (raw.get("eventType") or {}).get("typeKey")

    return {
        "activity_id": int(aid),
        "date": day,
        "start_time": start_time,
        "end_time": end_time,
        "name": raw.get("activityName"),
        "sport_type": sport_type,
        "activity_type": activity_type,
        "duration_sec": raw.get("duration"),
        "moving_time_sec": raw.get("movingDuration"),
        "distance_m": raw.get("distance"),
        "elevation_gain_m": raw.get("elevationGain"),
        "avg_hr": _int(raw.get("averageHR")),
        "max_hr": _int(raw.get("maxHR")),
        "avg_speed_mps": raw.get("averageSpeed"),
        "calories": _int(raw.get("calories")),
        "avg_power_w": raw.get("avgPower"),
        "training_effect": raw.get("aerobicTrainingEffect"),
        "anaerobic_te": raw.get("anaerobicTrainingEffect"),
        "raw_json": json.dumps(raw, separators=(",", ":")),
    }


def save_activities(conn: sqlite3.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    placeholders = ", ".join(["?"] * len(COLUMNS))
    sql = f"INSERT OR REPLACE INTO garmin_activities ({', '.join(COLUMNS)}) VALUES ({placeholders})"
    conn.executemany(sql, [[r[c] for c in COLUMNS] for r in rows])
    conn.commit()
    return len(rows)


def existing_max_start(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MAX(start_time) FROM garmin_activities").fetchone()
    return row[0]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sync Garmin Connect activities")
    p.add_argument("--full", action="store_true",
                   help="Re-fetch every activity (ignores incremental cutoff)")
    p.add_argument("--days", type=int,
                   help="Only keep activities from the last N days")
    p.add_argument("--since",
                   help="Hard cutoff date (YYYY-MM-DD) — overrides incremental")
    return p.parse_args()


def main():
    args = parse_args()

    print("Authenticating with Garmin Connect...")
    client = get_client()
    print("Authenticated.\n")

    conn = init_db()
    print(f"Database: {DB_PATH}")

    if args.full:
        cutoff_iso = None
        mode = "full"
    elif args.since:
        cutoff_iso = (
            datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc).isoformat()
        )
        mode = f"since {args.since}"
    elif args.days:
        cutoff_iso = (
            datetime.now(tz=timezone.utc) - timedelta(days=args.days)
        ).isoformat()
        mode = f"last {args.days} days"
    else:
        cutoff_iso = existing_max_start(conn)
        mode = f"incremental (> {cutoff_iso})" if cutoff_iso else "full (empty table)"

    print(f"Mode: {mode}\n")

    total_saved = 0
    start = 0
    retry_wait = 0
    t0 = time.time()

    while True:
        if retry_wait:
            time.sleep(retry_wait)
            retry_wait = 0

        try:
            page = client.get_activities(start=start, limit=PAGE_SIZE)
        except GarminConnectTooManyRequestsError:
            print("\n  Rate limited — waiting 60s...")
            time.sleep(60)
            retry_wait = 0
            try:
                page = client.get_activities(start=start, limit=PAGE_SIZE)
            except Exception as e:
                print(f"\n  Retry failed at offset {start}: {e}")
                break

        if not isinstance(page, list):
            print(f"\n  Unexpected response at offset {start}: {type(page).__name__}")
            break
        if not page:
            break

        parsed = [p for p in (parse_activity(r) for r in page) if p is not None]

        # Apply cutoff: keep only activities strictly newer than cutoff_iso.
        if cutoff_iso:
            kept = [p for p in parsed if p["start_time"] > cutoff_iso]
        else:
            kept = parsed

        saved = save_activities(conn, kept)
        total_saved += saved

        sys.stdout.write(
            f"\r  offset {start:>5} | page {len(page):>3} | kept {saved:>3} | total {total_saved:>5}   "
        )
        sys.stdout.flush()

        # Stop conditions.
        if len(page) < PAGE_SIZE:
            break
        if cutoff_iso and len(kept) < len(parsed):
            # This page crossed the cutoff boundary → nothing older on later pages is wanted.
            break

        start += PAGE_SIZE
        time.sleep(1)  # throttle

    elapsed = time.time() - t0
    print(f"\n\nDone. {total_saved} activities stored in {elapsed:.1f}s.")


if __name__ == "__main__":
    main()
