#!/usr/bin/env python3
"""Sync health metrics from Garmin Connect and store in SQLite."""

import argparse
import os
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

TOKEN_DIR = Path("~/.garminconnect").expanduser()
DB_PATH = Path(__file__).parent / "vitalscope.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS heart_rate_daily (
    date         TEXT PRIMARY KEY,
    resting_hr   INTEGER,
    min_hr       INTEGER,
    max_hr       INTEGER,
    avg_7d_resting_hr INTEGER
);

CREATE TABLE IF NOT EXISTS heart_rate_readings (
    timestamp    TEXT NOT NULL,
    date         TEXT NOT NULL,
    heart_rate   INTEGER,
    PRIMARY KEY (date, timestamp)
);

CREATE TABLE IF NOT EXISTS hrv_daily (
    date             TEXT PRIMARY KEY,
    weekly_avg       INTEGER,
    last_night_avg   INTEGER,
    last_night_5min_high INTEGER,
    baseline_low_upper   INTEGER,
    baseline_balanced_low INTEGER,
    baseline_balanced_upper INTEGER
);

CREATE TABLE IF NOT EXISTS hrv_readings (
    timestamp    TEXT NOT NULL,
    date         TEXT NOT NULL,
    hrv_value    INTEGER,
    PRIMARY KEY (date, timestamp)
);

CREATE TABLE IF NOT EXISTS body_battery_daily (
    date         TEXT PRIMARY KEY,
    charged      INTEGER,
    drained      INTEGER
);

CREATE TABLE IF NOT EXISTS body_battery_readings (
    timestamp    TEXT NOT NULL,
    date         TEXT NOT NULL,
    level        INTEGER,
    PRIMARY KEY (date, timestamp)
);

CREATE TABLE IF NOT EXISTS sleep_daily (
    date                  TEXT PRIMARY KEY,
    sleep_time_seconds    INTEGER,
    deep_sleep_seconds    INTEGER,
    light_sleep_seconds   INTEGER,
    rem_sleep_seconds     INTEGER,
    awake_seconds         INTEGER,
    sleep_start           TEXT,
    sleep_end             TEXT,
    avg_spo2              REAL,
    avg_respiration       REAL,
    avg_sleep_stress      REAL,
    sleep_score           INTEGER,
    sleep_score_quality   TEXT,
    resting_hr            INTEGER
);

CREATE TABLE IF NOT EXISTS stress_daily (
    date             TEXT PRIMARY KEY,
    max_stress       INTEGER,
    avg_stress       INTEGER
);

CREATE TABLE IF NOT EXISTS stress_readings (
    timestamp    TEXT NOT NULL,
    date         TEXT NOT NULL,
    stress_level INTEGER,
    PRIMARY KEY (date, timestamp)
);

CREATE TABLE IF NOT EXISTS steps_daily (
    date           TEXT PRIMARY KEY,
    total_steps    INTEGER,
    total_distance_m INTEGER,
    step_goal      INTEGER
);
"""


def ms_to_iso(ms: int) -> str:
    """Convert millisecond epoch to ISO 8601 UTC string."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def get_client() -> Garmin:
    """Authenticate with Garmin Connect, reusing saved tokens when possible."""
    tokenstore = str(TOKEN_DIR)

    try:
        client = Garmin()
        client.login(tokenstore=tokenstore)
        return client
    except (GarminConnectAuthenticationError, FileNotFoundError):
        pass

    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not email or not password:
        raise SystemExit(
            "Set GARMIN_EMAIL and GARMIN_PASSWORD env vars, "
            "or log in once to populate the token store."
        )

    client = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("Enter MFA code: "),
    )
    client.login(tokenstore=tokenstore)
    return client


def save_heart_rate(conn: sqlite3.Connection, day: str, data: dict):
    if not data:
        return
    conn.execute(
        "INSERT OR REPLACE INTO heart_rate_daily VALUES (?, ?, ?, ?, ?)",
        (day, data.get("restingHeartRate"), data.get("minHeartRate"),
         data.get("maxHeartRate"), data.get("lastSevenDaysAvgRestingHeartRate")),
    )
    readings = data.get("heartRateValues") or []
    conn.executemany(
        "INSERT OR REPLACE INTO heart_rate_readings VALUES (?, ?, ?)",
        [(ms_to_iso(r[0]), day, r[1]) for r in readings if r[1] is not None],
    )


