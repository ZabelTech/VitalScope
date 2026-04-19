#!/usr/bin/env python3
"""Sync workout data from Strong gym tracker into SQLite.

Uses Strong's new REST API at back.strong.app (Azure-hosted).
WARNING: Strong has no public API. Account termination is possible.
"""

import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

DB_PATH = Path(os.environ.get("VITALSCOPE_DB") or Path(__file__).parent / "vitalscope.db")
TOKEN_PATH = Path("~/.strongapp").expanduser()

BASE_URL = "https://back.strong.app"
PAGE_SIZE = 500

HEADERS = {
    "user-agent": "Strong Android",
    "content-type": "application/json",
    "accept": "application/json",
    "x-client-build": "600013",
    "x-client-platform": "android",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS workouts (
    id           TEXT PRIMARY KEY,
    date         TEXT NOT NULL,
    end_date     TEXT,
    name         TEXT,
    duration_sec INTEGER,
    notes        TEXT
);

CREATE TABLE IF NOT EXISTS workout_sets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id   TEXT NOT NULL REFERENCES workouts(id),
    exercise     TEXT NOT NULL,
    set_order    INTEGER,
    set_type     TEXT NOT NULL DEFAULT 'working',
    weight_kg    REAL,
    reps         INTEGER,
    seconds      INTEGER,
    distance_m   REAL,
    is_pr        INTEGER DEFAULT 0,
    rpe          REAL,
    UNIQUE(workout_id, set_order)
);
"""


# ----- Session management -----

def _load_session() -> dict | None:
    if TOKEN_PATH.exists():
        try:
            return json.loads(TOKEN_PATH.read_text())
        except (json.JSONDecodeError, KeyError):
            pass
    return None


def _save_session(data: dict):
    TOKEN_PATH.write_text(json.dumps(data))
    TOKEN_PATH.chmod(0o600)


def login(email: str, password: str) -> dict:
    """POST /auth/login. Returns session dict with access/refresh token + user_id."""
    r = requests.post(
        f"{BASE_URL}/auth/login",
        headers=HEADERS,
        json={"usernameOrEmail": email, "password": password},
        timeout=30,
    )
    if r.status_code != 200:
        raise SystemExit(f"Login failed ({r.status_code}): {r.text}")

    data = r.json()
    session = {
        "access_token": data["accessToken"],
        "refresh_token": data["refreshToken"],
        "user_id": data["userId"],
        "expires_at": int(time.time()) + int(data.get("expiresIn", 1200)),
    }
    _save_session(session)
    return session


def refresh(session: dict) -> dict:
    """POST /auth/login/refresh to get a new access token."""
    r = requests.post(
        f"{BASE_URL}/auth/login/refresh",
        headers={**HEADERS, "authorization": f"Bearer {session['access_token']}"},
        json={
            "accessToken": session["access_token"],
            "refreshToken": session["refresh_token"],
        },
        timeout=30,
    )
    if r.status_code != 200:
        return {}

    data = r.json()
    session["access_token"] = data["accessToken"]
    session["refresh_token"] = data["refreshToken"]
    session["expires_at"] = int(time.time()) + int(data.get("expiresIn", 1200))
    _save_session(session)
    return session


def get_session() -> dict:
    """Load session from disk, refresh if expired, else login with env vars."""
    saved = _load_session()
    now = int(time.time())

    if saved and saved.get("expires_at", 0) > now + 60:
        return saved

    if saved:
        refreshed = refresh(saved)
        if refreshed:
            return refreshed

    email = os.environ.get("STRONG_EMAIL")
    password = os.environ.get("STRONG_PASSWORD")
    if not email or not password:
        raise SystemExit(
            "Set STRONG_EMAIL and STRONG_PASSWORD env vars for first login."
        )
    return login(email, password)


def _auth_headers(session: dict) -> dict:
    return {**HEADERS, "authorization": f"Bearer {session['access_token']}"}


# ----- Fetching -----

def fetch_user_data(session: dict, includes: list[str], limit: int = PAGE_SIZE):
    """Paginated fetch of /api/users/{userId} with includes. Yields each page response."""
    user_id = session["user_id"]
    continuation = ""

    while True:
        params = [("limit", str(limit)), ("continuation", continuation)]
        for inc in includes:
            params.append(("include", inc))

        r = requests.get(
            f"{BASE_URL}/api/users/{user_id}",
            headers=_auth_headers(session),
            params=params,
            timeout=60,
        )
        if r.status_code == 401:
            # Token may have expired mid-sync; refresh once and retry
            refreshed = refresh(session)
            if not refreshed:
                raise SystemExit("Session refresh failed; please re-login.")
            session.update(refreshed)
            continue
        if r.status_code != 200:
            raise SystemExit(f"Fetch failed ({r.status_code}): {r.text[:500]}")

        data = r.json()
        yield data

        next_link = data.get("_links", {}).get("next", {}).get("href")
        if not next_link:
            break

        # Extract continuation token from next link
        if "continuation=" in next_link:
            continuation = next_link.split("continuation=")[1].split("&")[0]
        else:
            break


def fetch_all_logs_and_measurements(
    session: dict,
    known_ids: set[str] | None = None,
) -> tuple[list[dict], dict[str, str]]:
    """Fetch workout logs and a measurement_id → exercise_name map.

    If `known_ids` is provided, stops paginating once all logs on a page
    are already known (incremental sync).
    """
    all_logs: list[dict] = []
    measurements: dict[str, str] = {}
    known_ids = known_ids or set()
    incremental = bool(known_ids)
    stop_after_page = False

    # Measurements + logs come back on the same endpoint.
    # Measurements are returned in full on every page, so we only need to
    # extract them on the first page. Logs continue paginating.
    print("  Fetching logs + measurements...", flush=True)
    page_n = 0
    for page in fetch_user_data(session, includes=["log", "measurement"], limit=PAGE_SIZE):
        page_n += 1

        if page_n == 1:
            for m in page.get("_embedded", {}).get("measurement", []):
                name_obj = m.get("name") or {}
                if isinstance(name_obj, dict):
                    name = name_obj.get("en") or next(iter(name_obj.values()), "Unknown")
                else:
                    name = str(name_obj)
                measurements[m["id"]] = name
            print(f"    Found {len(measurements)} measurements on page 1.", flush=True)

        logs = page.get("_embedded", {}).get("log", [])
        if not logs:
            # API keeps returning _links.next with empty pages — stop here.
            break

        new_logs = [l for l in logs if l.get("id") not in known_ids]
        all_logs.extend(new_logs)

        if page_n % 5 == 0:
            print(f"    logs: page {page_n}, {len(all_logs)} new "
                  f"(page had {len(logs)}, {len(logs) - len(new_logs)} known)",
                  flush=True)

        # Incremental stop: when a page contains no new logs, assume older
        # pages are all known. Logs appear newest-first in the response.
        if incremental and not new_logs:
            print(f"    Reached already-synced logs on page {page_n}, stopping.", flush=True)
            break

    print(f"    Total: {len(all_logs)} new logs across {page_n} pages.", flush=True)
    return all_logs, measurements


# ----- Parsing & saving -----

def _extract_name(name_obj) -> str:
    if isinstance(name_obj, dict):
        return name_obj.get("en") or next(iter(name_obj.values()), "") or ""
    return str(name_obj or "")


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_log(log: dict, measurements: dict[str, str]) -> tuple[dict, list[dict]]:
    """Convert a Strong log into (workout_row, sets_rows)."""
    workout_id = log["id"]
    start = _parse_iso(log.get("startDate"))
    end = _parse_iso(log.get("endDate"))
    duration = int((end - start).total_seconds()) if (start and end) else None
    date_str = start.date().isoformat() if start else None

    workout = {
        "id": workout_id,
        "date": date_str,
        "end_date": log.get("endDate"),
        "name": _extract_name(log.get("name")),
        "duration_sec": duration,
        "notes": log.get("notes") or "",
    }

    sets_rows = []
    set_order = 0
    set_groups = log.get("_embedded", {}).get("cellSetGroup", [])

    for sg in set_groups:
        # Extract measurement ID from _links.measurement.href
        href = sg.get("_links", {}).get("measurement", {}).get("href", "")
        measurement_id = href.rsplit("/", 1)[-1] if href else ""
        exercise_name = measurements.get(measurement_id, f"Unknown ({measurement_id[:8]})")

        for cs in sg.get("cellSets", []):
            if not cs.get("isCompleted", False):
                continue
            cells = {c.get("cellType"): c.get("value") for c in cs.get("cells", [])}

            def _num(key):
                v = cells.get(key)
                try:
                    return float(v) if v is not None else None
                except (ValueError, TypeError):
                    return None

            # Rest-timer-only cellSet → mark as rest, store duration in seconds
            data_keys = set(cells.keys()) - {"REST_TIMER"}
            if not data_keys:
                rest_sec = _num("REST_TIMER")
                if rest_sec is None:
                    continue
                set_order += 1
                sets_rows.append({
                    "workout_id": workout_id,
                    "exercise": exercise_name,
                    "set_order": set_order,
                    "set_type": "rest",
                    "weight_kg": None,
                    "reps": None,
                    "seconds": int(rest_sec),
                    "distance_m": None,
                    "is_pr": 0,
                    "rpe": None,
                })
                continue

            # Working set — pull weight from any *_WEIGHT cellType
            weight_kg = None
            for k, v in cells.items():
                if k and "WEIGHT" in k and v is not None:
                    try:
                        weight_kg = float(v)
                        break
                    except (ValueError, TypeError):
                        pass

            reps = _num("REPS")
            seconds = _num("DURATION") or _num("TIME")
            distance_m = _num("DISTANCE")
            rpe = _num("RPE")

            set_order += 1
            sets_rows.append({
                "workout_id": workout_id,
                "exercise": exercise_name,
                "set_order": set_order,
                "set_type": "working",
                "weight_kg": weight_kg,
                "reps": int(reps) if reps is not None else None,
                "seconds": int(seconds) if seconds is not None else None,
                "distance_m": distance_m,
                "is_pr": 0,
                "rpe": rpe,
            })

    return workout, sets_rows


def save_logs(conn: sqlite3.Connection, logs: list[dict], measurements: dict[str, str]):
    for log in logs:
        workout, sets = parse_log(log, measurements)
        conn.execute(
            "INSERT OR REPLACE INTO workouts VALUES (?, ?, ?, ?, ?, ?)",
            (workout["id"], workout["date"], workout["end_date"],
             workout["name"], workout["duration_sec"], workout["notes"]),
        )
        conn.execute("DELETE FROM workout_sets WHERE workout_id = ?", (workout["id"],))
        for s in sets:
            conn.execute(
                "INSERT INTO workout_sets "
                "(workout_id, exercise, set_order, set_type, weight_kg, reps, seconds, distance_m, is_pr, rpe) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (s["workout_id"], s["exercise"], s["set_order"], s["set_type"],
                 s["weight_kg"], s["reps"], s["seconds"], s["distance_m"], s["is_pr"], s["rpe"]),
            )
    conn.commit()


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def main():
    full = "--full" in sys.argv

    print("Authenticating with Strong...")
    session = get_session()
    print(f"Authenticated as user {session['user_id']}.\n")

    conn = init_db()

    if full:
        print("Full resync requested.")
        known_ids: set[str] = set()
    else:
        known_ids = {row[0] for row in conn.execute("SELECT id FROM workouts")}
        if known_ids:
            print(f"Incremental sync: {len(known_ids)} workouts already in DB.")

    logs, measurements = fetch_all_logs_and_measurements(session, known_ids=known_ids)
    workout_logs = [l for l in logs if l.get("logType") == "WORKOUT"]
    print(f"\nFetched {len(logs)} new logs ({len(workout_logs)} workouts).")

    if workout_logs:
        print("Saving to database...")
        save_logs(conn, workout_logs, measurements)

    total = conn.execute("SELECT COUNT(*) FROM workouts").fetchone()[0]
    total_sets = conn.execute("SELECT COUNT(*) FROM workout_sets").fetchone()[0]
    print(f"  Database: {total} workouts, {total_sets} sets.")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
