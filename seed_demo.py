"""Seed a synthetic vitalscope.db for demo previews.

Run with `python3 seed_demo.py`. Idempotent — skips if the DB already has
daily rows. Uses a fixed random seed so the demo looks the same across
deploys.
"""

import os
import random
import sqlite3
import sys
import uuid
from datetime import date, datetime, time, timedelta
from pathlib import Path

os.environ.setdefault("VITALSCOPE_ENV", "prod")

import backend.app  # noqa: F401  — creates the schema via its module-load side effects

DB_PATH = backend.app.DB_PATH
DAYS = 90
RNG = random.Random(42)


def _already_seeded(conn: sqlite3.Connection) -> bool:
    n = conn.execute("SELECT COUNT(*) FROM heart_rate_daily").fetchone()[0]
    return n > 0


def _dates() -> list[date]:
    today = date.today()
    return [today - timedelta(days=i) for i in range(DAYS - 1, -1, -1)]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def seed_heart_rate(conn: sqlite3.Connection) -> None:
    for d in _dates():
        resting = 52 + RNG.randint(-3, 4)
        lo = resting - RNG.randint(2, 6)
        hi = 140 + RNG.randint(-20, 30)
        conn.execute(
            "INSERT OR REPLACE INTO heart_rate_daily "
            "(date, resting_hr, min_hr, max_hr, avg_7d_resting_hr) VALUES (?,?,?,?,?)",
            (d.isoformat(), resting, lo, hi, resting),
        )


def seed_hrv(conn: sqlite3.Connection) -> None:
    baseline = 58
    for d in _dates():
        last = baseline + RNG.randint(-8, 8)
        conn.execute(
            "INSERT OR REPLACE INTO hrv_daily "
            "(date, weekly_avg, last_night_avg, last_night_5min_high, "
            "baseline_low_upper, baseline_balanced_low, baseline_balanced_upper) "
            "VALUES (?,?,?,?,?,?,?)",
            (d.isoformat(), baseline, last, last + 12, baseline - 10, baseline - 5, baseline + 5),
        )


def seed_body_battery(conn: sqlite3.Connection) -> None:
    for d in _dates():
        conn.execute(
            "INSERT OR REPLACE INTO body_battery_daily (date, charged, drained) VALUES (?,?,?)",
            (d.isoformat(), 60 + RNG.randint(-15, 20), 55 + RNG.randint(-15, 25)),
        )


def seed_sleep(conn: sqlite3.Connection) -> None:
    for d in _dates():
        total = 7 * 3600 + RNG.randint(-3600, 3600)
        deep = int(total * (0.14 + RNG.random() * 0.06))
        rem = int(total * (0.18 + RNG.random() * 0.06))
        awake = RNG.randint(5, 30) * 60
        light = max(0, total - deep - rem - awake)
        start = datetime.combine(d - timedelta(days=1), time(23, RNG.randint(0, 45)))
        end = start + timedelta(seconds=total + awake)
        score = 70 + RNG.randint(-15, 20)
        quality = "good" if score >= 80 else "fair" if score >= 60 else "poor"
        conn.execute(
            "INSERT OR REPLACE INTO sleep_daily "
            "(date, sleep_time_seconds, deep_sleep_seconds, light_sleep_seconds, "
            " rem_sleep_seconds, awake_seconds, sleep_start, sleep_end, "
            " avg_spo2, avg_respiration, avg_sleep_stress, sleep_score, sleep_score_quality, resting_hr) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                d.isoformat(), total, deep, light, rem, awake,
                _iso(start), _iso(end),
                96 + RNG.random() * 2, 14 + RNG.random() * 2, 20 + RNG.random() * 10,
                score, quality, 52 + RNG.randint(-3, 4),
            ),
        )


def seed_stress(conn: sqlite3.Connection) -> None:
    for d in _dates():
        conn.execute(
            "INSERT OR REPLACE INTO stress_daily (date, avg_stress, max_stress) VALUES (?,?,?)",
            (d.isoformat(), 28 + RNG.randint(-10, 25), 70 + RNG.randint(-10, 25)),
        )


def seed_steps(conn: sqlite3.Connection) -> None:
    for d in _dates():
        total = 8000 + RNG.randint(-5000, 7000)
        conn.execute(
            "INSERT OR REPLACE INTO steps_daily "
            "(date, total_steps, total_distance_m, step_goal) VALUES (?,?,?,?)",
            (d.isoformat(), max(0, total), int(total * 0.78), 10000),
        )


def seed_weight(conn: sqlite3.Connection) -> None:
    weight = 78.0
    for i, d in enumerate(_dates()):
        if i % 2 == 0:  # skip some days so it's not daily
            continue
        weight += RNG.uniform(-0.2, 0.2)
        conn.execute(
            "INSERT OR REPLACE INTO weight_daily "
            "(date, weight_kg, body_fat_pct, muscle_mass_kg, bone_mass_kg, water_pct, "
            " bmi, visceral_fat, bmr, protein_pct, lean_body_mass_kg, body_age, heart_rate) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                d.isoformat(), round(weight, 2),
                18 + RNG.random() * 2, round(weight * 0.45, 2), round(weight * 0.04, 2),
                55 + RNG.random() * 3, round(weight / (1.78 ** 2), 1),
                8 + RNG.random(), int(1600 + weight * 5),
                18 + RNG.random(), round(weight * 0.82, 2), 30, 58,
            ),
        )