def save_hrv(conn: sqlite3.Connection, day: str, data: dict):
    if not data:
        return
    summary = data.get("hrvSummary") or {}
    baseline = summary.get("baseline") or {}
    conn.execute(
        "INSERT OR REPLACE INTO hrv_daily VALUES (?, ?, ?, ?, ?, ?, ?)",
        (day, summary.get("weeklyAvg"), summary.get("lastNightAvg"),
         summary.get("lastNight5MinHigh"), baseline.get("lowUpper"),
         baseline.get("balancedLow"), baseline.get("balancedUpper")),
    )
    readings = data.get("hrvReadings") or []
    conn.executemany(
        "INSERT OR REPLACE INTO hrv_readings VALUES (?, ?, ?)",
        [(r["readingTimeGMT"], day, r["hrvValue"]) for r in readings],
    )


def save_body_battery(conn: sqlite3.Connection, day: str, data: list):
    if not data:
        return
    entry = data[0]
    conn.execute(
        "INSERT OR REPLACE INTO body_battery_daily VALUES (?, ?, ?)",
        (day, entry.get("charged"), entry.get("drained")),
    )
    readings = entry.get("bodyBatteryValuesArray") or []
    conn.executemany(
        "INSERT OR REPLACE INTO body_battery_readings VALUES (?, ?, ?)",
        [(ms_to_iso(r[0]), day, r[1]) for r in readings],
    )


def save_sleep(conn: sqlite3.Connection, day: str, data: dict):
    if not data:
        return
    ds = data.get("dailySleepDTO") or {}
    scores = ds.get("sleepScores") or {}
    overall = scores.get("overall") or {}

    sleep_start = ds.get("sleepStartTimestampGMT")
    sleep_end = ds.get("sleepEndTimestampGMT")
    if isinstance(sleep_start, (int, float)):
        sleep_start = ms_to_iso(sleep_start)
    if isinstance(sleep_end, (int, float)):
        sleep_end = ms_to_iso(sleep_end)

    conn.execute(
        "INSERT OR REPLACE INTO sleep_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (day, ds.get("sleepTimeSeconds"), ds.get("deepSleepSeconds"),
         ds.get("lightSleepSeconds"), ds.get("remSleepSeconds"),
         ds.get("awakeSleepSeconds"), sleep_start, sleep_end,
         ds.get("averageSpO2Value"), ds.get("averageRespirationValue"),
         ds.get("avgSleepStress"), overall.get("value"),
         overall.get("qualifierKey"), data.get("restingHeartRate")),
    )


def save_stress(conn: sqlite3.Connection, day: str, data: dict):
    if not data:
        return
    conn.execute(
        "INSERT OR REPLACE INTO stress_daily VALUES (?, ?, ?)",
        (day, data.get("maxStressLevel"), data.get("avgStressLevel")),
    )
    readings = data.get("stressValuesArray") or []
    conn.executemany(
        "INSERT OR REPLACE INTO stress_readings VALUES (?, ?, ?)",
        [(ms_to_iso(r[0]), day, r[1]) for r in readings if r[1] >= 0],
    )


def save_steps_range(client: Garmin, conn: sqlite3.Connection, start: str, end: str):
    """Fetch daily step totals for [start, end] in one batched call and upsert."""
    try:
        rows = client.get_daily_steps(start, end) or []
    except Exception as e:
        print(f"\n  Warning: failed to fetch daily steps: {e}")
        return
    conn.executemany(
        "INSERT OR REPLACE INTO steps_daily VALUES (?, ?, ?, ?)",
        [
            (r.get("calendarDate"), r.get("totalSteps"),
             r.get("totalDistance"), r.get("stepGoal"))
            for r in rows if r.get("calendarDate")
        ],
    )
    conn.commit()


def fetch_and_save(client: Garmin, conn: sqlite3.Connection, day: str):
    """Fetch all metrics for a date and write to SQLite."""
    fetchers = {
        "heart_rate": (lambda: client.get_heart_rates(day), save_heart_rate),
        "hrv":        (lambda: client.get_hrv_data(day),    save_hrv),
        "body_battery": (lambda: client.get_body_battery(day), save_body_battery),
        "sleep":      (lambda: client.get_sleep_data(day),  save_sleep),
        "stress":     (lambda: client.get_stress_data(day), save_stress),
    }

    for name, (fetch, save_fn) in fetchers.items():
        try:
            data = fetch()
            save_fn(conn, day, data)
        except GarminConnectTooManyRequestsError:
            raise  # let caller handle retry
        except GarminConnectConnectionError as e:
            print(f"\n  Warning: failed to fetch {name} for {day}: {e}")
        except Exception as e:
            print(f"\n  Warning: unexpected error with {name} for {day}: {e}")

    conn.commit()


