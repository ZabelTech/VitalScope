"""FastAPI backend serving VitalScope health data from SQLite."""

import asyncio
import json
import logging
import math
import os
import sqlite3
import statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.plugins import REGISTRY as PLUGIN_REGISTRY, discover as discover_plugins
from backend.plugins.base import Plugin

DB_PATH = Path(os.environ.get("VITALSCOPE_DB", Path(__file__).parent.parent / "vitalscope.db"))
DEMO_MODE = os.environ.get("VITALSCOPE_DEMO") == "1"
ENV_NAME = os.environ.get("VITALSCOPE_ENV", "dev")
BUILD_SHA = os.environ.get("VITALSCOPE_SHA", "")

app = FastAPI(title="VitalScope API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


@app.get("/api/runtime")
def runtime_info():
    return {"demo": DEMO_MODE, "env": ENV_NAME, "commit": BUILD_SHA}


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def ensure_journal_table() -> None:
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS journal_entries (
            date TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            followed_supplements INTEGER NOT NULL,
            drank_alcohol INTEGER NOT NULL,
            alcohol_amount TEXT,
            morning_feeling TEXT NOT NULL,
            notes TEXT
        )
        """
    )
    conn.commit()
    conn.close()


ensure_journal_table()


def ensure_supplement_tables() -> None:
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS supplements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            dosage TEXT NOT NULL,
            time_of_day TEXT NOT NULL CHECK (time_of_day IN ('morning','noon','evening')),
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS journal_supplement_intake (
            date TEXT NOT NULL,
            supplement_id INTEGER NOT NULL,
            taken INTEGER NOT NULL,
            PRIMARY KEY (date, supplement_id),
            FOREIGN KEY (supplement_id) REFERENCES supplements(id) ON DELETE CASCADE
        )
        """
    )
    conn.commit()
    conn.close()


ensure_supplement_tables()


NUTRIENT_SEED = [
    ("calories_kcal", "Calories", "kcal", "macro", 0),
    ("protein_g", "Protein", "g", "macro", 1),
    ("carbs_g", "Carbs", "g", "macro", 2),
    ("sugar_g", "Sugar", "g", "macro", 3),
    ("fiber_g", "Fiber", "g", "macro", 4),
    ("fat_g", "Fat", "g", "macro", 5),
    ("saturated_fat_g", "Saturated Fat", "g", "macro", 6),
    ("unsaturated_fat_g", "Unsaturated Fat", "g", "macro", 7),
    ("calcium_mg", "Calcium", "mg", "mineral", 0),
    ("iron_mg", "Iron", "mg", "mineral", 1),
    ("magnesium_mg", "Magnesium", "mg", "mineral", 2),
    ("phosphorus_mg", "Phosphorus", "mg", "mineral", 3),
    ("potassium_mg", "Potassium", "mg", "mineral", 4),
    ("sodium_mg", "Sodium", "mg", "mineral", 5),
    ("zinc_mg", "Zinc", "mg", "mineral", 6),
    ("copper_mg", "Copper", "mg", "mineral", 7),
    ("manganese_mg", "Manganese", "mg", "mineral", 8),
    ("selenium_ug", "Selenium", "ug", "mineral", 9),
    ("iodine_ug", "Iodine", "ug", "mineral", 10),
    ("vitamin_a_ug", "Vitamin A", "ug", "vitamin", 0),
    ("vitamin_c_mg", "Vitamin C", "mg", "vitamin", 1),
    ("vitamin_d_ug", "Vitamin D", "ug", "vitamin", 2),
    ("vitamin_e_mg", "Vitamin E", "mg", "vitamin", 3),
    ("vitamin_k_ug", "Vitamin K", "ug", "vitamin", 4),
    ("vitamin_b1_mg", "Vitamin B1 (Thiamin)", "mg", "vitamin", 5),
    ("vitamin_b2_mg", "Vitamin B2 (Riboflavin)", "mg", "vitamin", 6),
    ("vitamin_b3_mg", "Vitamin B3 (Niacin)", "mg", "vitamin", 7),
    ("vitamin_b5_mg", "Vitamin B5 (Pantothenic)", "mg", "vitamin", 8),
    ("vitamin_b6_mg", "Vitamin B6", "mg", "vitamin", 9),
    ("vitamin_b7_ug", "Vitamin B7 (Biotin)", "ug", "vitamin", 10),
    ("vitamin_b9_ug", "Vitamin B9 (Folate)", "ug", "vitamin", 11),
    ("vitamin_b12_ug", "Vitamin B12", "ug", "vitamin", 12),
    ("omega3_mg", "Omega-3", "mg", "bioactive", 0),
    ("omega6_mg", "Omega-6", "mg", "bioactive", 1),
    ("caffeine_mg", "Caffeine", "mg", "bioactive", 2),
    ("polyphenols_mg", "Polyphenols", "mg", "bioactive", 3),
    ("cholesterol_mg", "Cholesterol", "mg", "bioactive", 4),
]


