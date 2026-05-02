"""Seed a synthetic vitalscope.db for demo previews.

Run with `python3 seed_demo.py`. Idempotent — skips if the DB already has
daily rows. Uses a fixed random seed so the demo looks the same across
deploys.

The per-source seed functions (`seed_heart_rate`, etc.) accept an explicit
date range and RNG so `backend/plugins/_demo_generators.py` can reuse them
to fake "Run now" behavior in demo mode.
"""

import math
import os
import random
import sqlite3
import sys
import uuid
from datetime import date, datetime, time, timedelta

os.environ.setdefault("VITALSCOPE_ENV", "prod")

import backend.app  # noqa: F401  — creates the schema via its module-load side effects

DB_PATH = backend.app.DB_PATH
DAYS = 90
DEMO_SEED = 42


def _already_seeded(conn: sqlite3.Connection) -> bool:
    n = conn.execute("SELECT COUNT(*) FROM heart_rate_daily").fetchone()[0]
    return n > 0


def date_range(days: int, end: date | None = None) -> list[date]:
    end = end or date.today()
    return [end - timedelta(days=i) for i in range(days - 1, -1, -1)]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def seed_heart_rate(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    for d in dates:
        resting = 52 + rng.randint(-3, 4)
        lo = resting - rng.randint(2, 6)
        hi = 140 + rng.randint(-20, 30)
        conn.execute(
            "INSERT OR REPLACE INTO heart_rate_daily "
            "(date, resting_hr, min_hr, max_hr, avg_7d_resting_hr) VALUES (?,?,?,?,?)",
            (d.isoformat(), resting, lo, hi, resting),
        )
    return len(dates)


def seed_hrv(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    baseline = 58
    for d in dates:
        last = baseline + rng.randint(-8, 8)
        conn.execute(
            "INSERT OR REPLACE INTO hrv_daily "
            "(date, weekly_avg, last_night_avg, last_night_5min_high, "
            "baseline_low_upper, baseline_balanced_low, baseline_balanced_upper) "
            "VALUES (?,?,?,?,?,?,?)",
            (d.isoformat(), baseline, last, last + 12, baseline - 10, baseline - 5, baseline + 5),
        )
    return len(dates)


def seed_body_battery(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    for d in dates:
        conn.execute(
            "INSERT OR REPLACE INTO body_battery_daily (date, charged, drained) VALUES (?,?,?)",
            (d.isoformat(), 60 + rng.randint(-15, 20), 55 + rng.randint(-15, 25)),
        )
    return len(dates)


def seed_sleep(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    for d in dates:
        total = 7 * 3600 + rng.randint(-3600, 3600)
        deep = int(total * (0.14 + rng.random() * 0.06))
        rem = int(total * (0.18 + rng.random() * 0.06))
        awake = rng.randint(5, 30) * 60
        light = max(0, total - deep - rem - awake)
        start = datetime.combine(d - timedelta(days=1), time(23, rng.randint(0, 45)))
        end = start + timedelta(seconds=total + awake)
        score = 70 + rng.randint(-15, 20)
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
                96 + rng.random() * 2, 14 + rng.random() * 2, 20 + rng.random() * 10,
                score, quality, 52 + rng.randint(-3, 4),
            ),
        )
    return len(dates)


def seed_stress(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    for d in dates:
        conn.execute(
            "INSERT OR REPLACE INTO stress_daily (date, avg_stress, max_stress) VALUES (?,?,?)",
            (d.isoformat(), 28 + rng.randint(-10, 25), 70 + rng.randint(-10, 25)),
        )
    return len(dates)


def seed_steps(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    for d in dates:
        total = 8000 + rng.randint(-5000, 7000)
        conn.execute(
            "INSERT OR REPLACE INTO steps_daily "
            "(date, total_steps, total_distance_m, step_goal) VALUES (?,?,?,?)",
            (d.isoformat(), max(0, total), int(total * 0.78), 10000),
        )
    return len(dates)


def seed_weight(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    # Skip every other date (ordinal-based so the same calendar day is
    # always either a weigh-in or a skip, regardless of range length).
    count = 0
    weight = 78.0
    for d in dates:
        if d.toordinal() % 2 == 0:
            continue
        weight += rng.uniform(-0.2, 0.2)
        conn.execute(
            "INSERT OR REPLACE INTO weight_daily "
            "(date, weight_kg, body_fat_pct, muscle_mass_kg, bone_mass_kg, water_pct, "
            " bmi, visceral_fat, bmr, protein_pct, lean_body_mass_kg, body_age, heart_rate) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                d.isoformat(), round(weight, 2),
                18 + rng.random() * 2, round(weight * 0.45, 2), round(weight * 0.04, 2),
                55 + rng.random() * 3, round(weight / (1.78 ** 2), 1),
                8 + rng.random(), int(1600 + weight * 5),
                18 + rng.random(), round(weight * 0.82, 2), 30, 58,
            ),
        )
        count += 1
    return count


def seed_activities(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    types = [("running", "Run"), ("cycling", "Ride"), ("strength_training", "Strength"), ("yoga", "Yoga")]
    count = 0
    for d in dates:
        if d.toordinal() % 4 != 0:
            continue
        sport, label = rng.choice(types)
        start = datetime.combine(d, time(7 + rng.randint(0, 12), rng.randint(0, 59)))
        dur = 40 * 60 + rng.randint(-15, 45) * 60
        end = start + timedelta(seconds=dur)
        dist = 8000 + rng.randint(-4000, 12000) if sport in ("running", "cycling") else 0
        conn.execute(
            "INSERT OR REPLACE INTO garmin_activities "
            "(activity_id, date, start_time, end_time, name, sport_type, activity_type, "
            " duration_sec, moving_time_sec, distance_m, elevation_gain_m, avg_hr, max_hr, "
            " avg_speed_mps, calories, avg_power_w, training_effect, anaerobic_te, raw_json) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                10_000_000 + d.toordinal(), d.isoformat(), _iso(start), _iso(end),
                f"{label} {d.isoformat()}", sport, sport,
                float(dur), float(dur - 30), float(dist),
                float(rng.randint(0, 300)) if sport == "cycling" else float(rng.randint(20, 150)),
                140 + rng.randint(-15, 25), 165 + rng.randint(-10, 20),
                (dist / dur) if dist else 0.0, 350 + rng.randint(-100, 300),
                180.0 if sport == "cycling" else 0.0,
                2.5 + rng.random(), 0.5 + rng.random(), "{}",
            ),
        )
        count += 1
    return count


def seed_workouts(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    exercises = ["Squat", "Bench Press", "Deadlift", "Overhead Press", "Barbell Row", "Pull Up"]
    count = 0
    for d in dates:
        if d.toordinal() % 7 != 0:
            continue
        wid = str(uuid.UUID(int=d.toordinal()))
        start = datetime.combine(d, time(18, 0))
        end = start + timedelta(minutes=55)
        conn.execute(
            "INSERT OR REPLACE INTO workouts (id, date, end_date, name, duration_sec, notes) VALUES (?,?,?,?,?,?)",
            (wid, _iso(start), _iso(end), rng.choice(["Push", "Pull", "Legs", "Full Body"]), 55 * 60, ""),
        )
        order = 0
        for ex in rng.sample(exercises, 4):
            base_weight = rng.choice([40, 60, 80, 100])
            for _set in range(3):
                order += 1
                conn.execute(
                    "INSERT OR REPLACE INTO workout_sets "
                    "(workout_id, exercise, set_order, set_type, weight_kg, reps, seconds, distance_m, is_pr, rpe) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (wid, ex, order, "working", float(base_weight), rng.randint(5, 10), None, None, 0, 7.5),
                )
                order += 1
                conn.execute(
                    "INSERT OR REPLACE INTO workout_sets "
                    "(workout_id, exercise, set_order, set_type, weight_kg, reps, seconds, distance_m, is_pr, rpe) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (wid, ex, order, "rest", None, None, 90, None, 0, None),
                )
        count += 1
    return count


def seed_nutrition_goals(conn: sqlite3.Connection) -> None:
    now = datetime.utcnow().isoformat(timespec="seconds")
    goals = [
        ("calories_kcal", 2400),
        ("protein_g", 140),
        ("carbs_g", 260),
        ("fat_g", 85),
        ("fiber_g", 30),
        ("saturated_fat_g", 25),
        ("iron_mg", 12),
        ("magnesium_mg", 400),
        ("sodium_mg", 2000),
    ]
    for key, amount in goals:
        conn.execute(
            "INSERT OR IGNORE INTO nutrient_goals (nutrient_key, amount, updated_at) VALUES (?, ?, ?)",
            (key, amount, now),
        )


def seed_planned_activities(conn: sqlite3.Connection) -> None:
    existing = conn.execute("SELECT COUNT(*) FROM planned_activities").fetchone()[0]
    if existing > 0:
        return
    now = datetime.utcnow().isoformat(timespec="seconds")
    today = date.today()
    plan = [
        (0, "running", 5000, 30 * 60, "Easy 5k run"),
        (1, "strength_training", None, 55 * 60, "Push day"),
        (2, "cycling", 20_000, 60 * 60, "Commute ride"),
        (3, "running", 8000, 45 * 60, "Tempo 8k"),
        (4, "yoga", None, 30 * 60, "Mobility"),
        (5, "strength_training", None, 55 * 60, "Pull day"),
        (6, "cycling", 40_000, 120 * 60, "Long ride"),
    ]
    for offset, sport, dist, dur, note in plan:
        d = today + timedelta(days=offset)
        conn.execute(
            "INSERT INTO planned_activities "
            "(date, sport_type, target_distance_m, target_duration_sec, notes, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (d.isoformat(), sport, dist, dur, note, now),
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


def seed_cgm(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    count = 0
    for d in dates:
        base = 95 + rng.randint(-10, 15)
        # ~96 readings per day at 15-minute intervals
        for i in range(96):
            ts = datetime.combine(d, time(0, 0)) + timedelta(minutes=i * 15)
            # Simulate a daily glucose pattern: rise after meals, fall at rest
            hour = ts.hour + ts.minute / 60
            meal_spike = (
                20 * math.exp(-((hour - 8.5) ** 2) / 0.5)
                + 25 * math.exp(-((hour - 13.5) ** 2) / 0.5)
                + 22 * math.exp(-((hour - 19.5) ** 2) / 0.5)
            )
            noise = rng.gauss(0, 5)
            mgdl = max(60, min(250, int(round(base + meal_spike + noise))))
            trend_val = rng.choices(
                [3, 4, 5, 6, 7], weights=[5, 15, 60, 15, 5], k=1
            )[0]
            trend = {3: "falling", 4: "falling_slowly", 5: "flat", 6: "rising_slowly", 7: "rising"}[trend_val]
            conn.execute(
                "INSERT OR REPLACE INTO glucose_readings "
                "(timestamp, date, mgdl, trend, source) VALUES (?,?,?,?,?)",
                (ts.strftime("%Y-%m-%dT%H:%M:%S"), d.isoformat(), mgdl, trend, "demo"),
            )
            count += 1
        # Compute daily aggregate
        values = [
            r[0] for r in conn.execute(
                "SELECT mgdl FROM glucose_readings WHERE date = ?", (d.isoformat(),)
            ).fetchall()
        ]
        if values:
            avg = round(sum(values) / len(values), 1)
            std = round((sum((v - avg) ** 2 for v in values) / max(1, len(values) - 1)) ** 0.5, 1)
            cv = round(std / avg * 100, 1) if avg > 0 else 0.0
            tir = round(sum(1 for v in values if 70 <= v <= 180) / len(values) * 100, 1)
            conn.execute(
                "INSERT OR REPLACE INTO glucose_daily "
                "(date, avg_mgdl, min_mgdl, max_mgdl, std_dev, cv_percent, tir_pct, readings_count) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (d.isoformat(), avg, min(values), max(values), std, cv, tir, len(values)),
            )
    return count


def seed_cog_processing(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    import json as _json

    symbols = ["@", "#", "$", "%", "&", "!", "?", "*", "+", "~"]

    def _pct(vals: list, p: float) -> float:
        sv = sorted(vals)
        idx = (len(sv) - 1) * p
        lo, hi = int(idx), min(int(idx) + 1, len(sv) - 1)
        return sv[lo] + (sv[hi] - sv[lo]) * (idx - lo)

    def _median(vals: list) -> float:
        sv = sorted(vals)
        n = len(sv)
        mid = n // 2
        return sv[mid] if n % 2 else (sv[mid - 1] + sv[mid]) / 2

    count = 0
    num_dates = max(len(dates) - 1, 1)

    for d_idx, d in enumerate(dates):
        if d.toordinal() % 3 != 0:
            continue
        if conn.execute(
            "SELECT 1 FROM cog_processing_sessions WHERE date = ? AND stimulus_seed = ? LIMIT 1",
            (d.isoformat(), str(d.toordinal())),
        ).fetchone():
            continue

        # Gradual improvement over the date window (simulates practice effect)
        progress = d_idx / num_dates
        rt_mean = int(480 - 80 * progress)   # 480 ms → 400 ms
        acc_base = 0.78 + 0.12 * progress    # 78 % → 90 %

        dur_ms = 90_000 + rng.randint(-10_000, 20_000)
        started = datetime.combine(d, time(7 + rng.randint(0, 3), rng.randint(0, 59)))
        ended = started + timedelta(milliseconds=dur_ms)
        ts = started

        trials = []
        for i in range(40):
            difficulty = rng.choices(["easy", "moderate", "hard"], weights=[50, 35, 15], k=1)[0]
            target = rng.choice(symbols)
            if rng.random() < 0.5:
                others = rng.sample([s for s in symbols if s != target], 3)
                candidates = others + [target]
                rng.shuffle(candidates)
                correct_answer = True
            else:
                candidates = rng.sample([s for s in symbols if s != target], 4)
                correct_answer = False

            rt_mod = {"easy": 0.85, "moderate": 1.0, "hard": 1.25}[difficulty]
            acc_mod = {"easy": 1.05, "moderate": 1.0, "hard": 0.88}[difficulty]
            rt = max(155, int(rng.gauss(rt_mean * rt_mod, 55)))
            is_correct = rng.random() < min(acc_base * acc_mod, 0.98)
            user_answer = correct_answer if is_correct else (not correct_answer)

            trials.append({
                "i": i, "diff": difficulty, "target": target, "candidates": candidates,
                "correct_answer": correct_answer, "user_answer": user_answer,
                "is_correct": is_correct, "rt": rt, "ts": _iso(ts),
            })
            ts += timedelta(milliseconds=rt + 500)

        attempted = len(trials)
        correct_n = sum(1 for t in trials if t["is_correct"])
        commission = attempted - correct_n
        accuracy = correct_n / attempted
        rt_correct = [t["rt"] for t in trials if t["is_correct"]]
        rt_all = [t["rt"] for t in trials]
        median_rt = float(_median(rt_correct)) if rt_correct else None
        rt_iqr = (_pct(rt_correct, 0.75) - _pct(rt_correct, 0.25)) if len(rt_correct) >= 4 else None
        fast10 = _pct(rt_all, 0.1) if rt_all else None
        slow10 = _pct(rt_all, 0.9) if rt_all else None
        throughput_pm = correct_n / (dur_ms / 60_000)
        inv_eff = (median_rt / accuracy) if (median_rt and accuracy >= 0.01) else None

        streak = streak_max = 0
        last_ua = None
        for t in trials:
            ua = t["user_answer"]
            if last_ua is None or ua == last_ua:
                streak += 1
            else:
                streak = 1
            last_ua = ua
            streak_max = max(streak_max, streak)

        now = datetime.utcnow().isoformat(timespec="seconds")
        cur = conn.execute(
            """
            INSERT INTO cog_processing_sessions (
                date, started_at, ended_at, duration_ms, attempted, correct, accuracy,
                median_rt_ms, rt_iqr_ms, throughput_pm, inverse_efficiency,
                omission_errors, commission_errors, fast10_rt_ms, slow10_rt_ms,
                same_button_streak_max, interruption_count, focus_lost_ms_total,
                quality_flag, quality_reasons_json, device_info_json, stimulus_version,
                stimulus_seed, created_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                d.isoformat(), _iso(started), _iso(ended), dur_ms,
                attempted, correct_n, accuracy,
                median_rt, rt_iqr, throughput_pm, inv_eff,
                0, commission, fast10, slow10,
                streak_max, 0, 0,
                "ok", _json.dumps([]), _json.dumps({}), "v1",
                str(d.toordinal()), now,
            ),
        )
        session_id = cur.lastrowid
        for t in trials:
            conn.execute(
                """
                INSERT INTO cog_processing_trials (
                    session_id, trial_index, difficulty, target_symbol, candidate_symbols_json,
                    correct_answer, user_answer, is_correct, rt_ms, timeout, presented_at
                )
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    session_id, t["i"], t["diff"], t["target"],
                    _json.dumps(t["candidates"]),
                    int(t["correct_answer"]), int(t["user_answer"]),
                    int(t["is_correct"]), t["rt"], 0, t["ts"],
                ),
            )
        conn.execute(
            "UPDATE journal_entries SET avg_rt_ms = ?, rt_trials = ? WHERE date = ?",
            (median_rt, attempted, d.isoformat()),
        )
        count += 1
    return count


def seed_genome(conn: sqlite3.Connection) -> int:
    existing = conn.execute("SELECT COUNT(*) FROM genome_uploads").fetchone()[0]
    if existing > 0:
        return 0

    import json as _json

    now = datetime.utcnow().isoformat(timespec="seconds")
    today_str = date.today().isoformat()
    chromosomes = _json.dumps(["chr1", "chr10", "chr11", "chr12", "chr15", "chr19", "chr22"])

    cur = conn.execute(
        "INSERT INTO genome_uploads (date, source_upload_id, variant_count, rs_count, chromosomes, notes, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (today_str, None, 4523817, 3891244, chromosomes, None, now),
    )
    upload_id = cur.lastrowid

    variants = [
        ("rs1815739", "ACTN3", "R577X", "performance", "0/1", "heterozygous",
         "RX — Mixed profile",
         "One R allele and one stop-gain X allele. Balanced fast/slow-twitch distribution; "
         "no strong predisposition in either direction."),
        ("rs429358", "APOE", "APOE ε4 marker (rs429358)", "longevity", "0/0", "homozygous_ref",
         "No ε4 at this locus",
         "T/T at rs429358. In combination with rs7412, consistent with ε2 or ε3 background. "
         "Not associated with elevated APOE-linked lipid or Alzheimer risk at this position alone."),
        ("rs7412", "APOE", "APOE ε2 marker (rs7412)", "longevity", "0/1", "heterozygous",
         "One ε2 allele at this locus",
         "C/T at rs7412. One T allele is a component of the APOE ε2 haplotype. ε2 carriers "
         "typically show lower LDL; rare ε2/ε2 homozygosity carries elevated risk of type III hyperlipoproteinaemia."),
        ("rs1801133", "MTHFR", "C677T", "nutrition", "0/1", "heterozygous",
         "CT — Mildly reduced MTHFR activity",
         "Heterozygous 677CT. Approximately 35% reduction in MTHFR enzyme activity. May benefit "
         "from methylated folate (5-MTHF) and methylcobalamin over synthetic folic acid."),
        ("rs1801131", "MTHFR", "A1298C", "nutrition", "0/0", "homozygous_ref",
         "AA — Normal MTHFR activity at this site",
         "No 1298C variant. This MTHFR site is unaffected. Impact is generally milder than C677T; "
         "consider combined status with rs1801133."),
        ("rs2228570", "VDR", "FokI", "nutrition", "1/1", "homozygous_alt",
         "ff — Reduced VDR signalling",
         "Two f alleles. VDR protein is the longer, less transcriptionally active isoform. "
         "May require higher vitamin D3 intake to achieve equivalent serum 25(OH)D targets."),
        ("rs1544410", "VDR", "BsmI", "nutrition", "0/1", "heterozygous",
         "Bb — Intermediate response",
         "Heterozygous Bb. Intermediate vitamin D responsiveness; most individuals respond normally "
         "to standard supplementation."),
        ("rs174537", "FADS1", "FADS1 efficiency", "nutrition", "0/0", "homozygous_ref",
         "GG — Efficient fatty acid conversion",
         "Two G alleles. Higher FADS1 (δ5-desaturase) activity; efficient conversion of DGLA to "
         "arachidonic acid and ALA to EPA. Dietary ALA is relatively well converted."),
        ("rs1535", "FADS2", "FADS2 efficiency", "nutrition", "0/1", "heterozygous",
         "GA — Intermediate FADS2 activity",
         "One G, one A allele. Modest reduction in FADS2 activity. Direct omega-3 sources (EPA/DHA) "
         "are preferable to relying solely on ALA conversion."),
        ("rs762551", "CYP1A2", "Caffeine metaboliser", "pharmacogenomics", "1/1", "homozygous_alt",
         "AA — Fast caffeine metaboliser",
         "Two A alleles. CYP1A2 is strongly inducible; caffeine is cleared quickly. Lower adverse "
         "cardiovascular risk at moderate intake. Late caffeine consumption may have less sleep impact "
         "than in slow metabolisers."),
        ("rs3892097", "CYP2D6", "*4 allele", "pharmacogenomics", "0/0", "homozygous_ref",
         "Normal CYP2D6 at *4 locus",
         "No *4 loss-of-function allele at this position. CYP2D6 activity at this locus is "
         "unimpaired. Note: full CYP2D6 phenotype requires testing multiple variants and copy-number variation."),
        ("rs4244285", "CYP2C19", "*2 allele", "pharmacogenomics", "0/0", "homozygous_ref",
         "Normal CYP2C19 at *2 locus",
         "No *2 loss-of-function allele. CYP2C19 activity is unimpaired at this site. Drugs "
         "metabolised by CYP2C19 (clopidogrel, omeprazole, certain antidepressants) are expected to process normally."),
        ("rs1799853", "CYP2C9", "*2 allele", "pharmacogenomics", "0/0", "homozygous_ref",
         "Normal CYP2C9 at *2 locus",
         "No *2 variant. CYP2C9 activity is unimpaired at this position. Warfarin, NSAIDs, and "
         "other CYP2C9 substrates process normally from this locus."),
    ]

    for rs_id, gene, variant_name, domain, genotype, zygosity, impact_label, interpretation in variants:
        conn.execute(
            "INSERT OR IGNORE INTO genome_variants "
            "(genome_upload_id, rs_id, gene, variant_name, domain, genotype, zygosity, impact_label, interpretation, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (upload_id, rs_id, gene, variant_name, domain, genotype, zygosity, impact_label, interpretation, now),
        )
    return 1


def seed_genome_wiki(conn: sqlite3.Connection) -> int:
    """Write a small wiki tree to GENOME_WIKI_ROOT so the Orient browser
    renders something in demo / preview deploys. Idempotent — skips if any
    variant pages already exist on disk.
    """
    root = backend.app.GENOME_WIKI_ROOT
    variants_dir = root / "wiki" / "variants"
    if variants_dir.exists() and any(variants_dir.glob("*.md")):
        return 0

    samples = [
        ("rs1801133", "MTHFR", "0/1", "heterozygous",
         "C/T heterozygous; about a 35% reduction in MTHFR enzyme activity. "
         "Folate-cycle support (5-MTHF, methylcobalamin) is preferable to "
         "synthetic folic acid for this genotype."),
        ("rs429358", "APOE", "0/0", "homozygous_ref",
         "T/T at this locus; no ε4 component contributed here. Combine with "
         "rs7412 to determine the full APOE haplotype."),
        ("rs7412", "APOE", "0/1", "heterozygous",
         "C/T at rs7412; one ε2 component allele. ε2 carriers typically show "
         "lower LDL but are at risk of type III hyperlipoproteinaemia when "
         "homozygous (ε2/ε2)."),
        ("rs762551", "CYP1A2", "1/1", "homozygous_alt",
         "A/A; CYP1A2 is strongly inducible — caffeine clears quickly. "
         "Late-day intake has less sleep impact than in slow metabolisers."),
        ("rs2228570", "VDR", "1/1", "homozygous_alt",
         "f/f at FokI; the VDR protein is the longer, less transcriptionally "
         "active isoform. Higher vitamin D intake may be needed to reach "
         "equivalent serum 25(OH)D targets."),
    ]

    raw_dir = root / "raw" / "snpedia"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for rs, gene, _gt, _zyg, summary in samples:
        (raw_dir / f"{rs}.md").write_text(
            f"# {rs.upper()}\n\nGene: {gene}\nMagnitude: 2.5\n\n{summary}\n",
            encoding="utf-8",
        )

    def _yaml_dump(d: dict) -> str:
        out = []
        for k, v in d.items():
            if isinstance(v, list):
                out.append(f"{k}:")
                for item in v:
                    out.append(f"  - {item}")
            elif isinstance(v, bool):
                out.append(f"{k}: {'true' if v else 'false'}")
            elif isinstance(v, (int, float)):
                out.append(f"{k}: {v}")
            else:
                s = str(v).replace("\n", " ").strip()
                out.append(f"{k}: {s}")
        return "\n".join(out)

    today_iso = date.today().isoformat()

    def _write(rel: str, frontmatter: dict, body: str) -> None:
        path = (root / rel).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        text = f"---\n{_yaml_dump(frontmatter)}\n---\n\n{body.rstrip()}\n"
        path.write_text(text, encoding="utf-8")

    DISCLAIMER = (
        "> Informational only — not a medical device. Confirm with a "
        "CLIA-certified lab and a board-certified geneticist before any "
        "clinical action."
    )

    for rs, gene, gt, zyg, summary in samples:
        _write(
            f"wiki/sources/snpedia/{rs}.md",
            {
                "type": "source", "rsid": rs, "title": f"SNPedia source: {rs}",
                "summary": f"Raw SNPedia bundle entry for {rs}",
                "source_file": f"raw/snpedia/{rs}.md",
                "fetched_at": today_iso, "informational_only": True,
            },
            f"Provenance for [[raw/snpedia/{rs}]]. Demo seed.",
        )
        body = (
            f"## What it is\n\n"
            f"`{rs}` is a single-nucleotide variant in the {gene} gene. "
            f"Demo seed for the Orient → Genomic wiki browser. "
            f"[[sources/snpedia/{rs}]]\n\n"
            f"## Your data\n\n"
            f"Demo genotype: `{gt}` ({zyg}). [[sources/snpedia/{rs}]]\n\n"
            f"## What it means\n\n"
            f"{summary} [[sources/snpedia/{rs}]]\n\n"
            f"## What we don't know\n\n"
            f"Ancestry-specific frequencies are not encoded in this demo seed.\n\n"
            f"{DISCLAIMER}"
        )
        _write(
            f"wiki/variants/{rs}_{gene}.md",
            {
                "type": "variant", "rsid": rs, "gene": gene,
                "my_genotype": gt, "my_zygosity": zyg,
                "evidence_strength": "moderate",
                "title": f"{rs} ({gene})",
                "summary": summary[:120],
                "source_paths": [f"sources/snpedia/{rs}"],
                "related": [f"genes/{gene}"],
                "last_reviewed": today_iso, "informational_only": True,
            },
            body,
        )

    by_gene: dict[str, list[tuple[str, str]]] = {}
    for rs, gene, _gt, _zyg, summary in samples:
        by_gene.setdefault(gene, []).append((rs, summary))
    for gene, vs in by_gene.items():
        bullets = "\n".join(
            f"- [[variants/{rs}_{gene}]] — {summary[:100]}" for rs, summary in vs
        )
        body = (
            f"## Overview\n\n"
            f"{gene} is tracked in your wiki because of variants flagged below. "
            f"Demo seed. [[sources/snpedia/{vs[0][0]}]]\n\n"
            f"## Your variants in {gene}\n\n{bullets}\n\n"
            f"## What we don't know\n\n"
            f"Demo content does not synthesise across full real variant context.\n\n"
            f"{DISCLAIMER}"
        )
        _write(
            f"wiki/genes/{gene}.md",
            {
                "type": "gene", "gene": gene, "title": f"{gene}",
                "summary": f"Demo gene page for {gene}",
                "last_reviewed": today_iso, "informational_only": True,
            },
            body,
        )

    methylation_body = (
        "## System overview\n\n"
        "The methylation cycle depends on MTHFR (and MTRR / MTR / COMT). Demo "
        "seed; in a real ingest this page would synthesise across all of the "
        "user's variants in this system. [[genes/MTHFR]]\n\n"
        "## What we don't know\n\n"
        "B12 / folate status from bloodwork is not yet integrated.\n\n"
        + DISCLAIMER
    )
    _write(
        "wiki/systems/methylation.md",
        {
            "type": "system", "system": "methylation",
            "title": "Methylation",
            "summary": "Folate/B12 cycle and downstream methyl-donor availability.",
            "last_reviewed": today_iso, "informational_only": True,
        },
        methylation_body,
    )

    index_lines = [
        "# Genome wiki index", "", "## variant", "",
    ]
    for rs, gene, _gt, _zyg, _s in samples:
        index_lines.append(f"- [[variants/{rs}_{gene}]]")
    index_lines.extend(["", "## gene", ""])
    for gene in by_gene:
        index_lines.append(f"- [[genes/{gene}]]")
    index_lines.extend(["", "## system", "", "- [[systems/methylation]]"])
    _write(
        "wiki/index.md",
        {
            "type": "index", "title": "Genome wiki index",
            "last_reviewed": today_iso, "informational_only": True,
        },
        "\n".join(index_lines),
    )

    log_path = root / "wiki" / "log.md"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(
        f"- {today_iso} — DEMO SEED — wrote {len(samples)} variants, "
        f"{len(by_gene)} genes, 1 system\n",
        encoding="utf-8",
    )

    backend.app._rebuild_wiki_index(conn)
    return 1


def seed_blood_pressure(conn: sqlite3.Connection, dates: list[date], rng: random.Random) -> int:
    now = datetime.utcnow().isoformat(timespec="seconds")
    count = 0
    for d in dates:
        if d.toordinal() % 3 != 0:
            continue
        for slot_time, sys_base, dia_base in (("08:15", 122, 78), ("21:45", 118, 75)):
            if rng.random() < 0.25:
                continue
            sys_v = sys_base + rng.randint(-6, 8)
            dia_v = dia_base + rng.randint(-5, 6)
            if sys_v <= dia_v:
                sys_v = dia_v + 30
            pulse_v = 60 + rng.randint(-4, 12) if rng.random() < 0.85 else None
            conn.execute(
                "INSERT INTO blood_pressure_entries "
                "(date, time, systolic_mmhg, diastolic_mmhg, pulse_bpm, notes, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (d.isoformat(), slot_time, sys_v, dia_v, pulse_v, None, now),
            )
            count += 1
    return count


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
        dates = date_range(DAYS)
        rng = random.Random(DEMO_SEED)
        seed_heart_rate(conn, dates, rng)
        seed_hrv(conn, dates, rng)
        seed_body_battery(conn, dates, rng)
        seed_sleep(conn, dates, rng)
        seed_stress(conn, dates, rng)
        seed_steps(conn, dates, rng)
        seed_weight(conn, dates, rng)
        seed_activities(conn, dates, rng)
        seed_workouts(conn, dates, rng)
        seed_cgm(conn, dates, rng)
        seed_cog_processing(conn, dates, rng)
        seed_blood_pressure(conn, dates, rng)
        seed_supplements(conn)
        seed_meals_and_water(conn)
        seed_nutrition_goals(conn)
        seed_planned_activities(conn)
        seed_genome(conn)
        seed_genome_wiki(conn)
        conn.commit()
        print("seed_demo: done", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