def format_eta(seconds: float) -> str:
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        return f"{int(seconds // 60)}m{int(seconds % 60):02d}s"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    return f"{h}h{m:02d}m"


def latest_synced_date(conn: sqlite3.Connection) -> date | None:
    """Return the most recent date present across all daily tables, or None."""
    tables = [
        "heart_rate_daily", "hrv_daily", "body_battery_daily",
        "sleep_daily", "stress_daily", "steps_daily",
    ]
    best: str | None = None
    for t in tables:
        try:
            row = conn.execute(f"SELECT MAX(date) FROM {t}").fetchone()
        except sqlite3.OperationalError:
            continue
        if row and row[0] and (best is None or row[0] > best):
            best = row[0]
    return date.fromisoformat(best) if best else None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync Garmin Connect health metrics")
    parser.add_argument(
        "--date", default=date.today().isoformat(),
        help="End date to sync (YYYY-MM-DD, default: today)",
    )
    parser.add_argument(
        "--days", type=int, default=None,
        help="Sync this many days backwards from --date. "
             "If omitted, resumes from the last synced day (default behaviour).",
    )
    parser.add_argument(
        "--since",
        help="Sync all days from this date to --date (YYYY-MM-DD, overrides --days)",
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Ignore existing DB state and resync the full range.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    end = date.fromisoformat(args.date)

    # Precedence: --since > --days > incremental default
    if args.since:
        start = date.fromisoformat(args.since)
        total_days = (end - start).days + 1
    elif args.days is not None:
        total_days = args.days
        start = end - timedelta(days=total_days - 1)
    else:
        # Incremental: resume from last synced day.
        # Always re-fetch the last 2 days to pick up intraday updates
        # (today's HR/stress/battery still trickle in; last night's sleep
        # is finalized the next morning).
        tmp_conn = sqlite3.connect(DB_PATH)
        latest = None if args.full else latest_synced_date(tmp_conn)
        tmp_conn.close()

        if latest is None:
            # No data yet — just sync today.
            start = end
        else:
            start = min(latest, end - timedelta(days=1))
        total_days = (end - start).days + 1

    print("Authenticating with Garmin Connect...")
    client = get_client()
    print("Authenticated.\n")

    conn = init_db()
    print(f"Database: {DB_PATH}")
    print(f"Syncing {total_days} days: {start.isoformat()} → {end.isoformat()}\n")

    t0 = time.time()
    errors = 0
    retry_wait = 0

    for i in range(total_days):
        day = (end - timedelta(days=i)).isoformat()
        done = i + 1
        pct = done / total_days * 100

        elapsed = time.time() - t0
        if i > 0:
            eta = elapsed / i * (total_days - i)
            eta_str = format_eta(eta)
        else:
            eta_str = "..."

        bar_len = 30
        filled = int(bar_len * done / total_days)
        bar = "█" * filled + "░" * (bar_len - filled)

        sys.stdout.write(
            f"\r{bar} {pct:5.1f}% | {done}/{total_days} | {day} | ETA {eta_str}   "
        )
        sys.stdout.flush()

        if retry_wait:
            time.sleep(retry_wait)
            retry_wait = 0

        try:
            fetch_and_save(client, conn, day)
        except GarminConnectTooManyRequestsError:
            retry_wait = 60
            errors += 1
            sys.stdout.write(f"\n  Rate limited — waiting 60s...\n")
            sys.stdout.flush()
            time.sleep(60)
            # retry the same day
            try:
                fetch_and_save(client, conn, day)
            except Exception as e:
                sys.stdout.write(f"\n  Retry failed for {day}: {e}\n")
                sys.stdout.flush()

        # throttle to avoid rate limits
        if i < total_days - 1:
            time.sleep(1)

    print("\n\nFetching daily steps...")
    save_steps_range(client, conn, start.isoformat(), end.isoformat())

    elapsed = time.time() - t0
    print(f"Done. {total_days} days synced in {format_eta(elapsed)}."
          + (f" ({errors} rate-limit retries)" if errors else ""))


if __name__ == "__main__":
    main()