def ensure_nutrition_tables() -> None:
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS nutrient_defs (
            key TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            unit TEXT NOT NULL,
            category TEXT NOT NULL CHECK (category IN ('macro','mineral','vitamin','bioactive')),
            sort_order INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            time TEXT,
            name TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meal_nutrients (
            meal_id INTEGER NOT NULL,
            nutrient_key TEXT NOT NULL,
            amount REAL NOT NULL,
            PRIMARY KEY (meal_id, nutrient_key),
            FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
            FOREIGN KEY (nutrient_key) REFERENCES nutrient_defs(key)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS water_intake (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            time TEXT,
            amount_ml INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_water_date ON water_intake(date)")
    conn.executemany(
        """
        INSERT OR IGNORE INTO nutrient_defs (key, label, unit, category, sort_order)
        VALUES (?, ?, ?, ?, ?)
        """,
        NUTRIENT_SEED,
    )
    conn.commit()
    conn.close()


ensure_nutrition_tables()


# --- Vendor data: tables (write targets for sync plugins) + views (read API) ---
#
# Rule: endpoints read only from v_* views. Vendor tables are write-only
# targets for plugins. Swapping providers or adding a second source becomes a
# view-definition change, not a find-and-replace across endpoints.

VENDOR_TABLE_SCHEMA = """
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


VENDOR_VIEWS = """
CREATE VIEW IF NOT EXISTS v_heart_rate_daily AS
SELECT date, resting_hr, min_hr, max_hr, avg_7d_resting_hr
FROM heart_rate_daily;

CREATE VIEW IF NOT EXISTS v_hrv_daily AS
SELECT date, weekly_avg, last_night_avg, last_night_5min_high,
       baseline_low_upper, baseline_balanced_low, baseline_balanced_upper
FROM hrv_daily;

CREATE VIEW IF NOT EXISTS v_body_battery_daily AS
SELECT date, charged, drained
FROM body_battery_daily;

CREATE VIEW IF NOT EXISTS v_body_battery_readings AS
SELECT timestamp, date, level
FROM body_battery_readings;

CREATE VIEW IF NOT EXISTS v_sleep_daily AS
SELECT date, sleep_time_seconds, deep_sleep_seconds, light_sleep_seconds,
       rem_sleep_seconds, awake_seconds, sleep_start, sleep_end,
       avg_spo2, avg_respiration, avg_sleep_stress,
       sleep_score, sleep_score_quality, resting_hr
FROM sleep_daily;

CREATE VIEW IF NOT EXISTS v_stress_daily AS
SELECT date, max_stress, avg_stress
FROM stress_daily;

CREATE VIEW IF NOT EXISTS v_steps_daily AS
SELECT date, total_steps, total_distance_m, step_goal
FROM steps_daily;

CREATE VIEW IF NOT EXISTS v_weight_daily AS
SELECT date, weight_kg, body_fat_pct, muscle_mass_kg, bone_mass_kg,
       water_pct, bmi, visceral_fat, bmr, protein_pct,
       lean_body_mass_kg, body_age, heart_rate
FROM weight_daily;

CREATE VIEW IF NOT EXISTS v_activities AS
SELECT 'garmin' AS source,
       activity_id, date, start_time, end_time, name,
       sport_type, activity_type,
       duration_sec, moving_time_sec, distance_m, elevation_gain_m,
       avg_hr, max_hr, avg_speed_mps, calories, avg_power_w,
       training_effect, anaerobic_te
FROM garmin_activities;

CREATE VIEW IF NOT EXISTS v_workouts AS
SELECT 'strong' AS source,
       id, date, end_date, name, duration_sec, notes
FROM workouts;

CREATE VIEW IF NOT EXISTS v_workout_sets AS
SELECT workout_id, exercise, set_order, set_type,
       weight_kg, reps, seconds, distance_m, rpe
FROM workout_sets;
"""


def ensure_vendor_tables() -> None:
    conn = get_db()
    conn.executescript(VENDOR_TABLE_SCHEMA)
    conn.commit()
    conn.close()


def ensure_vendor_views() -> None:
    conn = get_db()
    conn.executescript(VENDOR_VIEWS)
    conn.commit()
    conn.close()


ensure_vendor_tables()
ensure_vendor_views()


def default_range(
    start: Optional[str], end: Optional[str]
) -> tuple[str, str]:
    end_date = end or date.today().isoformat()
    start_date = start or (date.fromisoformat(end_date) - timedelta(days=90)).isoformat()
    return start_date, end_date


def query_daily(table: str, start: str, end: str) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        f"SELECT * FROM {table} WHERE date >= ? AND date <= ? ORDER BY date",
        (start, end),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def compute_stats(values: list[float]) -> dict:
    if not values:
        return {"min": None, "max": None, "avg": None, "median": None, "volatility": None}
    return {
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "avg": round(statistics.mean(values), 2),
        "median": round(statistics.median(values), 2),
        "volatility": round(statistics.stdev(values), 2) if len(values) > 1 else 0,
    }


# --- Daily endpoints ---

@app.get("/api/heart-rate/daily")
def heart_rate_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return query_daily("v_heart_rate_daily", s, e)


@app.get("/api/hrv/daily")
def hrv_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return query_daily("v_hrv_daily", s, e)


@app.get("/api/body-battery/daily")
def body_battery_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return query_daily("v_body_battery_daily", s, e)


@app.get("/api/body-battery/current")
def body_battery_current():
    """Latest body battery level + today's min/max from intraday readings."""
    conn = get_db()
    row = conn.execute(
        """SELECT
              date,
              (SELECT level FROM v_body_battery_readings
                WHERE date = r.date ORDER BY timestamp DESC LIMIT 1) AS current,
              MIN(level) AS min,
              MAX(level) AS max,
              (SELECT timestamp FROM v_body_battery_readings
                WHERE date = r.date ORDER BY timestamp DESC LIMIT 1) AS updated_at
           FROM v_body_battery_readings r
           WHERE date = (SELECT MAX(date) FROM v_body_battery_readings)
           GROUP BY date"""
    ).fetchone()
    conn.close()
    return dict(row) if row else {}


@app.get("/api/sleep/daily")
def sleep_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return query_daily("v_sleep_daily", s, e)


@app.get("/api/stress/daily")
def stress_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return query_daily("v_stress_daily", s, e)


@app.get("/api/weight/daily")
def weight_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return query_daily("v_weight_daily", s, e)


@app.get("/api/steps/daily")
def steps_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return query_daily("v_steps_daily", s, e)


# --- Stats endpoints ---

def stats_for_column(table: str, column: str, start: str, end: str) -> dict:
    conn = get_db()
    rows = conn.execute(
        f"SELECT {column} FROM {table} WHERE date >= ? AND date <= ? AND {column} IS NOT NULL",
        (start, end),
    ).fetchall()
    conn.close()
    values = [r[0] for r in rows]
    return compute_stats(values)


@app.get("/api/heart-rate/stats")
def heart_rate_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return {"resting_hr": stats_for_column("v_heart_rate_daily", "resting_hr", s, e)}


@app.get("/api/hrv/stats")
def hrv_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return {"weekly_avg": stats_for_column("v_hrv_daily", "weekly_avg", s, e)}


@app.get("/api/body-battery/stats")
def body_battery_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return {"charged": stats_for_column("v_body_battery_daily", "charged", s, e)}


@app.get("/api/sleep/stats")
def sleep_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return {
        "sleep_score": stats_for_column("v_sleep_daily", "sleep_score", s, e),
        "sleep_hours": compute_stats([
            v / 3600 for v in
            [r[0] for r in get_db().execute(
                "SELECT sleep_time_seconds FROM v_sleep_daily WHERE date >= ? AND date <= ? AND sleep_time_seconds IS NOT NULL",
                (s, e),
            ).fetchall()]
        ]),
    }


@app.get("/api/stress/stats")
def stress_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return {"avg_stress": stats_for_column("v_stress_daily", "avg_stress", s, e)}


@app.get("/api/weight/stats")
def weight_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return {
        "weight_kg": stats_for_column("v_weight_daily", "weight_kg", s, e),
        "bmi": stats_for_column("v_weight_daily", "bmi", s, e),
        "body_fat_pct": stats_for_column("v_weight_daily", "body_fat_pct", s, e),
        "water_pct": stats_for_column("v_weight_daily", "water_pct", s, e),
    }


@app.get("/api/steps/stats")
def steps_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    return {"total_steps": stats_for_column("v_steps_daily", "total_steps", s, e)}


# --- Date range ---

# --- Journal ---

class JournalEntry(BaseModel):
    date: str
    followed_supplements: bool
    drank_alcohol: bool
    alcohol_amount: Optional[str] = None
    morning_feeling: Literal["sleepy", "energetic", "normal", "sick"]
    notes: Optional[str] = None


@app.post("/api/journal")
def upsert_journal(entry: JournalEntry):
    conn = get_db()
    conn.execute(
        """
        INSERT INTO journal_entries
            (date, created_at, followed_supplements, drank_alcohol,
             alcohol_amount, morning_feeling, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            created_at = excluded.created_at,
            followed_supplements = excluded.followed_supplements,
            drank_alcohol = excluded.drank_alcohol,
            alcohol_amount = excluded.alcohol_amount,
            morning_feeling = excluded.morning_feeling,
            notes = excluded.notes
        """,
        (
            entry.date,
            datetime.utcnow().isoformat(timespec="seconds"),
            int(entry.followed_supplements),
            int(entry.drank_alcohol),
            entry.alcohol_amount if entry.drank_alcohol else None,
            entry.morning_feeling,
            entry.notes,
        ),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "date": entry.date}


def _row_to_journal(row: sqlite3.Row) -> dict:
    return {
        "date": row["date"],
        "created_at": row["created_at"],
        "followed_supplements": bool(row["followed_supplements"]),
        "drank_alcohol": bool(row["drank_alcohol"]),
        "alcohol_amount": row["alcohol_amount"],
        "morning_feeling": row["morning_feeling"],
        "notes": row["notes"],
    }


@app.get("/api/journal/{entry_date}")
def get_journal(entry_date: str):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM journal_entries WHERE date = ?", (entry_date,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No journal entry for that date")
    return _row_to_journal(row)


@app.get("/api/journal")
def list_journal(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM journal_entries WHERE date >= ? AND date <= ? ORDER BY date",
        (s, e),
    ).fetchall()
    conn.close()
    return [_row_to_journal(r) for r in rows]


# --- Supplements ---

TIME_OF_DAY_ORDER = {"morning": 0, "noon": 1, "evening": 2}


class SupplementIn(BaseModel):
    name: str
    dosage: str
    time_of_day: Literal["morning", "noon", "evening"]
    sort_order: int = 0


def _row_to_supplement(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "dosage": row["dosage"],
        "time_of_day": row["time_of_day"],
        "sort_order": row["sort_order"],
    }


@app.get("/api/supplements")
def list_supplements():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT * FROM supplements
        ORDER BY CASE time_of_day
            WHEN 'morning' THEN 0
            WHEN 'noon' THEN 1
            WHEN 'evening' THEN 2
        END, sort_order, id
        """
    ).fetchall()
    conn.close()
    return [_row_to_supplement(r) for r in rows]


@app.post("/api/supplements")
def create_supplement(body: SupplementIn):
    conn = get_db()
    cur = conn.execute(
        """
        INSERT INTO supplements (name, dosage, time_of_day, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            body.name.strip(),
            body.dosage.strip(),
            body.time_of_day,
            body.sort_order,
            datetime.utcnow().isoformat(timespec="seconds"),
        ),
    )
    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM supplements WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return _row_to_supplement(row)


@app.put("/api/supplements/{sid}")
def update_supplement(sid: int, body: SupplementIn):
    conn = get_db()
    cur = conn.execute(
        """
        UPDATE supplements
        SET name = ?, dosage = ?, time_of_day = ?, sort_order = ?
        WHERE id = ?
        """,
        (body.name.strip(), body.dosage.strip(), body.time_of_day, body.sort_order, sid),
    )
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Supplement not found")
    conn.commit()
    row = conn.execute("SELECT * FROM supplements WHERE id = ?", (sid,)).fetchone()
    conn.close()
    return _row_to_supplement(row)


@app.delete("/api/supplements/{sid}")
def delete_supplement(sid: int):
    conn = get_db()
    conn.execute("DELETE FROM journal_supplement_intake WHERE supplement_id = ?", (sid,))
    cur = conn.execute("DELETE FROM supplements WHERE id = ?", (sid,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Supplement not found")
    return {"status": "ok"}


class IntakeItem(BaseModel):
    supplement_id: int
    taken: bool


class IntakeBody(BaseModel):
    items: list[IntakeItem]


@app.get("/api/journal/{entry_date}/supplements")
def get_journal_supplements(entry_date: str):
    conn = get_db()
    rows = conn.execute(
        """
        SELECT s.*, COALESCE(i.taken, 1) AS taken
        FROM supplements s
        LEFT JOIN journal_supplement_intake i
            ON i.supplement_id = s.id AND i.date = ?
        ORDER BY CASE s.time_of_day
            WHEN 'morning' THEN 0
            WHEN 'noon' THEN 1
            WHEN 'evening' THEN 2
        END, s.sort_order, s.id
        """,
        (entry_date,),
    ).fetchall()
    conn.close()
    return [{**_row_to_supplement(r), "taken": bool(r["taken"])} for r in rows]


@app.post("/api/journal/{entry_date}/supplements")
def save_journal_supplements(entry_date: str, body: IntakeBody):
    conn = get_db()
    for item in body.items:
        conn.execute(
            """
            INSERT INTO journal_supplement_intake (date, supplement_id, taken)
            VALUES (?, ?, ?)
            ON CONFLICT(date, supplement_id) DO UPDATE SET taken = excluded.taken
            """,
            (entry_date, item.supplement_id, int(item.taken)),
        )
    conn.commit()
    conn.close()
    return {"status": "ok", "date": entry_date, "count": len(body.items)}


# --- Nutrition ---

CATEGORY_ORDER_SQL = """CASE category
    WHEN 'macro' THEN 0
    WHEN 'mineral' THEN 1
    WHEN 'vitamin' THEN 2
    WHEN 'bioactive' THEN 3
END"""


class NutrientDefIn(BaseModel):
    key: str
    label: str
    unit: str
    category: Literal["macro", "mineral", "vitamin", "bioactive"]
    sort_order: int = 0


class MealNutrientIn(BaseModel):
    nutrient_key: str
    amount: float


class MealIn(BaseModel):
    date: str
    time: Optional[str] = None
    name: str
    notes: Optional[str] = None
    nutrients: list[MealNutrientIn] = []


class WaterIn(BaseModel):
    date: str
    time: Optional[str] = None
    amount_ml: int


def _row_to_nutrient_def(row: sqlite3.Row) -> dict:
    return {
        "key": row["key"],
        "label": row["label"],
        "unit": row["unit"],
        "category": row["category"],
        "sort_order": row["sort_order"],
    }


@app.get("/api/nutrients/definitions")
def list_nutrient_defs():
    conn = get_db()
    rows = conn.execute(
        f"SELECT * FROM nutrient_defs ORDER BY {CATEGORY_ORDER_SQL}, sort_order, key"
    ).fetchall()
    conn.close()
    return [_row_to_nutrient_def(r) for r in rows]


@app.post("/api/nutrients/definitions")
def create_nutrient_def(body: NutrientDefIn):
    conn = get_db()
    try:
        conn.execute(
            """
            INSERT INTO nutrient_defs (key, label, unit, category, sort_order)
            VALUES (?, ?, ?, ?, ?)
            """,
            (body.key.strip(), body.label.strip(), body.unit.strip(), body.category, body.sort_order),
        )
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=409, detail="Nutrient key already exists")
    conn.commit()
    row = conn.execute("SELECT * FROM nutrient_defs WHERE key = ?", (body.key.strip(),)).fetchone()
    conn.close()
    return _row_to_nutrient_def(row)


@app.delete("/api/nutrients/definitions/{key}")
def delete_nutrient_def(key: str):
    conn = get_db()
    used = conn.execute(
        "SELECT 1 FROM meal_nutrients WHERE nutrient_key = ? LIMIT 1", (key,)
    ).fetchone()
    if used:
        conn.close()
        raise HTTPException(status_code=409, detail="Nutrient is referenced by meals")
    cur = conn.execute("DELETE FROM nutrient_defs WHERE key = ?", (key,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Nutrient not found")
    return {"status": "ok"}


def _fetch_meals(conn: sqlite3.Connection, where: str, params: tuple) -> list[dict]:
    meal_rows = conn.execute(
        f"SELECT * FROM meals {where} ORDER BY date, time, id", params
    ).fetchall()
    if not meal_rows:
        return []
    meal_ids = [r["id"] for r in meal_rows]
    placeholders = ",".join("?" * len(meal_ids))
    nutrient_rows = conn.execute(
        f"SELECT meal_id, nutrient_key, amount FROM meal_nutrients WHERE meal_id IN ({placeholders})",
        meal_ids,
    ).fetchall()
    by_meal: dict[int, list[dict]] = {mid: [] for mid in meal_ids}
    for r in nutrient_rows:
        by_meal[r["meal_id"]].append({"key": r["nutrient_key"], "amount": r["amount"]})
    return [
        {
            "id": r["id"],
            "date": r["date"],
            "time": r["time"],
            "name": r["name"],
            "notes": r["notes"],
            "created_at": r["created_at"],
            "nutrients": by_meal.get(r["id"], []),
        }
        for r in meal_rows
    ]


@app.get("/api/meals")
def list_meals(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    result = _fetch_meals(conn, "WHERE date >= ? AND date <= ?", (s, e))
    conn.close()
    return result


@app.post("/api/meals")
def create_meal(body: MealIn):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Meal name is required")
    conn = get_db()
    cur = conn.execute(
        """
        INSERT INTO meals (date, time, name, notes, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            body.date,
            body.time,
            body.name.strip(),
            body.notes,
            datetime.utcnow().isoformat(timespec="seconds"),
        ),
    )
    new_id = cur.lastrowid
    for n in body.nutrients:
        conn.execute(
            """
            INSERT INTO meal_nutrients (meal_id, nutrient_key, amount)
            VALUES (?, ?, ?)
            """,
            (new_id, n.nutrient_key, n.amount),
        )
    conn.commit()
    result = _fetch_meals(conn, "WHERE id = ?", (new_id,))
    conn.close()
    return result[0]


@app.get("/api/meals/{meal_id}")
def get_meal(meal_id: int):
    conn = get_db()
    result = _fetch_meals(conn, "WHERE id = ?", (meal_id,))
    conn.close()
    if not result:
        raise HTTPException(status_code=404, detail="Meal not found")
    return result[0]


@app.put("/api/meals/{meal_id}")
def update_meal(meal_id: int, body: MealIn):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Meal name is required")
    conn = get_db()
    cur = conn.execute(
        """
        UPDATE meals SET date = ?, time = ?, name = ?, notes = ? WHERE id = ?
        """,
        (body.date, body.time, body.name.strip(), body.notes, meal_id),
    )
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Meal not found")
    conn.execute("DELETE FROM meal_nutrients WHERE meal_id = ?", (meal_id,))
    for n in body.nutrients:
        conn.execute(
            """
            INSERT INTO meal_nutrients (meal_id, nutrient_key, amount)
            VALUES (?, ?, ?)
            """,
            (meal_id, n.nutrient_key, n.amount),
        )
    conn.commit()
    result = _fetch_meals(conn, "WHERE id = ?", (meal_id,))
    conn.close()
    return result[0]


@app.delete("/api/meals/{meal_id}")
def delete_meal(meal_id: int):
    conn = get_db()
    conn.execute("DELETE FROM meal_nutrients WHERE meal_id = ?", (meal_id,))
    cur = conn.execute("DELETE FROM meals WHERE id = ?", (meal_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Meal not found")
    return {"status": "ok"}


@app.get("/api/nutrition/daily")
def nutrition_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        """
        SELECT m.date, mn.nutrient_key, SUM(mn.amount) AS total
        FROM meals m
        JOIN meal_nutrients mn ON mn.meal_id = m.id
        WHERE m.date >= ? AND m.date <= ?
        GROUP BY m.date, mn.nutrient_key
        ORDER BY m.date
        """,
        (s, e),
    ).fetchall()
    conn.close()
    by_date: dict[str, dict[str, float]] = {}
    for r in rows:
        by_date.setdefault(r["date"], {})[r["nutrient_key"]] = r["total"]
    return [{"date": d, "totals": t} for d, t in sorted(by_date.items())]


@app.get("/api/water")
def list_water(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM water_intake WHERE date >= ? AND date <= ? ORDER BY date, time, id",
        (s, e),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/water")
def create_water(body: WaterIn):
    if body.amount_ml <= 0:
        raise HTTPException(status_code=422, detail="amount_ml must be positive")
    conn = get_db()
    cur = conn.execute(
        """
        INSERT INTO water_intake (date, time, amount_ml, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (body.date, body.time, body.amount_ml, datetime.utcnow().isoformat(timespec="seconds")),
    )
    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM water_intake WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/water/{water_id}")
def delete_water(water_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM water_intake WHERE id = ?", (water_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Water entry not found")
    return {"status": "ok"}


@app.get("/api/water/daily")
def water_daily(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        """
        SELECT date, SUM(amount_ml) AS total_ml
        FROM water_intake
        WHERE date >= ? AND date <= ?
        GROUP BY date
        ORDER BY date
        """,
        (s, e),
    ).fetchall()
    conn.close()
    return [{"date": r["date"], "total_ml": r["total_ml"]} for r in rows]


# --- Workouts ---

@app.get("/api/workouts")
def list_workouts(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        """SELECT w.*,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' THEN 1 ELSE 0 END), 0) as total_sets,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' AND ws.weight_kg IS NOT NULL
                                    THEN ws.weight_kg * COALESCE(ws.reps, 1) ELSE 0 END), 0) as total_volume
           FROM v_workouts w
           LEFT JOIN v_workout_sets ws ON ws.workout_id = w.id
           WHERE w.date >= ? AND w.date <= ?
           GROUP BY w.id
           ORDER BY w.date DESC""",
        (s, e),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/workouts/stats")
def workout_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    row = conn.execute(
        """SELECT COUNT(DISTINCT w.id) as workout_count,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' THEN 1 ELSE 0 END), 0) as total_sets,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' AND ws.weight_kg IS NOT NULL
                                    THEN ws.weight_kg * COALESCE(ws.reps, 1) ELSE 0 END), 0) as total_volume,
                  AVG(w.duration_sec) as avg_duration_sec
           FROM v_workouts w
           LEFT JOIN v_workout_sets ws ON ws.workout_id = w.id
           WHERE w.date >= ? AND w.date <= ?""",
        (s, e),
    ).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/workouts/weekly-volume")
def weekly_volume(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        """SELECT strftime('%%Y-%%W', w.date) as week,
                  MIN(w.date) as week_start,
                  COUNT(DISTINCT w.id) as sessions,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' AND ws.weight_kg IS NOT NULL
                                    THEN ws.weight_kg * COALESCE(ws.reps, 1) ELSE 0 END), 0) as volume
           FROM v_workouts w
           LEFT JOIN v_workout_sets ws ON ws.workout_id = w.id
           WHERE w.date >= ? AND w.date <= ?
           GROUP BY week
           ORDER BY week""",
        (s, e),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/workouts/recent")
def recent_workouts(limit: int = 3):
    conn = get_db()
    rows = conn.execute(
        """SELECT w.*,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' THEN 1 ELSE 0 END), 0) as total_sets,
                  COUNT(DISTINCT CASE WHEN ws.set_type = 'working' THEN ws.exercise END) as exercise_count
           FROM v_workouts w
           LEFT JOIN v_workout_sets ws ON ws.workout_id = w.id
           GROUP BY w.id
           ORDER BY w.date DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Garmin activities ---

@app.get("/api/activities")
def list_activities(
    start: Optional[str] = None,
    end: Optional[str] = None,
    sport: Optional[str] = None,
):
    s, e = default_range(start, end)
    sql = "SELECT * FROM v_activities WHERE date >= ? AND date <= ?"
    params: list = [s, e]
    if sport:
        sql += " AND sport_type = ?"
        params.append(sport)
    sql += " ORDER BY start_time DESC"
    conn = get_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/activities/stats")
def activities_stats(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    row = conn.execute(
        """SELECT COUNT(*) as activity_count,
                  SUM(distance_m) as total_distance_m,
                  SUM(duration_sec) as total_duration_sec,
                  SUM(calories) as total_calories,
                  SUM(elevation_gain_m) as total_elevation_m
           FROM v_activities
           WHERE date >= ? AND date <= ?""",
        (s, e),
    ).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/activities/weekly")
def activities_weekly(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        """SELECT strftime('%Y-%W', date) as week,
                  MIN(date) as week_start,
                  COUNT(*) as sessions,
                  SUM(distance_m) as distance_m,
                  SUM(duration_sec) as duration_sec,
                  SUM(elevation_gain_m) as elevation_m
           FROM v_activities
           WHERE date >= ? AND date <= ?
           GROUP BY week
           ORDER BY week""",
        (s, e),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/activities/recent")
def recent_activities(limit: int = 5):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM v_activities ORDER BY start_time DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/workouts/{workout_id}")
def get_workout(workout_id: str):
    conn = get_db()
    workout = conn.execute(
        """SELECT w.*,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' THEN 1 ELSE 0 END), 0) as total_sets,
                  COUNT(DISTINCT CASE WHEN ws.set_type = 'working' THEN ws.exercise END) as exercise_count,
                  COALESCE(SUM(CASE WHEN ws.set_type = 'working' AND ws.weight_kg IS NOT NULL
                                    THEN ws.weight_kg * COALESCE(ws.reps, 1) ELSE 0 END), 0) as total_volume
           FROM v_workouts w
           LEFT JOIN v_workout_sets ws ON ws.workout_id = w.id
           WHERE w.id = ?
           GROUP BY w.id""",
        (workout_id,),
    ).fetchone()
    if not workout:
        conn.close()
        raise HTTPException(status_code=404, detail="Workout not found")
    sets = conn.execute(
        "SELECT exercise, set_order, set_type, weight_kg, reps, seconds, distance_m, rpe "
        "FROM v_workout_sets WHERE workout_id = ? ORDER BY set_order",
        (workout_id,),
    ).fetchall()
    conn.close()
    return {**dict(workout), "sets": [dict(s) for s in sets]}


# --- Date range ---

@app.get("/api/date-range")
def date_range():
    conn = get_db()
    tables = [
        "v_heart_rate_daily", "v_hrv_daily", "v_body_battery_daily",
        "v_sleep_daily", "v_stress_daily", "v_weight_daily", "v_activities",
        "v_steps_daily",
    ]
    earliest, latest = None, None
    for t in tables:
        row = conn.execute(f"SELECT MIN(date), MAX(date) FROM {t}").fetchone()
        if row[0]:
            if earliest is None or row[0] < earliest:
                earliest = row[0]
            if latest is None or row[1] > latest:
                latest = row[1]
    conn.close()
    return {"earliest": earliest, "latest": latest}


# --- Plugins ---

_plugin_logger = logging.getLogger("vitalscope.plugins")
discover_plugins()


def ensure_plugin_tables() -> None:
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS plugin_configs (
            name             TEXT PRIMARY KEY,
            enabled          INTEGER NOT NULL DEFAULT 0,
            interval_minutes INTEGER NOT NULL,
            params_json      TEXT NOT NULL DEFAULT '{}',
            last_run_at      TEXT,
            last_status      TEXT,
            last_message     TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS plugin_runs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            started_at   TEXT NOT NULL,
            finished_at  TEXT,
            status       TEXT NOT NULL,
            message      TEXT,
            rows_written INTEGER
        )
        """
    )
    for name, plugin in PLUGIN_REGISTRY.items():
        conn.execute(
            "INSERT OR IGNORE INTO plugin_configs (name, enabled, interval_minutes, params_json) "
            "VALUES (?, 0, ?, '{}')",
            (name, plugin.default_interval_minutes),
        )
    conn.commit()
    conn.close()


ensure_plugin_tables()


def _plugin_config_row(name: str) -> Optional[dict]:
    conn = get_db()
    row = conn.execute("SELECT * FROM plugin_configs WHERE name=?", (name,)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "name": row["name"],
        "enabled": bool(row["enabled"]),
        "interval_minutes": row["interval_minutes"],
        "params": json.loads(row["params_json"] or "{}"),
        "last_run_at": row["last_run_at"],
        "last_status": row["last_status"],
        "last_message": row["last_message"],
    }


def _plugin_view(plugin: Plugin, cfg: dict) -> dict:
    masked = dict(cfg["params"])
    for spec in plugin.param_schema:
        if spec.type == "secret":
            masked[spec.key] = "***" if cfg["params"].get(spec.key) else ""
    return {
        "name": plugin.name,
        "label": plugin.label,
        "description": plugin.description,
        "default_interval_minutes": plugin.default_interval_minutes,
        "param_schema": [
            {"key": s.key, "label": s.label, "type": s.type,
             "default": s.default, "required": s.required}
            for s in plugin.param_schema
        ],
        "enabled": cfg["enabled"],
        "interval_minutes": cfg["interval_minutes"],
        "params": masked,
        "last_run_at": cfg["last_run_at"],
        "last_status": cfg["last_status"],
        "last_message": cfg["last_message"],
    }


class PluginUpdateBody(BaseModel):
    enabled: bool
    interval_minutes: int
    params: dict[str, Any] = {}


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_plugin_sync(name: str) -> None:
    """Execute a plugin synchronously and record the run. Called from a threadpool."""
    plugin = PLUGIN_REGISTRY.get(name)
    if plugin is None:
        return
    cfg = _plugin_config_row(name) or {"params": {}}
    params = cfg["params"]

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO plugin_runs (name, started_at, status) VALUES (?, ?, 'running')",
        (name, _utcnow()),
    )
    run_id = cur.lastrowid
    conn.commit()
    conn.close()

    ok, message, rows = True, "", None
    try:
        result = plugin.run(params)
        ok = result.ok
        message = result.message or ("ok" if ok else "error")
        rows = result.rows_written
    except Exception as e:
        ok = False
        message = f"{type(e).__name__}: {e}"
        _plugin_logger.exception("plugin %s failed", name)

    finished = _utcnow()
    status = "ok" if ok else "error"
    conn = get_db()
    conn.execute(
        "UPDATE plugin_runs SET finished_at=?, status=?, message=?, rows_written=? WHERE id=?",
        (finished, status, message, rows, run_id),
    )
    conn.execute(
        "UPDATE plugin_configs SET last_run_at=?, last_status=?, last_message=? WHERE name=?",
        (finished, status, message, name),
    )
    conn.commit()
    conn.close()


_scheduler: Optional[AsyncIOScheduler] = None


async def _run_plugin_async(name: str) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _run_plugin_sync, name)


def _reload_job(name: str) -> None:
    if _scheduler is None:
        return
    job_id = f"plugin:{name}"
    existing = _scheduler.get_job(job_id)
    if existing is not None:
        _scheduler.remove_job(job_id)
    cfg = _plugin_config_row(name)
    if not cfg or not cfg["enabled"]:
        return
    _scheduler.add_job(
        _run_plugin_async,
        IntervalTrigger(minutes=max(1, int(cfg["interval_minutes"]))),
        id=job_id,
        args=[name],
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )


@app.on_event("startup")
async def _start_scheduler() -> None:
    global _scheduler
    if DEMO_MODE:
        _plugin_logger.info("demo mode: plugin scheduler disabled")
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()
    for name in PLUGIN_REGISTRY:
        _reload_job(name)
    _plugin_logger.info("plugin scheduler started with %d jobs", len(_scheduler.get_jobs()))


@app.on_event("shutdown")
async def _stop_scheduler() -> None:
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)


@app.get("/api/plugins")
def list_plugins():
    out = []
    for name, plugin in PLUGIN_REGISTRY.items():
        cfg = _plugin_config_row(name)
        if cfg is None:
            continue
        out.append(_plugin_view(plugin, cfg))
    return out


@app.get("/api/plugins/{name}")
def get_plugin(name: str):
    plugin = PLUGIN_REGISTRY.get(name)
    cfg = _plugin_config_row(name) if plugin else None
    if plugin is None or cfg is None:
        raise HTTPException(status_code=404, detail="plugin not found")
    return _plugin_view(plugin, cfg)


@app.put("/api/plugins/{name}")
def update_plugin(name: str, body: PluginUpdateBody):
    if DEMO_MODE:
        raise HTTPException(status_code=503, detail="demo mode: plugin configuration disabled")
    plugin = PLUGIN_REGISTRY.get(name)
    if plugin is None:
        raise HTTPException(status_code=404, detail="plugin not found")
    current = _plugin_config_row(name) or {"params": {}}
    merged = dict(current["params"])
    for spec in plugin.param_schema:
        if spec.key not in body.params:
            continue
        val = body.params[spec.key]
        if spec.type == "secret" and val == "***":
            continue
        merged[spec.key] = val
    conn = get_db()
    conn.execute(
        "UPDATE plugin_configs SET enabled=?, interval_minutes=?, params_json=? WHERE name=?",
        (1 if body.enabled else 0, max(1, int(body.interval_minutes)), json.dumps(merged), name),
    )
    conn.commit()
    conn.close()
    _reload_job(name)
    cfg = _plugin_config_row(name)
    return _plugin_view(plugin, cfg)


@app.post("/api/plugins/{name}/run")
async def run_plugin_now(name: str):
    if DEMO_MODE:
        raise HTTPException(status_code=503, detail="demo mode: plugin runs disabled")
    plugin = PLUGIN_REGISTRY.get(name)
    if plugin is None:
        raise HTTPException(status_code=404, detail="plugin not found")
    asyncio.create_task(_run_plugin_async(name))
    return {"status": "started", "name": name}


@app.get("/api/plugins/{name}/runs")
def get_plugin_runs(name: str, limit: int = Query(20, ge=1, le=200)):
    if name not in PLUGIN_REGISTRY:
        raise HTTPException(status_code=404, detail="plugin not found")
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, started_at, finished_at, status, message, rows_written "
        "FROM plugin_runs WHERE name=? ORDER BY id DESC LIMIT ?",
        (name, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# Serve the built frontend (SPA) when running as a single container in prod.
# Dev keeps Vite on :5173 proxying /api → :8000, so this block is a no-op there.
_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if ENV_NAME == "prod" and _FRONTEND_DIST.is_dir():
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = _FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIST / "index.html")
