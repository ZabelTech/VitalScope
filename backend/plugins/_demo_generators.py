"""Fake-data generators used by plugin wrappers when VITALSCOPE_DEMO=1.

Each generator refreshes the last 7 days (or the whole 90-day window when
`full=True`) up to today, so clicking "Run now" in the demo UI visibly
writes rows without hitting any external API. Row shapes are shared with
`seed_demo.py` — the per-source seeders are imported lazily to avoid a
circular import (seed_demo itself imports `backend.app` for schema setup,
and `backend.app` imports this module transitively via plugin discovery).
"""

import random
import sqlite3
from datetime import date

INCREMENTAL_DAYS = 7
FULL_DAYS = 90


def _seed_module():
    import seed_demo
    return seed_demo


def _dates(full: bool) -> list[date]:
    sd = _seed_module()
    return sd.date_range(FULL_DAYS if full else INCREMENTAL_DAYS)


def _rng() -> random.Random:
    return random.Random(_seed_module().DEMO_SEED)


def run_if_demo(generator, *, full: bool) -> int | None:
    """Run `generator` against the live DB when DEMO_MODE is on.

    Returns the row count (so callers can surface it in RunResult) or
    `None` when demo mode is off, signalling the caller to fall through
    to the real sync path. Late-imports `backend.app` to dodge the
    plugin-registration / app-module circular import.
    """
    from backend.app import DB_PATH, DEMO_MODE
    if not DEMO_MODE:
        return None
    with sqlite3.connect(str(DB_PATH)) as conn:
        return generator(conn, full=full)


def generate_garmin_health(conn: sqlite3.Connection, full: bool) -> int:
    sd = _seed_module()
    dates = _dates(full)
    rng = _rng()
    n = 0
    n += sd.seed_heart_rate(conn, dates, rng)
    n += sd.seed_hrv(conn, dates, rng)
    n += sd.seed_body_battery(conn, dates, rng)
    n += sd.seed_sleep(conn, dates, rng)
    n += sd.seed_stress(conn, dates, rng)
    n += sd.seed_steps(conn, dates, rng)
    conn.commit()
    return n


def generate_garmin_activities(conn: sqlite3.Connection, full: bool) -> int:
    sd = _seed_module()
    n = sd.seed_activities(conn, _dates(full), _rng())
    conn.commit()
    return n


def generate_strong(conn: sqlite3.Connection, full: bool) -> int:
    sd = _seed_module()
    n = sd.seed_workouts(conn, _dates(full), _rng())
    conn.commit()
    return n


def generate_genome(conn: sqlite3.Connection, full: bool) -> int:
    sd = _seed_module()
    n = sd.seed_genome(conn)
    conn.commit()
    return n


def generate_eufy(conn: sqlite3.Connection, full: bool) -> int:
    # Look back further than the other plugins because weight is only
    # written on every other calendar day, and a 7-day window might not
    # include today's weigh-in — 14 days guarantees at least one new row.
    sd = _seed_module()
    days = FULL_DAYS if full else 14
    n = sd.seed_weight(conn, sd.date_range(days), _rng())
    conn.commit()
    return n