def seed_activities(conn: sqlite3.Connection) -> None:
    types = [("running", "Run"), ("cycling", "Ride"), ("strength_training", "Strength"), ("yoga", "Yoga")]
    for i, d in enumerate(_dates()):
        if i % 4 != 0:  # ~every 4th day
            continue
        sport, label = RNG.choice(types)
        start = datetime.combine(d, time(7 + RNG.randint(0, 12), RNG.randint(0, 59)))
        dur = 40 * 60 + RNG.randint(-15, 45) * 60
        end = start + timedelta(seconds=dur)
        dist = 8000 + RNG.randint(-4000, 12000) if sport in ("running", "cycling") else 0
        conn.execute(
            "INSERT OR REPLACE INTO garmin_activities "
            "(activity_id, date, start_time, end_time, name, sport_type, activity_type, "
            " duration_sec, moving_time_sec, distance_m, elevation_gain_m, avg_hr, max_hr, "
            " avg_speed_mps, calories, avg_power_w, training_effect, anaerobic_te, raw_json) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                10_000_000 + i, d.isoformat(), _iso(start), _iso(end),
                f"{label} {d.isoformat()}", sport, sport,
                float(dur), float(dur - 30), float(dist),
                float(RNG.randint(0, 300)) if sport == "cycling" else float(RNG.randint(20, 150)),
                140 + RNG.randint(-15, 25), 165 + RNG.randint(-10, 20),
                (dist / dur) if dist else 0.0, 350 + RNG.randint(-100, 300),
                180.0 if sport == "cycling" else 0.0,
                2.5 + RNG.random(), 0.5 + RNG.random(), "{}",
            ),
        )


def seed_workouts(conn: sqlite3.Connection) -> None:
    exercises = ["Squat", "Bench Press", "Deadlift", "Overhead Press", "Barbell Row", "Pull Up"]
    for i, d in enumerate(_dates()):
        if i % 7 != 0:
            continue
        wid = str(uuid.UUID(int=i))
        start = datetime.combine(d, time(18, 0))
        end = start + timedelta(minutes=55)
        conn.execute(
            "INSERT OR REPLACE INTO workouts (id, date, end_date, name, duration_sec, notes) VALUES (?,?,?,?,?,?)",
            (wid, _iso(start), _iso(end), RNG.choice(["Push", "Pull", "Legs", "Full Body"]), 55 * 60, ""),
        )
        order = 0
        for ex in RNG.sample(exercises, 4):
            base_weight = RNG.choice([40, 60, 80, 100])
            for _set in range(3):
                order += 1
                conn.execute(
                    "INSERT OR REPLACE INTO workout_sets "
                    "(workout_id, exercise, set_order, set_type, weight_kg, reps, seconds, distance_m, is_pr, rpe) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (wid, ex, order, "working", float(base_weight), RNG.randint(5, 10), None, None, 0, 7.5),
                )
                order += 1
                conn.execute(
                    "INSERT OR REPLACE INTO workout_sets "
                    "(workout_id, exercise, set_order, set_type, weight_kg, reps, seconds, distance_m, is_pr, rpe) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (wid, ex, order, "rest", None, None, 90, None, 0, None),
                )


def seed_supplements(conn: sqlite3.Connection) -> None:
    rows = [
        ("Vitamin D3", "2000 IU", "morning", 1),
        ("Omega-3", "1000 mg", "morning", 2),
        ("Magnesium", "400 mg", "evening", 1),
        ("Creatine", "5 g", "noon", 1),
    ]
    now = datetime.utcnow().isoformat(timespec="seconds")
    for name, dosage, tod, order in rows:
        conn.execute(
            "INSERT INTO supplements (name, dosage, time_of_day, sort_order, created_at) "
            "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM supplements WHERE name=?)",
            (name, dosage, tod, order, now, name),
        )


def seed_meals_and_water(conn: sqlite3.Connection) -> None:
    today = date.today()
    now = datetime.utcnow().isoformat(timespec="seconds")
    for offset in range(0, 14):
        d = today - timedelta(days=offset)
        for meal_time, name, kcal, protein in [
            ("08:00", "Oatmeal & berries", 380, 14),
            ("13:00", "Chicken salad", 520, 42),
            ("19:00", "Salmon with rice", 650, 38),
        ]:
            cur = conn.execute(
                "INSERT INTO meals (date, time, name, notes, created_at) VALUES (?,?,?,?,?)",
                (d.isoformat(), meal_time, name, None, now),
            )
            meal_id = cur.lastrowid
            conn.execute(
                "INSERT OR IGNORE INTO meal_nutrients (meal_id, nutrient_key, amount) VALUES (?, 'calories_kcal', ?)",
                (meal_id, kcal),
            )
            conn.execute(
                "INSERT OR IGNORE INTO meal_nutrients (meal_id, nutrient_key, amount) VALUES (?, 'protein_g', ?)",
                (meal_id, protein),
            )
        for drink_time, ml in [("09:00", 250), ("12:30", 400), ("16:00", 300), ("20:00", 250)]:
            conn.execute(
                "INSERT INTO water_intake (date, time, amount_ml, created_at) VALUES (?,?,?,?)",
                (d.isoformat(), drink_time, ml, now),
            )


def main() -> None:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        if _already_seeded(conn):
            print(f"seed_demo: {DB_PATH} already populated, skipping", flush=True)
            return
        print(f"seed_demo: writing {DAYS} days of synthetic data to {DB_PATH}", flush=True)
        seed_heart_rate(conn)
        seed_hrv(conn)
        seed_body_battery(conn)
        seed_sleep(conn)
        seed_stress(conn)
        seed_steps(conn)
        seed_weight(conn)
        seed_activities(conn)
        seed_workouts(conn)
        seed_supplements(conn)
        seed_meals_and_water(conn)
        conn.commit()
        print("seed_demo: done", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
