"""FastAPI backend serving VitalScope health data from SQLite."""

import asyncio
import base64
import gzip
import hmac
import json
import logging
import math
import mimetypes
import os
import secrets
import sqlite3
import statistics
import uuid as _uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

import anthropic
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.plugins import REGISTRY as PLUGIN_REGISTRY, discover as discover_plugins
from backend.plugins.base import Plugin

DB_PATH = Path(os.environ.get("VITALSCOPE_DB", Path(__file__).parent.parent / "vitalscope.db"))
DEMO_MODE = os.environ.get("VITALSCOPE_DEMO") == "1"
ENV_NAME = os.environ.get("VITALSCOPE_ENV", "dev")
BUILD_SHA = os.environ.get("VITALSCOPE_SHA", "")
UPLOADS_DIR = Path(os.environ.get("VITALSCOPE_UPLOADS", DB_PATH.parent / "uploads"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# --- AI provider config ---
# VITALSCOPE_AI_PROVIDER picks which SDK we talk to. OpenRouter reuses the
# OpenAI SDK with a different base_url, so one adapter class serves both.
_AI_PROVIDER_RAW = os.environ.get("VITALSCOPE_AI_PROVIDER", "anthropic").lower()
if _AI_PROVIDER_RAW not in ("anthropic", "openai", "openrouter"):
    print(
        f"[vitalscope] unknown VITALSCOPE_AI_PROVIDER={_AI_PROVIDER_RAW!r}, falling back to 'anthropic'",
        flush=True,
    )
    _AI_PROVIDER_RAW = "anthropic"
AI_PROVIDER = _AI_PROVIDER_RAW

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

_DEFAULT_MODEL_BY_PROVIDER = {
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-4o",
    "openrouter": "anthropic/claude-sonnet-4.6",
}
AI_MODEL = os.environ.get(
    "VITALSCOPE_AI_MODEL", _DEFAULT_MODEL_BY_PROVIDER[AI_PROVIDER]
)
AI_EFFORT: str = os.environ.get("VITALSCOPE_AI_EFFORT", "medium")
AI_TIMEOUT_SEC = int(os.environ.get("VITALSCOPE_AI_TIMEOUT_SEC", "20"))
BLOODWORK_AI_TIMEOUT_SEC = int(os.environ.get("BLOODWORK_AI_TIMEOUT_SEC", "60"))
ORIENT_AI_TIMEOUT_SEC = int(os.environ.get("ORIENT_AI_TIMEOUT_SEC", "90"))
BRIEFING_AI_TIMEOUT_SEC = int(os.environ.get("BRIEFING_AI_TIMEOUT_SEC", "90"))
NIGHT_BRIEFING_AI_TIMEOUT_SEC = int(os.environ.get("NIGHT_BRIEFING_AI_TIMEOUT_SEC", "90"))

_AI_KEY_BY_PROVIDER = {
    "anthropic": ANTHROPIC_API_KEY,
    "openai": OPENAI_API_KEY,
    "openrouter": OPENROUTER_API_KEY,
}
# AI is available whenever the selected provider's key is set OR when demo
# mode is on (in which case the in-process DemoProvider returns canned
# tool-call payloads, so the analyse endpoints work without any API key).
AI_AVAILABLE = DEMO_MODE or bool(_AI_KEY_BY_PROVIDER[AI_PROVIDER])

# --- Auth (single shared password) ---
AUTH_PASSWORD = "JohnBoyd"
AUTH_COOKIE = "vitalscope_auth"
# Session secret: stable across restarts if VITALSCOPE_SESSION_SECRET is set
# (which it should be in prod via `flyctl secrets set`). Falls back to a
# per-process random value in dev, which means restarts invalidate cookies
# — acceptable for dev.
SESSION_SECRET = os.environ.get("VITALSCOPE_SESSION_SECRET") or secrets.token_urlsafe(32)


def _auth_token() -> str:
    """Opaque cookie value. HMAC of the session secret so it's unforgeable
    without the secret, but stable for a given secret so it survives
    round-trips without server-side session storage."""
    return hmac.new(SESSION_SECRET.encode(), b"vitalscope.authenticated", "sha256").hexdigest()


def _is_authenticated(request: Request) -> bool:
    return hmac.compare_digest(
        request.cookies.get(AUTH_COOKIE, ""), _auth_token()
    )

app = FastAPI(title="VitalScope API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    allow_credentials=True,
)


# --- Auth middleware + endpoints ---
# Any /api/* request other than the small allow-list below requires a valid
# auth cookie. Static frontend paths are never gated (the login UI has to
# load). Demo mode stays gated too — the cookie just needs to be set once.

_AUTH_PUBLIC_PATHS = {
    "/api/login",
    "/api/logout",
    "/api/auth/status",
    "/api/runtime",
}


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in _AUTH_PUBLIC_PATHS:
        if not _is_authenticated(request):
            return JSONResponse(
                {"detail": "not authenticated"}, status_code=401
            )
    return await call_next(request)


class LoginBody(BaseModel):
    password: str


@app.post("/api/login")
def login(body: LoginBody, response: Response):
    if not hmac.compare_digest(body.password, AUTH_PASSWORD):
        raise HTTPException(status_code=401, detail="wrong password")
    response.set_cookie(
        AUTH_COOKIE,
        _auth_token(),
        httponly=True,
        samesite="lax",
        secure=ENV_NAME == "prod",
        max_age=60 * 60 * 24 * 30,  # 30 days
        path="/",
    )
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(AUTH_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/status")
def auth_status(request: Request):
    return {"authenticated": _is_authenticated(request)}


@app.get("/api/runtime")
def runtime_info():
    return {
        "demo": DEMO_MODE,
        "env": ENV_NAME,
        "commit": BUILD_SHA,
        "ai_available": AI_AVAILABLE,
        "ai_provider": ("demo" if DEMO_MODE else AI_PROVIDER) if AI_AVAILABLE else None,
        "ai_model": ("demo" if DEMO_MODE else AI_MODEL) if AI_AVAILABLE else None,
    }


def _mask_key(k: str | None) -> str | None:
    if not k:
        return None
    return ("*" * (len(k) - 4) + k[-4:]) if len(k) > 4 else "****"


@app.get("/api/settings/ai")
def get_ai_settings(request: Request):
    if not _is_authenticated(request):
        raise HTTPException(status_code=401)
    return {
        "provider": AI_PROVIDER,
        "model": AI_MODEL,
        "effort": AI_EFFORT,
        "anthropic_key_hint": _mask_key(ANTHROPIC_API_KEY),
        "openai_key_hint": _mask_key(OPENAI_API_KEY),
        "openrouter_key_hint": _mask_key(OPENROUTER_API_KEY),
    }


class AiSettingsBody(BaseModel):
    provider: str
    model: str
    effort: str = "medium"
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    openrouter_api_key: str | None = None


@app.put("/api/settings/ai")
def update_ai_settings(body: AiSettingsBody, request: Request):
    if not _is_authenticated(request):
        raise HTTPException(status_code=401)
    if DEMO_MODE:
        raise HTTPException(status_code=403, detail="AI config is read-only in demo mode")
    if body.provider not in ("anthropic", "openai", "openrouter"):
        raise HTTPException(status_code=422, detail=f"Invalid provider: {body.provider!r}")
    if not body.model.strip():
        raise HTTPException(status_code=422, detail="model must not be empty")
    if body.effort not in ("low", "medium", "high"):
        raise HTTPException(status_code=422, detail=f"Invalid effort: {body.effort!r}")
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO ai_config (key, value) VALUES ('provider', ?)", (body.provider,))
    conn.execute("INSERT OR REPLACE INTO ai_config (key, value) VALUES ('model', ?)", (body.model,))
    conn.execute("INSERT OR REPLACE INTO ai_config (key, value) VALUES ('effort', ?)", (body.effort,))
    if body.anthropic_api_key is not None:
        conn.execute("INSERT OR REPLACE INTO ai_config (key, value) VALUES ('anthropic_api_key', ?)", (body.anthropic_api_key,))
    if body.openai_api_key is not None:
        conn.execute("INSERT OR REPLACE INTO ai_config (key, value) VALUES ('openai_api_key', ?)", (body.openai_api_key,))
    if body.openrouter_api_key is not None:
        conn.execute("INSERT OR REPLACE INTO ai_config (key, value) VALUES ('openrouter_api_key', ?)", (body.openrouter_api_key,))
    conn.commit()
    conn.close()
    _load_ai_config_from_db()
    return {
        "provider": AI_PROVIDER,
        "model": AI_MODEL,
        "effort": AI_EFFORT,
        "anthropic_key_hint": _mask_key(ANTHROPIC_API_KEY),
        "openai_key_hint": _mask_key(OPENAI_API_KEY),
        "openrouter_key_hint": _mask_key(OPENROUTER_API_KEY),
    }


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
            notes TEXT,
            is_work_day INTEGER
        )
        """
    )
    # Idempotent ALTER for DBs that predate is_work_day.
    existing = {r[1] for r in conn.execute("PRAGMA table_info(journal_entries)")}
    if "is_work_day" not in existing:
        conn.execute("ALTER TABLE journal_entries ADD COLUMN is_work_day INTEGER")
    conn.commit()
    conn.close()


ensure_journal_table()


def ensure_journal_questions_tables() -> None:
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS journal_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS journal_question_responses (
            date TEXT NOT NULL,
            question_id INTEGER NOT NULL,
            response TEXT NOT NULL,
            PRIMARY KEY (date, question_id),
            FOREIGN KEY (question_id) REFERENCES journal_questions(id) ON DELETE CASCADE
        )
        """
    )
    conn.commit()
    conn.close()


ensure_journal_questions_tables()


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


# CYP450 pharmacogenomics reference data.
# Substrates are for context only; half_life_hours drives the caffeine clearance model.
# Source: Flockhart DA Drug Interactions Table (Indiana University) + PharmGKB.
CYP_PHARMACOGENOMICS: dict[str, dict] = {
    "CYP1A2": {
        "label": "CYP1A2",
        "substrates": ["caffeine", "melatonin", "theophylline", "duloxetine"],
        "phenotypes": {
            "ultra_rapid": {
                "half_life_hours": 2.5,
                "label": "Ultra-rapid metaboliser",
                "description": "Clears caffeine ~2x faster than average. High doses may feel weak.",
            },
            "extensive": {
                "half_life_hours": 5.0,
                "label": "Extensive (normal) metaboliser",
                "description": "Population average. Standard caffeine sensitivity and clearance.",
            },
            "intermediate": {
                "half_life_hours": 7.0,
                "label": "Intermediate metaboliser",
                "description": "Slower clearance. Afternoon caffeine more likely to disturb sleep.",
            },
            "poor": {
                "half_life_hours": 10.0,
                "label": "Poor (slow) metaboliser",
                "description": "~2x longer clearance. Caffeine logged at noon may still be active at bedtime.",
            },
        },
        "default_phenotype": "extensive",
    },
    "CYP2D6": {
        "label": "CYP2D6",
        "substrates": ["codeine", "tramadol", "metoprolol", "tamoxifen", "many antidepressants"],
        "phenotypes": {
            "ultra_rapid": {
                "half_life_hours": None,
                "label": "Ultra-rapid metaboliser",
                "description": "Codeine converts rapidly to morphine — elevated adverse-effect risk. Antidepressant efficacy may be reduced.",
            },
            "extensive": {
                "half_life_hours": None,
                "label": "Extensive (normal) metaboliser",
                "description": "Standard drug response and clearance.",
            },
            "intermediate": {
                "half_life_hours": None,
                "label": "Intermediate metaboliser",
                "description": "Reduced enzyme activity. Monitor dose response carefully.",
            },
            "poor": {
                "half_life_hours": None,
                "label": "Poor metaboliser",
                "description": "Codeine is non-functional as an analgesic. Antidepressants and beta-blockers may require dose adjustment.",
            },
        },
        "default_phenotype": "extensive",
    },
    "CYP3A4": {
        "label": "CYP3A4",
        "substrates": ["testosterone", "statins", "ciclosporin", "midazolam", "many supplements and peptides"],
        "phenotypes": {
            "extensive": {
                "half_life_hours": None,
                "label": "Extensive (normal) metaboliser",
                "description": "Standard clearance of CYP3A4 substrates.",
            },
            "poor": {
                "half_life_hours": None,
                "label": "Poor metaboliser",
                "description": "Elevated substrate exposure. Consider spacing doses and starting lower.",
            },
        },
        "default_phenotype": "extensive",
    },
}


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


def ensure_daily_landing_tables() -> None:
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS nutrient_goals (
            nutrient_key TEXT PRIMARY KEY,
            amount       REAL NOT NULL,
            updated_at   TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS planned_activities (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            date                 TEXT NOT NULL,
            sport_type           TEXT NOT NULL,
            target_distance_m    REAL,
            target_duration_sec  INTEGER,
            notes                TEXT,
            created_at           TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_planned_date ON planned_activities(date)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS uploads (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            kind       TEXT NOT NULL CHECK (kind IN ('meal','form','bloodwork','genome')),
            date       TEXT NOT NULL,
            filename   TEXT NOT NULL,
            mime       TEXT NOT NULL,
            bytes      INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            meal_id                       INTEGER,
            body_composition_estimate_id  INTEGER,
            bloodwork_panel_id            INTEGER,
            genome_upload_id              INTEGER
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_uploads_kind_date ON uploads(kind, date)")
    # Migrate databases that predate the genome kind: SQLite can't ALTER a
    # CHECK, so rebuild the table whenever the kind whitelist is outdated.
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='uploads'").fetchone()
    if row and "'genome'" not in (row[0] or "") and "CHECK" in (row[0] or ""):
        _ec = {r[1] for r in conn.execute("PRAGMA table_info(uploads)")}
        _base = "id, kind, date, filename, mime, bytes, created_at"
        _extra = [c for c in ("meal_id", "body_composition_estimate_id", "bloodwork_panel_id") if c in _ec]
        _col_list = _base + (", " + ", ".join(_extra) if _extra else "")
        conn.executescript(
            f"""
            PRAGMA foreign_keys = OFF;
            CREATE TABLE uploads_new (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                kind       TEXT NOT NULL CHECK (kind IN ('meal','form','bloodwork','genome')),
                date       TEXT NOT NULL,
                filename   TEXT NOT NULL,
                mime       TEXT NOT NULL,
                bytes      INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                meal_id                       INTEGER,
                body_composition_estimate_id  INTEGER,
                bloodwork_panel_id            INTEGER,
                genome_upload_id              INTEGER
            );
            INSERT INTO uploads_new ({_col_list})
                SELECT {_col_list} FROM uploads;
            DROP TABLE uploads;
            ALTER TABLE uploads_new RENAME TO uploads;
            CREATE INDEX IF NOT EXISTS idx_uploads_kind_date ON uploads(kind, date);
            PRAGMA foreign_keys = ON;
            """
        )
    # Idempotent ALTERs for DBs that predate these columns.
    existing = {r[1] for r in conn.execute("PRAGMA table_info(uploads)")}
    if "meal_id" not in existing:
        conn.execute("ALTER TABLE uploads ADD COLUMN meal_id INTEGER")
    if "body_composition_estimate_id" not in existing:
        conn.execute("ALTER TABLE uploads ADD COLUMN body_composition_estimate_id INTEGER")
    if "bloodwork_panel_id" not in existing:
        conn.execute("ALTER TABLE uploads ADD COLUMN bloodwork_panel_id INTEGER")
    if "genome_upload_id" not in existing:
        conn.execute("ALTER TABLE uploads ADD COLUMN genome_upload_id INTEGER")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS body_composition_estimates (
            id                        INTEGER PRIMARY KEY AUTOINCREMENT,
            date                      TEXT NOT NULL,
            source                    TEXT NOT NULL CHECK (source IN ('form-check-ai')),
            source_upload_id          INTEGER,
            body_fat_pct              REAL,
            muscle_mass_category      TEXT,
            water_retention           TEXT,
            visible_definition        TEXT,
            posture_note              TEXT,
            symmetry_note             TEXT,
            fatigue_signs             TEXT,
            hydration_signs           TEXT,
            general_vigor_note        TEXT,
            notes                     TEXT,
            confidence                TEXT,
            created_at                TEXT NOT NULL,
            FOREIGN KEY (source_upload_id) REFERENCES uploads(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_body_comp_est_date ON body_composition_estimates(date)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bloodwork_panels (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            date              TEXT NOT NULL,
            source            TEXT NOT NULL CHECK (source IN ('bloodwork-ai','bloodwork-manual')),
            source_upload_id  INTEGER,
            lab_name          TEXT,
            notes             TEXT,
            confidence        TEXT,
            created_at        TEXT NOT NULL,
            FOREIGN KEY (source_upload_id) REFERENCES uploads(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bloodwork_panels_date ON bloodwork_panels(date)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bloodwork_results (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            panel_id        INTEGER NOT NULL,
            analyte         TEXT NOT NULL,
            value           REAL,
            value_text      TEXT,
            unit            TEXT,
            reference_low   REAL,
            reference_high  REAL,
            reference_text  TEXT,
            flag            TEXT,
            sort_order      INTEGER DEFAULT 0,
            FOREIGN KEY (panel_id) REFERENCES bloodwork_panels(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bloodwork_results_panel ON bloodwork_results(panel_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bloodwork_results_analyte ON bloodwork_results(analyte)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS genome_uploads (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            date             TEXT NOT NULL,
            source_upload_id INTEGER,
            variant_count    INTEGER NOT NULL DEFAULT 0,
            rs_count         INTEGER NOT NULL DEFAULT 0,
            chromosomes      TEXT,
            notes            TEXT,
            created_at       TEXT NOT NULL,
            FOREIGN KEY (source_upload_id) REFERENCES uploads(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_genome_uploads_date ON genome_uploads(date)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS genome_variants (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            genome_upload_id INTEGER NOT NULL,
            rs_id            TEXT NOT NULL,
            chrom            TEXT,
            pos              INTEGER,
            ref_allele       TEXT,
            alt_allele       TEXT,
            genotype         TEXT,
            created_at       TEXT NOT NULL,
            FOREIGN KEY (genome_upload_id) REFERENCES genome_uploads(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_genome_variants_upload ON genome_variants(genome_upload_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_genome_variants_rs ON genome_variants(rs_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS briefings (
            date         TEXT NOT NULL,
            kind         TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            model        TEXT NOT NULL,
            provider     TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            PRIMARY KEY (date, kind)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS caffeine_intake (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            date       TEXT NOT NULL,
            time       TEXT,
            mg         REAL NOT NULL,
            source     TEXT,
            notes      TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_caffeine_intake_date ON caffeine_intake(date)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cyp_phenotypes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            cyp        TEXT NOT NULL UNIQUE,
            phenotype  TEXT NOT NULL,
            source     TEXT NOT NULL DEFAULT 'manual',
            notes      TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


ensure_daily_landing_tables()



def _load_ai_config_from_db() -> None:
    """Override AI globals with DB-persisted values when env vars are absent."""
    global AI_PROVIDER, AI_MODEL, AI_EFFORT, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, AI_AVAILABLE, _ai_provider
    conn = get_db()
    rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM ai_config").fetchall()}
    conn.close()
    if not rows:
        return
    if not os.environ.get("VITALSCOPE_AI_PROVIDER"):
        raw = rows.get("provider", AI_PROVIDER)
        if raw in ("anthropic", "openai", "openrouter"):
            AI_PROVIDER = raw
    if not os.environ.get("VITALSCOPE_AI_MODEL"):
        AI_MODEL = rows.get("model") or _DEFAULT_MODEL_BY_PROVIDER[AI_PROVIDER]
    if not os.environ.get("VITALSCOPE_AI_EFFORT"):
        raw_effort = rows.get("effort", AI_EFFORT)
        if raw_effort in ("low", "medium", "high"):
            AI_EFFORT = raw_effort
    if not os.environ.get("ANTHROPIC_API_KEY"):
        ANTHROPIC_API_KEY = rows.get("anthropic_api_key", ANTHROPIC_API_KEY)
    if not os.environ.get("OPENAI_API_KEY"):
        OPENAI_API_KEY = rows.get("openai_api_key", OPENAI_API_KEY)
    if not os.environ.get("OPENROUTER_API_KEY"):
        OPENROUTER_API_KEY = rows.get("openrouter_api_key", OPENROUTER_API_KEY)
    _key_map = {"anthropic": ANTHROPIC_API_KEY, "openai": OPENAI_API_KEY, "openrouter": OPENROUTER_API_KEY}
    AI_AVAILABLE = DEMO_MODE or bool(_key_map[AI_PROVIDER])
    _ai_provider = None


_load_ai_config_from_db()


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
    is_work_day: Optional[bool] = None


@app.post("/api/journal")
def upsert_journal(entry: JournalEntry):
    conn = get_db()
    conn.execute(
        """
        INSERT INTO journal_entries
            (date, created_at, followed_supplements, drank_alcohol,
             alcohol_amount, morning_feeling, notes, is_work_day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            created_at = excluded.created_at,
            followed_supplements = excluded.followed_supplements,
            drank_alcohol = excluded.drank_alcohol,
            alcohol_amount = excluded.alcohol_amount,
            morning_feeling = excluded.morning_feeling,
            notes = excluded.notes,
            is_work_day = excluded.is_work_day
        """,
        (
            entry.date,
            datetime.utcnow().isoformat(timespec="seconds"),
            int(entry.followed_supplements),
            int(entry.drank_alcohol),
            entry.alcohol_amount if entry.drank_alcohol else None,
            entry.morning_feeling,
            entry.notes,
            None if entry.is_work_day is None else int(entry.is_work_day),
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
        "is_work_day": None if row["is_work_day"] is None else bool(row["is_work_day"]),
    }


class JournalQuestionIn(BaseModel):
    question: str
    sort_order: int = 0


def _row_to_question(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "question": row["question"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
    }


@app.get("/api/journal/questions")
def list_journal_questions():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM journal_questions ORDER BY sort_order, id"
    ).fetchall()
    conn.close()
    return [_row_to_question(r) for r in rows]


@app.post("/api/journal/questions")
def create_journal_question(body: JournalQuestionIn):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO journal_questions (question, sort_order, created_at) VALUES (?, ?, ?)",
        (body.question.strip(), body.sort_order, datetime.utcnow().isoformat(timespec="seconds")),
    )
    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM journal_questions WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return _row_to_question(row)


@app.put("/api/journal/questions/{q_id}")
def update_journal_question(q_id: int, body: JournalQuestionIn):
    conn = get_db()
    cur = conn.execute(
        "UPDATE journal_questions SET question = ?, sort_order = ? WHERE id = ?",
        (body.question.strip(), body.sort_order, q_id),
    )
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Question not found")
    conn.commit()
    row = conn.execute("SELECT * FROM journal_questions WHERE id = ?", (q_id,)).fetchone()
    conn.close()
    return _row_to_question(row)


@app.delete("/api/journal/questions/{q_id}")
def delete_journal_question(q_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM journal_questions WHERE id = ?", (q_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"status": "ok"}


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
        SELECT s.*, COALESCE(i.taken, 0) AS taken
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


class JournalResponseItem(BaseModel):
    question_id: int
    response: str


class JournalResponsesBody(BaseModel):
    items: list[JournalResponseItem]


@app.get("/api/journal/{entry_date}/responses")
def get_journal_responses(entry_date: str):
    conn = get_db()
    rows = conn.execute(
        """
        SELECT q.id AS question_id, q.question, COALESCE(r.response, '') AS response
        FROM journal_questions q
        LEFT JOIN journal_question_responses r
            ON r.question_id = q.id AND r.date = ?
        ORDER BY q.sort_order, q.id
        """,
        (entry_date,),
    ).fetchall()
    conn.close()
    return [{"question_id": r["question_id"], "question": r["question"], "response": r["response"]} for r in rows]


@app.post("/api/journal/{entry_date}/responses")
def save_journal_responses(entry_date: str, body: JournalResponsesBody):
    conn = get_db()
    for item in body.items:
        if item.response.strip():
            conn.execute(
                """
                INSERT INTO journal_question_responses (date, question_id, response)
                VALUES (?, ?, ?)
                ON CONFLICT(date, question_id) DO UPDATE SET response = excluded.response
                """,
                (entry_date, item.question_id, item.response.strip()),
            )
        else:
            conn.execute(
                "DELETE FROM journal_question_responses WHERE date = ? AND question_id = ?",
                (entry_date, item.question_id),
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
    source_upload_id: Optional[int] = None


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
    if body.source_upload_id is not None:
        conn.execute(
            "UPDATE uploads SET meal_id = ? WHERE id = ? AND kind = 'meal'",
            (new_id, body.source_upload_id),
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


# --- Nutrition goals ---

class NutritionGoalsBody(BaseModel):
    goals: dict[str, float]


@app.get("/api/nutrition/goals")
def get_nutrition_goals():
    conn = get_db()
    rows = conn.execute("SELECT nutrient_key, amount FROM nutrient_goals").fetchall()
    conn.close()
    return {r["nutrient_key"]: r["amount"] for r in rows}


@app.put("/api/nutrition/goals")
def put_nutrition_goals(body: NutritionGoalsBody):
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = get_db()
    conn.execute("DELETE FROM nutrient_goals")
    conn.executemany(
        "INSERT INTO nutrient_goals (nutrient_key, amount, updated_at) VALUES (?, ?, ?)",
        [(k, float(v), now) for k, v in body.goals.items()],
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "count": len(body.goals)}


# --- Planned activities (read-only in this version) ---

@app.get("/api/planned")
def list_planned(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        "SELECT id, date, sport_type, target_distance_m, target_duration_sec, notes "
        "FROM planned_activities WHERE date >= ? AND date <= ? ORDER BY date, id",
        (s, e),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Uploads (meal + form-check images + bloodwork PDFs/images) ---

MAX_UPLOAD_BYTES_IMAGE = 5 * 1024 * 1024
MAX_UPLOAD_BYTES_BLOODWORK = 10 * 1024 * 1024
MAX_UPLOAD_BYTES_GENOME = 50 * 1024 * 1024


@app.post("/api/uploads")
async def upload_file(
    kind: Literal["meal", "form", "bloodwork", "genome"] = Form(...),
    date: str = Form(...),
    file: UploadFile = File(...),
):
    ct = file.content_type or ""
    if kind == "bloodwork":
        if not (ct.startswith("image/") or ct == "application/pdf"):
            raise HTTPException(status_code=400, detail="image/* or application/pdf required")
        size_limit = MAX_UPLOAD_BYTES_BLOODWORK
    elif kind == "genome":
        if not (ct.startswith("text/") or ct in (
            "application/octet-stream", "application/gzip", "application/x-gzip",
        )):
            raise HTTPException(status_code=400, detail="VCF or VCF.gz file required")
        size_limit = MAX_UPLOAD_BYTES_GENOME
    else:
        if not ct.startswith("image/"):
            raise HTTPException(status_code=400, detail="image/* required")
        size_limit = MAX_UPLOAD_BYTES_IMAGE
    data = await file.read()
    if len(data) > size_limit:
        raise HTTPException(status_code=413, detail=f"file too large (max {size_limit // (1024*1024)} MB)")
    ext = mimetypes.guess_extension(ct) or ".bin"
    year, month = date[:4], date[5:7]
    target_dir = UPLOADS_DIR / year / month
    target_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{_uuid.uuid4().hex}{ext}"
    (target_dir / fname).write_bytes(data)
    rel = f"{year}/{month}/{fname}"
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO uploads (kind, date, filename, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (kind, date, rel, ct, len(data), now),
    )
    upload_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {
        "id": upload_id, "kind": kind, "date": date, "filename": rel,
        "mime": ct, "bytes": len(data), "created_at": now,
        "meal_id": None, "body_composition_estimate_id": None,
        "bloodwork_panel_id": None, "genome_upload_id": None,
    }


@app.get("/api/uploads")
def list_uploads(kind: Optional[Literal["meal", "form", "bloodwork", "genome"]] = None, date: Optional[str] = None):
    conn = get_db()
    clauses, params = [], []
    if kind:
        clauses.append("kind = ?")
        params.append(kind)
    if date:
        clauses.append("date = ?")
        params.append(date)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT id, kind, date, filename, mime, bytes, created_at, meal_id, body_composition_estimate_id, bloodwork_panel_id, genome_upload_id FROM uploads{where} ORDER BY id DESC",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/uploads/{upload_id}")
def get_upload(upload_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT filename, mime FROM uploads WHERE id = ?", (upload_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="upload not found")
    path = (UPLOADS_DIR / row["filename"]).resolve()
    # Guard against path traversal by confirming the resolved path is under UPLOADS_DIR.
    if not str(path).startswith(str(UPLOADS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid path")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file missing on disk")
    return FileResponse(path, media_type=row["mime"])


@app.delete("/api/uploads/{upload_id}")
def delete_upload(upload_id: int):
    conn = get_db()
    row = conn.execute("SELECT filename FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="upload not found")
    path = (UPLOADS_DIR / row["filename"]).resolve()
    if str(path).startswith(str(UPLOADS_DIR.resolve())) and path.is_file():
        path.unlink()
    conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


# --- AI meal analysis ---

_ai_logger = logging.getLogger("vitalscope.ai")


class AIProvider:
    """Common interface every provider adapter implements."""

    name: str
    model: str

    async def analyze_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        media_b64: str,
        mime: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        raise NotImplementedError

    async def analyze_text_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        raise NotImplementedError


class AnthropicProvider(AIProvider):
    name = "anthropic"

    def __init__(self, *, api_key: str, model: str) -> None:
        self.model = model
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

    async def analyze_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        media_b64: str,
        mime: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        tool_name = tool["name"]
        if mime == "application/pdf":
            media_block = {
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": media_b64},
            }
        else:
            media_block = {
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": media_b64},
            }
        try:
            response = await asyncio.wait_for(
                self._client.messages.create(
                    model=self.model,
                    max_tokens=4096,
                    system=system,
                    tools=[tool],
                    tool_choice={"type": "tool", "name": tool_name},
                    messages=[{
                        "role": "user",
                        "content": [
                            media_block,
                            {"type": "text", "text": user_text},
                        ],
                    }],
                ),
                timeout=timeout_sec,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=408, detail=f"Claude timed out after {timeout_sec}s")
        except anthropic.APIStatusError as e:
            _ai_logger.warning("Claude API error %s: %s", e.status_code, e.message)
            raise HTTPException(status_code=502, detail=f"Claude API error: {e.message}")
        except anthropic.APIConnectionError as e:
            _ai_logger.warning("Claude connection error: %s", e)
            raise HTTPException(status_code=502, detail="Claude connection error")

        tool_block = next(
            (b for b in response.content if getattr(b, "type", None) == "tool_use" and b.name == tool_name),
            None,
        )
        if tool_block is None:
            _ai_logger.warning("No tool_use block in Claude response: %s", response.content)
            raise HTTPException(status_code=502, detail="Claude did not return a tool_use block")
        return tool_block.input or {}

    async def analyze_text_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        tool_name = tool["name"]
        try:
            response = await asyncio.wait_for(
                self._client.messages.create(
                    model=self.model,
                    max_tokens=4096,
                    system=system,
                    tools=[tool],
                    tool_choice={"type": "tool", "name": tool_name},
                    messages=[{"role": "user", "content": user_text}],
                ),
                timeout=timeout_sec,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=408, detail=f"Claude timed out after {timeout_sec}s")
        except anthropic.APIStatusError as e:
            _ai_logger.warning("Claude API error %s: %s", e.status_code, e.message)
            raise HTTPException(status_code=502, detail=f"Claude API error: {e.message}")
        except anthropic.APIConnectionError as e:
            _ai_logger.warning("Claude connection error: %s", e)
            raise HTTPException(status_code=502, detail="Claude connection error")

        tool_block = next(
            (b for b in response.content if getattr(b, "type", None) == "tool_use" and b.name == tool_name),
            None,
        )
        if tool_block is None:
            _ai_logger.warning("No tool_use block in Claude response: %s", response.content)
            raise HTTPException(status_code=502, detail="Claude did not return a tool_use block")
        return tool_block.input or {}


class OpenAIProvider(AIProvider):
    """Serves both OpenAI (base_url=None) and OpenRouter (base_url=openrouter)."""

    def __init__(self, *, api_key: str, model: str, base_url: Optional[str], name: str) -> None:
        import openai  # deferred — avoid import cost when not selected

        self.name = name
        self.model = model
        self._openai = openai
        client_kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        self._client = openai.AsyncOpenAI(**client_kwargs)

    async def analyze_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        media_b64: str,
        mime: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        tool_name = tool["name"]
        if mime == "application/pdf":
            raise HTTPException(
                status_code=400,
                detail=f"{self.name} provider does not accept PDFs; upload an image or switch to Anthropic",
            )
        openai_tool = {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": tool.get("description", ""),
                "parameters": tool["input_schema"],
            },
        }
        messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{media_b64}"},
                    },
                ],
            },
        ]
        try:
            response = await asyncio.wait_for(
                self._client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=[openai_tool],
                    tool_choice={"type": "function", "function": {"name": tool_name}},
                    parallel_tool_calls=False,
                    max_tokens=4096,
                ),
                timeout=timeout_sec,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=408, detail=f"{self.name} timed out after {timeout_sec}s")
        except self._openai.APIStatusError as e:
            _ai_logger.warning("%s API error %s: %s", self.name, e.status_code, e.message)
            raise HTTPException(status_code=502, detail=f"{self.name} API error: {e.message}")
        except self._openai.APIConnectionError as e:
            _ai_logger.warning("%s connection error: %s", self.name, e)
            raise HTTPException(status_code=502, detail=f"{self.name} connection error")

        tool_calls = (response.choices[0].message.tool_calls or []) if response.choices else []
        call = next((c for c in tool_calls if c.function and c.function.name == tool_name), None)
        if call is None:
            _ai_logger.warning("No matching tool_call in %s response: %s", self.name, response)
            raise HTTPException(status_code=502, detail=f"{self.name} did not return a tool call")
        try:
            return json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError as e:
            _ai_logger.warning("Bad JSON in %s tool_call: %s", self.name, e)
            raise HTTPException(status_code=502, detail=f"{self.name} returned invalid tool-call JSON")

    async def analyze_text_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        tool_name = tool["name"]
        openai_tool = {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": tool.get("description", ""),
                "parameters": tool["input_schema"],
            },
        }
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ]
        try:
            response = await asyncio.wait_for(
                self._client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=[openai_tool],
                    tool_choice={"type": "function", "function": {"name": tool_name}},
                    parallel_tool_calls=False,
                    max_tokens=4096,
                ),
                timeout=timeout_sec,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=408, detail=f"{self.name} timed out after {timeout_sec}s")
        except self._openai.APIStatusError as e:
            _ai_logger.warning("%s API error %s: %s", self.name, e.status_code, e.message)
            raise HTTPException(status_code=502, detail=f"{self.name} API error: {e.message}")
        except self._openai.APIConnectionError as e:
            _ai_logger.warning("%s connection error: %s", self.name, e)
            raise HTTPException(status_code=502, detail=f"{self.name} connection error")

        tool_calls = (response.choices[0].message.tool_calls or []) if response.choices else []
        call = next((c for c in tool_calls if c.function and c.function.name == tool_name), None)
        if call is None:
            _ai_logger.warning("No matching tool_call in %s response: %s", self.name, response)
            raise HTTPException(status_code=502, detail=f"{self.name} did not return a tool call")
        try:
            return json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError as e:
            _ai_logger.warning("Bad JSON in %s tool_call: %s", self.name, e)
            raise HTTPException(status_code=502, detail=f"{self.name} returned invalid tool-call JSON")


class DemoProvider(AIProvider):
    """In-process provider used when VITALSCOPE_DEMO=1. Returns canned
    tool-call payloads matching each endpoint's schema so the UI works end
    to end without any external API. Adds a short sleep to mimic latency."""

    name = "demo"
    model = "demo"

    async def analyze_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        media_b64: str,
        mime: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        await asyncio.sleep(0.4)
        tool_name = tool.get("name")
        if tool_name == "record_meal_estimate":
            return _demo_meal_payload(tool)
        if tool_name == "record_form_check":
            return _demo_form_check_payload()
        if tool_name == "record_bloodwork_panel":
            return _demo_bloodwork_payload()
        return {}

    async def analyze_text_with_tool(
        self,
        *,
        system: str,
        user_text: str,
        tool: dict,
        timeout_sec: int,
    ) -> dict:
        await asyncio.sleep(0.4)
        tool_name = tool.get("name")
        if tool_name == "record_health_orientation":
            return _demo_orient_payload()
        if tool_name == "record_morning_briefing":
            return _demo_morning_briefing_payload()
        if tool_name == "record_night_briefing":
            return _demo_night_briefing_payload()
        return {}


def _demo_meal_payload(tool: dict) -> dict:
    nutrient_keys = list(
        tool.get("input_schema", {})
            .get("properties", {})
            .get("nutrients", {})
            .get("properties", {})
            .keys()
    )
    known = {
        "calories_kcal": 480,
        "protein_g": 32,
        "carbs_g": 55,
        "fat_g": 16,
        "fiber_g": 7,
        "saturated_fat_g": 4,
        "sodium_mg": 620,
        "sugar_g": 9,
    }
    nutrients = {k: known.get(k) for k in nutrient_keys}
    return {
        "suggested_name": "Demo grilled chicken bowl",
        "suggested_notes": "Mocked meal estimate — no external AI was called.",
        "confidence": "medium",
        "nutrients": nutrients,
    }


def _demo_form_check_payload() -> dict:
    return {
        "confidence": "medium",
        "notes": "Mocked form-check — no external AI was called.",
        "body_fat_pct": 18.0,
        "muscle_mass_category": "moderate",
        "water_retention": "mild",
        "visible_definition": "moderate",
        "fatigue_signs": "none",
        "hydration_signs": "neutral",
        "posture_note": "Relaxed stance, slight forward lean.",
        "symmetry_note": "Largely symmetric across upper body.",
        "general_vigor_note": "Appears well-rested.",
    }


def _demo_bloodwork_payload() -> dict:
    return {
        "collection_date": date.today().isoformat(),
        "lab_name": "Demo Labs",
        "confidence": "high",
        "notes": "Mocked panel — no external AI was called. One flagged result (LDL).",
        "results": [
            {"analyte": "Hemoglobin", "value": 14.8, "value_text": None, "unit": "g/dL",
             "reference_low": 13.5, "reference_high": 17.5, "reference_text": None, "flag": "normal"},
            {"analyte": "LDL Cholesterol", "value": 135, "value_text": None, "unit": "mg/dL",
             "reference_low": 0, "reference_high": 100, "reference_text": None, "flag": "high"},
            {"analyte": "HDL Cholesterol", "value": 58, "value_text": None, "unit": "mg/dL",
             "reference_low": 40, "reference_high": None, "reference_text": None, "flag": "normal"},
            {"analyte": "Fasting Glucose", "value": 92, "value_text": None, "unit": "mg/dL",
             "reference_low": 70, "reference_high": 99, "reference_text": None, "flag": "normal"},
            {"analyte": "TSH", "value": 2.1, "value_text": None, "unit": "mIU/L",
             "reference_low": 0.4, "reference_high": 4.0, "reference_text": None, "flag": "normal"},
            {"analyte": "Vitamin D, 25-OH", "value": 28, "value_text": None, "unit": "ng/mL",
             "reference_low": 30, "reference_high": 100, "reference_text": None, "flag": "low"},
            {"analyte": "Ferritin", "value": 120, "value_text": None, "unit": "ng/mL",
             "reference_low": 30, "reference_high": 400, "reference_text": None, "flag": "normal"},
        ],
    }


def _demo_orient_payload() -> dict:
    return {
        "overall_summary": (
            "Demo mode: wearable metrics are stable with no acute concerns across the 14-day window. "
            "HRV and resting HR are within baseline, sleep is adequate, and training load is moderate."
        ),
        "topics": [
            {
                "id": "health",
                "label": "Health",
                "summary": "Resting HR averaging 54 bpm and HRV within balanced baseline suggest good cardiovascular readiness.",
                "insights": [
                    "Resting HR: 54 bpm (7-day avg 55 bpm) — no upward drift.",
                    "SpO2 averaging 96% through the window — within normal range.",
                ],
                "alerts": [],
                "recommendations": ["Continue current recovery habits."],
            },
            {
                "id": "performance",
                "label": "Performance",
                "summary": "Training load is moderate with 3-4 sessions per week and consistent step count.",
                "insights": [
                    "Average 8,400 steps/day, above the 7,500 goal.",
                    "3 strength sessions logged in the past 7 days.",
                ],
                "alerts": [],
                "recommendations": ["Consider a deload week if fatigue accumulates over the next 7 days."],
            },
            {
                "id": "recovery",
                "label": "Recovery",
                "summary": "Sleep averaging 7.2 h with adequate deep and REM proportions.",
                "insights": [
                    "Sleep score averaging 72 (Good) over the window.",
                    "HRV last night (68 ms) above weekly average (62 ms) — positive recovery signal.",
                ],
                "alerts": [],
                "recommendations": ["Maintain consistent sleep timing to protect HRV baseline."],
            },
            {
                "id": "body_composition",
                "label": "Body Composition",
                "summary": "Weight stable; no significant trend in body fat or muscle mass.",
                "insights": [
                    "Weight: 82.4 kg (±0.6 kg over the window).",
                    "Body fat estimated at 17.2% — no meaningful change.",
                ],
                "alerts": [],
                "recommendations": ["Track protein intake to support muscle retention during training."],
            },
        ],
    }


def _demo_morning_briefing_payload() -> dict:
    return {
        "recovery_readout": (
            "HRV 68 ms (above 62 ms weekly avg), resting HR 52 bpm, body battery 84/100, "
            "sleep 7.4 h with 1.6 h deep — well recovered."
        ),
        "yesterday_carryover": (
            "Yesterday's 45-min Zone 2 run added moderate aerobic load; no residual fatigue signal. "
            "Protein intake was 112 g against a ~160 g target — consider a higher-protein first meal."
        ),
        "tonight_outlook": (
            "If training intensity stays low-to-moderate today, tonight's HRV should remain elevated. "
            "Aim for last caffeine before 14:00 and last meal 2–3 h before bed to protect sleep architecture."
        ),
        "whats_up": [
            "Morning supplements: Vitamin D 5000 IU, Magnesium Glycinate 400 mg — not yet logged.",
            "No meals logged yet today.",
        ],
        "whats_planned": [
            "No training sessions planned for today.",
            "Active recovery or light walk recommended given yesterday's run.",
        ],
        "suggestions": [
            "Protein deficit from yesterday (~48 g short): front-load protein at breakfast with eggs or Greek yogurt.",
            "Body battery charged to 84 — a moderate workout today is viable if planned.",
            "Last caffeine cut-off: 14:00 to protect deep sleep given yesterday's high sleep stress (28).",
            "HRV above baseline — good window for strength training if planned this week.",
        ],
    }


def _demo_night_briefing_payload() -> dict:
    return {
        "today_readout": (
            "Moderate training day — one strength session, 8,400 steps, average stress was elevated "
            "in the afternoon but body battery held above 50 through the evening."
        ),
        "sleep_debt_posture": (
            "You are carrying approximately 45 minutes of sleep debt from the past 5 nights versus "
            "your 7.5-hour goal. Tonight needs to be 7h 45min or better to start clearing the deficit. "
            "Last night's 6h 50min session kept debt accumulating — prioritise lights-out by 10:30 pm."
        ),
        "pre_sleep_checklist": [
            "Take evening supplements (Magnesium glycinate 400 mg, Zinc 15 mg) — not yet logged.",
            "Finish a final 300 ml glass of water to reach today's hydration target.",
            "Dim screens or switch to blue-light filter mode — it is past 9 pm.",
            "Set alarm no earlier than 6:15 am to protect a 7h 45min sleep window.",
            "Review tomorrow's training plan and lay out kit to reduce morning decision load.",
        ],
        "watch_outs": [
            {
                "issue": "Afternoon strength session ended at 5:30 pm — less than 4 hours before typical bedtime.",
                "mitigation": (
                    "Core temperature should normalise by 10 pm. A warm shower now can accelerate "
                    "the drop. Avoid intense activity after this point."
                ),
            },
            {
                "issue": "Last meal logged at 7:45 pm — digestion may still be active at sleep onset.",
                "mitigation": (
                    "Limit any additional eating. A small low-glycaemic snack (e.g. Greek yoghurt) "
                    "is acceptable if genuinely hungry, but avoid heavy carbs or fats."
                ),
            },
        ],
        "tomorrow_setup": [
            "Prep tomorrow's breakfast tonight — a high-protein meal ready to go reduces morning stress.",
            "Training kit is already noted in your plan; confirm it is laid out before bed.",
        ],
    }


_ai_provider: Optional[AIProvider] = None


def _get_ai_provider() -> AIProvider:
    global _ai_provider
    if _ai_provider is None:
        if DEMO_MODE:
            _ai_provider = DemoProvider()
        elif AI_PROVIDER == "anthropic":
            _ai_provider = AnthropicProvider(api_key=ANTHROPIC_API_KEY, model=AI_MODEL)
        elif AI_PROVIDER == "openai":
            _ai_provider = OpenAIProvider(
                api_key=OPENAI_API_KEY, model=AI_MODEL, base_url=None, name="openai"
            )
        elif AI_PROVIDER == "openrouter":
            _ai_provider = OpenAIProvider(
                api_key=OPENROUTER_API_KEY,
                model=AI_MODEL,
                base_url="https://openrouter.ai/api/v1",
                name="openrouter",
            )
        else:
            raise HTTPException(status_code=503, detail=f"unknown AI provider: {AI_PROVIDER}")
    return _ai_provider


class AnalyzeImageBody(BaseModel):
    upload_id: int
    user_notes: Optional[str] = None


def _build_analyze_tool_schema(conn: sqlite3.Connection) -> dict:
    """Build a strict tool-use schema from the live nutrient_defs table so a
    newly-added custom nutrient is picked up without a code change."""
    rows = conn.execute(
        "SELECT key, label, unit, category FROM nutrient_defs ORDER BY category, sort_order, key"
    ).fetchall()
    nutrient_props: dict = {}
    nutrient_keys: list[str] = []
    for r in rows:
        key = r["key"]
        nutrient_keys.append(key)
        nutrient_props[key] = {
            "type": ["number", "null"],
            "description": f"{r['label']} in {r['unit']} (category: {r['category']}). Use null if you can't tell from the image.",
        }
    return {
        "name": "record_meal_estimate",
        "description": "Record the estimated nutrient content of the depicted meal. Estimate a single serving as depicted. Prefer null over guessing.",
        "input_schema": {
            "type": "object",
            "properties": {
                "suggested_name": {
                    "type": "string",
                    "description": "A short human-readable meal name, e.g. 'Grilled salmon with rice and greens'.",
                },
                "suggested_notes": {
                    "type": "string",
                    "description": "Optional short free-text notes about what you observed (portion sizes, ingredients).",
                },
                "confidence": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Overall confidence in this estimate.",
                },
                "nutrients": {
                    "type": "object",
                    "description": "Per-nutrient estimates. Null means you can't tell.",
                    "properties": nutrient_props,
                    "required": nutrient_keys,
                    "additionalProperties": False,
                },
            },
            "required": ["suggested_name", "confidence", "nutrients"],
            "additionalProperties": False,
        },
    }


def _load_upload_media(
    conn: sqlite3.Connection, upload_id: int, expected_kind: str
) -> tuple[str, str]:
    """Look up an upload row, verify kind + existence on disk, return
    (base64 bytes, mime). Raises HTTPException for 404/400 cases.
    Caller owns conn lifecycle."""
    row = conn.execute(
        "SELECT kind, filename, mime FROM uploads WHERE id = ?",
        (upload_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="upload not found")
    if row["kind"] != expected_kind:
        raise HTTPException(status_code=400, detail=f"upload is not a {expected_kind} photo")
    path = (UPLOADS_DIR / row["filename"]).resolve()
    if not str(path).startswith(str(UPLOADS_DIR.resolve())) or not path.is_file():
        raise HTTPException(status_code=404, detail="file missing on disk")
    img_b64 = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return img_b64, row["mime"] or "image/jpeg"


async def _call_ai_tool(
    *,
    system: str,
    user_text: str,
    media_b64: str,
    mime: str,
    tool: dict,
    timeout_sec: Optional[int] = None,
) -> dict:
    """Run a vision tool-use call via the configured provider."""
    provider = _get_ai_provider()
    return await provider.analyze_with_tool(
        system=system,
        user_text=user_text,
        media_b64=media_b64,
        mime=mime,
        tool=tool,
        timeout_sec=timeout_sec if timeout_sec is not None else AI_TIMEOUT_SEC,
    )


async def _call_ai_text_tool(
    *,
    system: str,
    user_text: str,
    tool: dict,
    timeout_sec: Optional[int] = None,
) -> dict:
    """Run a text-only tool-use call via the configured provider (no image/PDF)."""
    provider = _get_ai_provider()
    return await provider.analyze_text_with_tool(
        system=system,
        user_text=user_text,
        tool=tool,
        timeout_sec=timeout_sec if timeout_sec is not None else AI_TIMEOUT_SEC,
    )


def _append_user_context(prompt_text: str, user_notes: Optional[str]) -> str:
    note = (user_notes or "").strip()
    if not note:
        return prompt_text
    return prompt_text + f"\n\nUser context (trust this over the image where they conflict):\n{note}"


@app.post("/api/meals/analyze-image")
async def analyze_meal_image(body: AnalyzeImageBody):
    if not AI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"AI analysis not configured (provider={AI_PROVIDER}, no API key set)",
        )

    conn = get_db()
    try:
        img_b64, mime = _load_upload_media(conn, body.upload_id, "meal")
        tool = _build_analyze_tool_schema(conn)
    finally:
        conn.close()

    system_prompt = (
        "You are a registered-dietitian-grade nutrient estimator. Given a meal photo, "
        "call record_meal_estimate with your best numeric estimate for each listed nutrient. "
        "Estimate a single serving as depicted. Never invent numbers — prefer null when uncertain. "
        "If the user provided context (ingredients, portion sizes, preparation), take it as ground "
        "truth over what you'd infer from the photo alone."
    )
    user_text = _append_user_context(
        "Estimate the nutrient content of this meal.", body.user_notes
    )

    payload = await _call_ai_tool(
        system=system_prompt,
        user_text=user_text,
        media_b64=img_b64,
        mime=mime,
        tool=tool,
    )

    raw_nutrients = payload.get("nutrients", {}) or {}
    nutrients: list[dict] = []
    unknown_keys: list[str] = []
    for key, value in raw_nutrients.items():
        if value is None:
            unknown_keys.append(key)
        else:
            try:
                nutrients.append({"nutrient_key": key, "amount": float(value)})
            except (TypeError, ValueError):
                unknown_keys.append(key)

    return {
        "model": _get_ai_provider().model,
        "suggested_name": payload.get("suggested_name") or "Meal",
        "suggested_notes": payload.get("suggested_notes") or "",
        "confidence": payload.get("confidence") or "medium",
        "nutrients": nutrients,
        "unknown_keys": sorted(unknown_keys),
    }


# --- Form-check body-composition analysis ---

_FORM_CHECK_TOOL = {
    "name": "record_form_check",
    "description": (
        "Record visible body-composition cues from a single photo. Prefer null over guessing; "
        "describe what you see, do not diagnose."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "confidence": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "Overall confidence. 'high' only when lighting + pose are favourable.",
            },
            "body_fat_pct": {
                "type": ["number", "null"],
                "description": "Estimated body-fat percentage (wide ±5% error band). Null if lighting/pose make it unreadable.",
            },
            "muscle_mass_category": {
                "type": ["string", "null"],
                "enum": ["low", "average", "moderate", "high", "very_high", None],
                "description": "Relative visible muscle mass.",
            },
            "water_retention": {
                "type": ["string", "null"],
                "enum": ["none", "mild", "moderate", "pronounced", None],
                "description": "Visible puffiness / smoothness from water retention.",
            },
            "visible_definition": {
                "type": ["string", "null"],
                "enum": ["low", "moderate", "high", "very_high", None],
                "description": "Muscle separation / vascularity visibility.",
            },
            "fatigue_signs": {
                "type": ["string", "null"],
                "enum": ["none", "mild", "moderate", "notable", None],
                "description": "Visible fatigue cues — eye droop, shoulder slump, complexion dullness.",
            },
            "hydration_signs": {
                "type": ["string", "null"],
                "enum": ["well_hydrated", "neutral", "mild_dehydration", "notable_dehydration", None],
                "description": "Visible hydration state — skin elasticity, eye clarity, lip fullness.",
            },
            "posture_note": {
                "type": ["string", "null"],
                "description": "One-sentence posture observation (e.g. rounded shoulders, anterior pelvic tilt).",
            },
            "symmetry_note": {
                "type": ["string", "null"],
                "description": "One-sentence symmetry / imbalance observation.",
            },
            "general_vigor_note": {
                "type": ["string", "null"],
                "description": "Cautious free-text read on general vigor. Observational only.",
            },
            "notes": {
                "type": "string",
                "description": "Overall summary paragraph for the user.",
            },
        },
        "required": ["confidence", "notes"],
        "additionalProperties": False,
    },
}

_FORM_CHECK_FIELDS = [
    "body_fat_pct",
    "muscle_mass_category",
    "water_retention",
    "visible_definition",
    "fatigue_signs",
    "hydration_signs",
    "posture_note",
    "symmetry_note",
    "general_vigor_note",
]


@app.post("/api/form-checks/analyze-image")
async def analyze_form_check_image(body: AnalyzeImageBody):
    if not AI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"AI analysis not configured (provider={AI_PROVIDER}, no API key set)",
        )

    conn = get_db()
    try:
        img_b64, mime = _load_upload_media(conn, body.upload_id, "form")
    finally:
        conn.close()

    system_prompt = (
        "You are estimating visible body-composition cues from a single photo. This is a "
        "cosmetic/lifestyle tool, not a medical assessment. Prefer null over guessing. "
        "Lighting, pose, pump, hydration, time of day, and camera angle dramatically affect "
        "visible definition — factor this into confidence. Body-fat % has a ±5% error band at "
        "best from a photo; return a midpoint only when you're reasonably sure. Describe what "
        "you see; do not diagnose. If the user provided context (training state, time since "
        "last meal, cut/bulk phase, lighting), trust it over what you infer from the photo."
    )
    user_text = _append_user_context(
        "Estimate visible body composition from this photo.", body.user_notes
    )

    payload = await _call_ai_tool(
        system=system_prompt,
        user_text=user_text,
        media_b64=img_b64,
        mime=mime,
        tool=_FORM_CHECK_TOOL,
    )

    unknown_keys: list[str] = []
    result: dict[str, Any] = {
        "model": _get_ai_provider().model,
        "confidence": payload.get("confidence") or "medium",
        "notes": payload.get("notes") or "",
    }
    for key in _FORM_CHECK_FIELDS:
        value = payload.get(key)
        if value is None or value == "":
            result[key] = None
            unknown_keys.append(key)
        else:
            result[key] = value
    result["unknown_keys"] = sorted(unknown_keys)
    return result


# --- Bloodwork analysis ---

_BLOODWORK_TOOL = {
    "name": "record_bloodwork_panel",
    "description": (
        "Record analytes from a blood-panel lab report. Copy analyte names exactly "
        "as they appear. Use value for numeric results, value_text for qualitative "
        "results like 'Negative'. Prefer null over guessing."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "collection_date": {
                "type": ["string", "null"],
                "description": "Lab draw date as YYYY-MM-DD, or null if unclear.",
            },
            "lab_name": {
                "type": ["string", "null"],
                "description": "Clinic or laboratory name as shown on the report.",
            },
            "confidence": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "Overall confidence in extraction quality.",
            },
            "results": {
                "type": "array",
                "description": "One entry per analyte on the report.",
                "items": {
                    "type": "object",
                    "properties": {
                        "analyte": {"type": "string"},
                        "value": {"type": ["number", "null"]},
                        "value_text": {"type": ["string", "null"]},
                        "unit": {"type": ["string", "null"]},
                        "reference_low": {"type": ["number", "null"]},
                        "reference_high": {"type": ["number", "null"]},
                        "reference_text": {"type": ["string", "null"]},
                        "flag": {
                            "type": ["string", "null"],
                            "enum": ["low", "normal", "high", "critical", None],
                        },
                    },
                    "required": ["analyte"],
                    "additionalProperties": False,
                },
            },
            "notes": {
                "type": "string",
                "description": "Short summary of the panel — highlights anything notable.",
            },
        },
        "required": ["confidence", "results", "notes"],
        "additionalProperties": False,
    },
}


@app.post("/api/bloodwork/analyze-upload")
async def analyze_bloodwork_upload(body: AnalyzeImageBody):
    if not AI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"AI analysis not configured (provider={AI_PROVIDER}, no API key set)",
        )
    conn = get_db()
    try:
        media_b64, mime = _load_upload_media(conn, body.upload_id, "bloodwork")
    finally:
        conn.close()

    system_prompt = (
        "You are extracting structured lab results from a blood panel report. "
        "Copy analyte names exactly as they appear. Use value for numeric results, "
        "value_text for qualitative ones. Use null for any reference bound not shown. "
        "Set flag based on how value compares to the reference range. "
        "Do not invent analytes that aren't on the page."
    )
    user_text = _append_user_context(
        "Extract every analyte on this lab report into the results array.", body.user_notes
    )

    payload = await _call_ai_tool(
        system=system_prompt,
        user_text=user_text,
        media_b64=media_b64,
        mime=mime,
        tool=_BLOODWORK_TOOL,
        timeout_sec=BLOODWORK_AI_TIMEOUT_SEC,
    )

    raw_results = payload.get("results") or []
    results: list[dict] = []
    for r in raw_results:
        if not isinstance(r, dict) or not r.get("analyte"):
            continue
        results.append({
            "analyte": str(r.get("analyte") or "").strip(),
            "value": _as_float_or_none(r.get("value")),
            "value_text": r.get("value_text") or None,
            "unit": r.get("unit") or None,
            "reference_low": _as_float_or_none(r.get("reference_low")),
            "reference_high": _as_float_or_none(r.get("reference_high")),
            "reference_text": r.get("reference_text") or None,
            "flag": r.get("flag") or None,
        })

    return {
        "model": _get_ai_provider().model,
        "confidence": payload.get("confidence") or "medium",
        "collection_date": payload.get("collection_date") or None,
        "lab_name": payload.get("lab_name") or None,
        "notes": payload.get("notes") or "",
        "results": results,
    }


def _as_float_or_none(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# --- Orient phase AI analysis ---

_ORIENT_ANALYSIS_TOOL = {
    "name": "record_health_orientation",
    "description": (
        "Record a structured health orientation summary split into topic areas. "
        "Each topic should include key insights with evidence context, any alerts "
        "or concerns, and actionable recommendations."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "overall_summary": {
                "type": "string",
                "description": "2-3 sentence big-picture read on current health state.",
            },
            "topics": {
                "type": "array",
                "description": "Analysis split by health domain.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "enum": ["health", "performance", "recovery", "body_composition"],
                            "description": "Topic identifier.",
                        },
                        "label": {
                            "type": "string",
                            "description": "Human-readable topic name.",
                        },
                        "summary": {
                            "type": "string",
                            "description": "1-2 sentence summary for this topic.",
                        },
                        "insights": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Key observations referencing actual data values. Include relevant evidence-based context where applicable.",
                        },
                        "alerts": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Genuine concerns that warrant attention. Leave empty if nothing is alarming.",
                        },
                        "recommendations": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Specific, actionable next steps based on the data.",
                        },
                    },
                    "required": ["id", "label", "summary", "insights", "alerts", "recommendations"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["overall_summary", "topics"],
        "additionalProperties": False,
    },
}


def _gather_orient_metrics(conn: sqlite3.Connection, window_days: int = 14) -> dict:
    today = date.today()
    end_date = today.isoformat()
    start_date = (today - timedelta(days=window_days)).isoformat()
    prev_start = (today - timedelta(days=window_days * 2)).isoformat()

    def rows_to_list(rows: list) -> list[dict]:
        return [dict(r) for r in rows]

    hr = rows_to_list(conn.execute(
        "SELECT date, resting_hr, avg_7d_resting_hr FROM heart_rate_daily "
        "WHERE date BETWEEN ? AND ? ORDER BY date",
        (start_date, end_date),
    ).fetchall())

    hrv = rows_to_list(conn.execute(
        "SELECT date, weekly_avg, last_night_avg, "
        "baseline_balanced_low, baseline_balanced_upper "
        "FROM hrv_daily WHERE date BETWEEN ? AND ? ORDER BY date",
        (start_date, end_date),
    ).fetchall())

    sleep = rows_to_list(conn.execute(
        "SELECT date, sleep_score, sleep_score_quality, "
        "ROUND(sleep_time_seconds / 3600.0, 1) AS sleep_hours, "
        "ROUND(deep_sleep_seconds / 3600.0, 1) AS deep_hours, "
        "ROUND(rem_sleep_seconds / 3600.0, 1) AS rem_hours, "
        "avg_spo2, avg_sleep_stress "
        "FROM sleep_daily WHERE date BETWEEN ? AND ? ORDER BY date",
        (start_date, end_date),
    ).fetchall())

    stress = rows_to_list(conn.execute(
        "SELECT date, avg_stress, max_stress FROM stress_daily "
        "WHERE date BETWEEN ? AND ? ORDER BY date",
        (start_date, end_date),
    ).fetchall())

    body_battery = rows_to_list(conn.execute(
        "SELECT date, charged, drained FROM body_battery_daily "
        "WHERE date BETWEEN ? AND ? ORDER BY date",
        (start_date, end_date),
    ).fetchall())

    steps = rows_to_list(conn.execute(
        "SELECT date, total_steps, step_goal FROM steps_daily "
        "WHERE date BETWEEN ? AND ? ORDER BY date",
        (start_date, end_date),
    ).fetchall())

    weight = rows_to_list(conn.execute(
        "SELECT date, weight_kg, body_fat_pct, muscle_mass_kg, bmi "
        "FROM weight_daily WHERE date BETWEEN ? AND ? "
        "AND weight_kg IS NOT NULL ORDER BY date",
        (prev_start, end_date),
    ).fetchall())

    workouts = rows_to_list(conn.execute(
        "SELECT w.date, w.name, "
        "COALESCE(SUM(CASE WHEN ws.set_type='working' THEN 1 ELSE 0 END), 0) AS working_sets, "
        "ROUND(COALESCE(SUM(CASE WHEN ws.set_type='working' "
        "THEN COALESCE(ws.weight_kg * ws.reps, 0) ELSE 0 END), 0), 1) AS volume_kg "
        "FROM workouts w LEFT JOIN workout_sets ws ON ws.workout_id = w.id "
        "WHERE w.date BETWEEN ? AND ? GROUP BY w.id ORDER BY w.date DESC LIMIT 10",
        (prev_start, end_date),
    ).fetchall())

    bp = conn.execute(
        "SELECT id, date, notes FROM bloodwork_panels ORDER BY date DESC LIMIT 1"
    ).fetchone()
    bloodwork = None
    if bp:
        flagged = rows_to_list(conn.execute(
            "SELECT analyte, value, value_text, unit, reference_low, reference_high, flag "
            "FROM bloodwork_results WHERE panel_id = ? AND flag IS NOT NULL AND flag != 'normal' "
            "ORDER BY sort_order LIMIT 20",
            (bp["id"],),
        ).fetchall())
        bloodwork = {
            "date": bp["date"],
            "notes": bp["notes"],
            "flagged_results": flagged,
        }

    return {
        "analysis_date": end_date,
        "window_days": window_days,
        "heart_rate": hr,
        "hrv": hrv,
        "sleep": sleep,
        "stress": stress,
        "body_battery": body_battery,
        "steps": steps,
        "weight": weight,
        "recent_workouts": workouts,
        "bloodwork": bloodwork,
    }


class OrientAnalyzeBody(BaseModel):
    window_days: int = 14


@app.post("/api/orient/analyze")
async def orient_analyze(body: OrientAnalyzeBody):
    if not AI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"AI analysis not configured (provider={AI_PROVIDER}, no API key set)",
        )

    conn = get_db()
    try:
        metrics = _gather_orient_metrics(conn, window_days=max(7, min(30, body.window_days)))
    finally:
        conn.close()

    metrics_json = json.dumps(metrics, indent=2, default=str)

    system_prompt = (
        "You are a personal health analyst with expertise in cardiovascular physiology, "
        "sports science, sleep science, and strength training. Interpret the user's "
        "wearable data and workout logs. Identify meaningful trends and anomalies, "
        "and provide evidence-based insights — where relevant, cite known research "
        "findings from your training data (e.g. studies on HRV, sleep stages, training load). "
        "Be specific: reference actual values from the data rather than giving generic advice. "
        "Alerts should flag genuine concerns only, not normal day-to-day variation. "
        "Recommendations must be actionable and grounded in the numbers shown. "
        "Compare the first half of the window to the second half where this is informative."
    )

    user_text = (
        f"Analyse my health data for the {metrics['window_days']}-day window "
        f"ending {metrics['analysis_date']}. Identify trends, compare recent values "
        "to earlier in the window, flag anything concerning, and give evidence-based "
        f"recommendations.\n\nData (JSON):\n{metrics_json}"
    )

    payload = await _call_ai_text_tool(
        system=system_prompt,
        user_text=user_text,
        tool=_ORIENT_ANALYSIS_TOOL,
        timeout_sec=ORIENT_AI_TIMEOUT_SEC,
    )

    topics = []
    for t in (payload.get("topics") or []):
        if not isinstance(t, dict) or not t.get("id"):
            continue
        topics.append({
            "id": str(t.get("id") or ""),
            "label": str(t.get("label") or t.get("id") or ""),
            "summary": str(t.get("summary") or ""),
            "insights": [str(i) for i in (t.get("insights") or []) if i],
            "alerts": [str(a) for a in (t.get("alerts") or []) if a],
            "recommendations": [str(r) for r in (t.get("recommendations") or []) if r],
        })

    return {
        "model": AI_MODEL,
        "analysis_date": metrics["analysis_date"],
        "window_days": metrics["window_days"],
        "overall_summary": str(payload.get("overall_summary") or ""),
        "topics": topics,
    }


# --- Morning briefing ---

_MORNING_BRIEFING_TOOL = {
    "name": "record_morning_briefing",
    "description": (
        "Record a structured morning briefing that synthesises last night's recovery, "
        "yesterday's training load, and today's plan into a single actionable read. "
        "Keep tone informative and non-prescriptive — frame observations around the "
        "user's own data, not generic health advice."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "recovery_readout": {
                "type": "string",
                "description": (
                    "One concise sentence capturing the body's state this morning. "
                    "Reference actual values: e.g. 'HRV 68 ms (above 62 ms baseline), "
                    "resting HR 52 bpm, body battery 84/100, sleep 7.4 h — well recovered.'"
                ),
            },
            "yesterday_carryover": {
                "type": "string",
                "description": (
                    "What from yesterday still matters today: accumulated fatigue, "
                    "sleep debt, nutrition gaps, or training adaptations. 1-2 sentences "
                    "grounded in the data."
                ),
            },
            "tonight_outlook": {
                "type": "string",
                "description": (
                    "How choices today will shape tonight's sleep quality and tomorrow's "
                    "recovery: caffeine cutoff, training intensity window, last-meal timing. "
                    "1-2 sentences grounded in the data."
                ),
            },
            "whats_up": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Scheduled or already-logged events for today: supplements, meals, "
                    "planned activities, journal note. Each item is one short bullet. "
                    "Leave empty if nothing is logged or planned."
                ),
            },
            "whats_planned": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "The day's planned structure: training sessions, fasting window, "
                    "nutrition targets. Each item is one short bullet. "
                    "Leave empty if nothing is planned."
                ),
            },
            "suggestions": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "2-4 concrete, non-prescriptive nudges grounded directly in the data. "
                    "Reference specific values. Avoid generic advice."
                ),
            },
        },
        "required": [
            "recovery_readout",
            "yesterday_carryover",
            "tonight_outlook",
            "whats_up",
            "whats_planned",
            "suggestions",
        ],
        "additionalProperties": False,
    },
}


def _gather_morning_metrics(conn: sqlite3.Connection) -> dict:
    today = date.today()
    yesterday = today - timedelta(days=1)
    today_str = today.isoformat()
    yesterday_str = yesterday.isoformat()

    def row_to_dict(row) -> Optional[dict]:
        return dict(row) if row else None

    def rows_to_list(rows) -> list[dict]:
        return [dict(r) for r in rows]

    sleep = row_to_dict(conn.execute(
        "SELECT date, sleep_score, sleep_score_quality, "
        "ROUND(sleep_time_seconds / 3600.0, 1) AS sleep_hours, "
        "ROUND(deep_sleep_seconds / 3600.0, 1) AS deep_hours, "
        "ROUND(rem_sleep_seconds / 3600.0, 1) AS rem_hours, "
        "ROUND(light_sleep_seconds / 3600.0, 1) AS light_hours, "
        "sleep_start, sleep_end, avg_spo2, avg_sleep_stress "
        "FROM sleep_daily WHERE date = ?",
        (today_str,),
    ).fetchone())

    hrv = row_to_dict(conn.execute(
        "SELECT weekly_avg, last_night_avg, "
        "baseline_balanced_low, baseline_balanced_upper "
        "FROM hrv_daily WHERE date = ?",
        (today_str,),
    ).fetchone())

    hr = row_to_dict(conn.execute(
        "SELECT resting_hr, avg_7d_resting_hr FROM heart_rate_daily WHERE date = ?",
        (today_str,),
    ).fetchone())

    body_battery = row_to_dict(conn.execute(
        "SELECT charged, drained FROM body_battery_daily WHERE date = ?",
        (today_str,),
    ).fetchone())

    garmin_sessions = rows_to_list(conn.execute(
        "SELECT name, sport_type, "
        "ROUND(duration_sec / 60.0) AS duration_min, "
        "ROUND(distance_m / 1000.0, 2) AS distance_km, "
        "avg_hr, calories, training_effect, anaerobic_te "
        "FROM garmin_activities WHERE date = ? ORDER BY start_time",
        (yesterday_str,),
    ).fetchall())

    strong_workouts = rows_to_list(conn.execute(
        "SELECT w.name, "
        "COALESCE(SUM(CASE WHEN ws.set_type='working' THEN 1 ELSE 0 END), 0) AS working_sets, "
        "ROUND(COALESCE(SUM(CASE WHEN ws.set_type='working' "
        "THEN COALESCE(ws.weight_kg * ws.reps, 0) ELSE 0 END), 0), 1) AS volume_kg "
        "FROM workouts w LEFT JOIN workout_sets ws ON ws.workout_id = w.id "
        "WHERE w.date = ? GROUP BY w.id ORDER BY w.date",
        (yesterday_str,),
    ).fetchall())

    steps = row_to_dict(conn.execute(
        "SELECT total_steps, step_goal FROM steps_daily WHERE date = ?",
        (yesterday_str,),
    ).fetchone())

    stress = row_to_dict(conn.execute(
        "SELECT avg_stress, max_stress FROM stress_daily WHERE date = ?",
        (yesterday_str,),
    ).fetchone())

    journal = row_to_dict(conn.execute(
        "SELECT morning_feeling, drank_alcohol, alcohol_amount, notes "
        "FROM journal_entries WHERE date = ?",
        (yesterday_str,),
    ).fetchone())

    nutrition = row_to_dict(conn.execute(
        "SELECT "
        "ROUND(SUM(CASE WHEN mn.nutrient_key='calories_kcal' THEN mn.amount ELSE 0 END)) AS calories_kcal, "
        "ROUND(SUM(CASE WHEN mn.nutrient_key='protein_g' THEN mn.amount ELSE 0 END)) AS protein_g, "
        "ROUND(SUM(CASE WHEN mn.nutrient_key='carbs_g' THEN mn.amount ELSE 0 END)) AS carbs_g, "
        "ROUND(SUM(CASE WHEN mn.nutrient_key='fat_g' THEN mn.amount ELSE 0 END)) AS fat_g "
        "FROM meals m JOIN meal_nutrients mn ON mn.meal_id = m.id "
        "WHERE m.date = ?",
        (yesterday_str,),
    ).fetchone())

    water = row_to_dict(conn.execute(
        "SELECT ROUND(SUM(amount_ml)) AS total_ml FROM water_intake WHERE date = ?",
        (yesterday_str,),
    ).fetchone())

    planned_activities = rows_to_list(conn.execute(
        "SELECT sport_type, target_distance_m, target_duration_sec, notes "
        "FROM planned_activities WHERE date = ? ORDER BY id",
        (today_str,),
    ).fetchall())

    supplements = rows_to_list(conn.execute(
        "SELECT s.name, s.dosage, s.time_of_day, COALESCE(i.taken, 0) AS taken "
        "FROM supplements s "
        "LEFT JOIN journal_supplement_intake i ON i.supplement_id = s.id AND i.date = ? "
        "ORDER BY s.sort_order",
        (today_str,),
    ).fetchall())

    bp = conn.execute(
        "SELECT id, date FROM bloodwork_panels ORDER BY date DESC LIMIT 1"
    ).fetchone()
    open_bloodwork_alerts: list[str] = []
    if bp:
        flagged = conn.execute(
            "SELECT analyte, value, value_text, unit, flag "
            "FROM bloodwork_results WHERE panel_id = ? "
            "AND flag IS NOT NULL AND flag != 'normal' "
            "ORDER BY sort_order LIMIT 10",
            (bp["id"],),
        ).fetchall()
        open_bloodwork_alerts = [
            f"{r['analyte']}: {r['value'] if r['value'] is not None else r['value_text']} "
            f"{r['unit'] or ''} ({r['flag']})"
            for r in flagged
        ]

    return {
        "briefing_date": today_str,
        "yesterday": yesterday_str,
        "last_night_sleep": sleep,
        "hrv": hrv,
        "resting_hr": hr,
        "body_battery_at_wake": body_battery,
        "yesterday_garmin_sessions": garmin_sessions,
        "yesterday_strong_workouts": strong_workouts,
        "yesterday_steps": steps,
        "yesterday_stress": stress,
        "yesterday_journal": journal,
        "yesterday_nutrition": nutrition,
        "yesterday_water": water,
        "todays_planned_activities": planned_activities,
        "todays_supplements": supplements,
        "open_bloodwork_alerts": open_bloodwork_alerts,
    }


class MorningBriefingBody(BaseModel):
    regenerate: bool = False


@app.post("/api/briefing/morning")
async def morning_briefing(body: MorningBriefingBody):
    if not AI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"AI analysis not configured (provider={AI_PROVIDER}, no API key set)",
        )

    today_str = date.today().isoformat()
    conn = get_db()
    try:
        if not body.regenerate:
            cached = conn.execute(
                "SELECT payload_json, model, provider, generated_at "
                "FROM briefings WHERE date = ? AND kind = 'morning'",
                (today_str,),
            ).fetchone()
            if cached:
                payload = json.loads(cached["payload_json"])
                return {
                    **payload,
                    "model": cached["model"],
                    "provider": cached["provider"],
                    "generated_at": cached["generated_at"],
                    "briefing_date": today_str,
                    "cached": True,
                }
        metrics = _gather_morning_metrics(conn)
    finally:
        conn.close()

    metrics_json = json.dumps(metrics, indent=2, default=str)

    system_prompt = (
        "You are a personal health assistant with expertise in recovery science, "
        "sleep physiology, and training load management. You produce a concise morning "
        "briefing that helps the user start the day with clarity: what their body is "
        "telling them, what yesterday's choices mean for today, and how today's choices "
        "will shape tonight's recovery. "
        "Be specific: always reference actual numbers from the data. "
        "Do not give medical advice. Avoid generic wellness platitudes. "
        "Keep tone practical and grounded."
    )

    user_text = (
        f"Generate my morning briefing for {today_str}. "
        "Last night's sleep, this morning's HRV/HR/body-battery, yesterday's training "
        "and nutrition, today's plan, and supplement schedule are all included below.\n\n"
        f"Data (JSON):\n{metrics_json}"
    )

    payload = await _call_ai_text_tool(
        system=system_prompt,
        user_text=user_text,
        tool=_MORNING_BRIEFING_TOOL,
        timeout_sec=BRIEFING_AI_TIMEOUT_SEC,
    )

    result = {
        "recovery_readout": str(payload.get("recovery_readout") or ""),
        "yesterday_carryover": str(payload.get("yesterday_carryover") or ""),
        "tonight_outlook": str(payload.get("tonight_outlook") or ""),
        "whats_up": [str(s) for s in (payload.get("whats_up") or []) if s],
        "whats_planned": [str(s) for s in (payload.get("whats_planned") or []) if s],
        "suggestions": [str(s) for s in (payload.get("suggestions") or []) if s],
    }

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn2 = get_db()
    try:
        conn2.execute(
            "INSERT OR REPLACE INTO briefings "
            "(date, kind, payload_json, model, provider, generated_at) "
            "VALUES (?, 'morning', ?, ?, ?, ?)",
            (today_str, json.dumps(result), AI_MODEL, AI_PROVIDER, generated_at),
        )
        conn2.commit()
    finally:
        conn2.close()

    return {
        **result,
        "model": AI_MODEL,
        "provider": AI_PROVIDER,
        "generated_at": generated_at,
        "briefing_date": today_str,
        "cached": False,
    }


# --- Night briefing AI analysis ---

_NIGHT_BRIEFING_TOOL = {
    "name": "record_night_briefing",
    "description": (
        "Record a structured end-of-day night briefing with pre-sleep guidance. "
        "Synthesise today's training, nutrition, stress, and supplement data into "
        "five concrete output blocks. Use only data explicitly provided. "
        "Do not give medical advice; frame as evidence-informed self-tracking insights."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "today_readout": {
                "type": "string",
                "description": (
                    "Honest one-line summary of what today was — training load, stress, "
                    "nutrition quality, and subjective feel if available."
                ),
            },
            "sleep_debt_posture": {
                "type": "string",
                "description": (
                    "2-3 sentences on rolling sleep debt versus the inferred goal, "
                    "what last night delivered, and what tonight's target needs to be."
                ),
            },
            "pre_sleep_checklist": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 3,
                "maxItems": 5,
                "description": (
                    "3-5 specific, actionable items still to do before bed. "
                    "Include unchecked evening supplements by name and dose, "
                    "outstanding hydration, wind-down actions, and alarm timing."
                ),
            },
            "watch_outs": {
                "type": "array",
                "description": (
                    "Things from today that risk degrading tonight's sleep, "
                    "each paired with a still-actionable mitigation. "
                    "Include late caffeine, late heavy meals, or late high-intensity training "
                    "only if they appear in today's data. Leave empty if nothing applies."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "issue": {
                            "type": "string",
                            "description": "The specific event or pattern that risks sleep.",
                        },
                        "mitigation": {
                            "type": "string",
                            "description": "What can still be done, or that the window has passed.",
                        },
                    },
                    "required": ["issue", "mitigation"],
                    "additionalProperties": False,
                },
            },
            "tomorrow_setup": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 2,
                "description": "1-2 nudges that seed tomorrow morning well.",
            },
        },
        "required": [
            "today_readout",
            "sleep_debt_posture",
            "pre_sleep_checklist",
            "watch_outs",
            "tomorrow_setup",
        ],
        "additionalProperties": False,
    },
}


def _gather_night_briefing_data(conn: sqlite3.Connection, target_date: str) -> dict:
    target = date.fromisoformat(target_date)
    yesterday = (target - timedelta(days=1)).isoformat()
    window_start = (target - timedelta(days=14)).isoformat()

    def rows_to_list(rows: list) -> list[dict]:
        return [dict(r) for r in rows]

    activities = rows_to_list(conn.execute(
        "SELECT name, sport_type, ROUND(duration_sec/60.0) AS duration_min, "
        "ROUND(distance_m/1000.0, 2) AS distance_km, avg_hr, calories, training_effect "
        "FROM garmin_activities WHERE date = ? ORDER BY start_time",
        (target_date,),
    ).fetchall())

    workouts = rows_to_list(conn.execute(
        "SELECT w.name, "
        "COALESCE(SUM(CASE WHEN ws.set_type='working' THEN 1 ELSE 0 END), 0) AS working_sets, "
        "ROUND(COALESCE(SUM(CASE WHEN ws.set_type='working' "
        "THEN COALESCE(ws.weight_kg * ws.reps, 0) ELSE 0 END), 0), 1) AS volume_kg "
        "FROM workouts w LEFT JOIN workout_sets ws ON ws.workout_id = w.id "
        "WHERE w.date = ? GROUP BY w.id ORDER BY w.end_date",
        (target_date,),
    ).fetchall())

    steps_row = conn.execute(
        "SELECT total_steps, step_goal FROM steps_daily WHERE date = ?",
        (target_date,),
    ).fetchone()
    steps = dict(steps_row) if steps_row else {}

    stress_row = conn.execute(
        "SELECT avg_stress, max_stress FROM stress_daily WHERE date = ?",
        (target_date,),
    ).fetchone()
    stress_today = dict(stress_row) if stress_row else {}

    hrv_row = conn.execute(
        "SELECT last_night_avg, weekly_avg, baseline_balanced_low, baseline_balanced_upper "
        "FROM hrv_daily WHERE date = ?",
        (yesterday,),
    ).fetchone()
    hrv_last_night = dict(hrv_row) if hrv_row else {}

    sleep_window = rows_to_list(conn.execute(
        "SELECT date, ROUND(sleep_time_seconds/3600.0, 1) AS sleep_hours, sleep_score, "
        "sleep_start, sleep_end "
        "FROM sleep_daily WHERE date BETWEEN ? AND ? ORDER BY date",
        (window_start, yesterday),
    ).fetchall())

    meal_rows = conn.execute(
        "SELECT id, time, name FROM meals WHERE date = ? ORDER BY time, id",
        (target_date,),
    ).fetchall()
    meals_today = []
    nutrition_totals: dict[str, float] = {}
    for meal in meal_rows:
        nutrients = {r["nutrient_key"]: r["amount"] for r in conn.execute(
            "SELECT nutrient_key, amount FROM meal_nutrients WHERE meal_id = ?",
            (meal["id"],),
        ).fetchall()}
        meals_today.append({"time": meal["time"], "name": meal["name"], "nutrients": nutrients})
        for k, v in nutrients.items():
            nutrition_totals[k] = round(nutrition_totals.get(k, 0) + v, 1)

    last_meal_row = conn.execute(
        "SELECT time FROM meals WHERE date = ? AND time IS NOT NULL ORDER BY time DESC LIMIT 1",
        (target_date,),
    ).fetchone()
    last_meal_time = last_meal_row["time"] if last_meal_row else None

    water_row = conn.execute(
        "SELECT COALESCE(SUM(amount_ml), 0) AS total FROM water_intake WHERE date = ?",
        (target_date,),
    ).fetchone()
    water_ml = water_row["total"] if water_row else 0

    evening_pending = rows_to_list(conn.execute(
        """
        SELECT s.name, s.dosage
        FROM supplements s
        LEFT JOIN journal_supplement_intake i ON i.supplement_id = s.id AND i.date = ?
        WHERE s.time_of_day = 'evening' AND COALESCE(i.taken, 0) = 0
        ORDER BY s.sort_order, s.id
        """,
        (target_date,),
    ).fetchall())

    all_supplements = rows_to_list(conn.execute(
        """
        SELECT s.name, s.dosage, s.time_of_day, COALESCE(i.taken, 0) AS taken
        FROM supplements s
        LEFT JOIN journal_supplement_intake i ON i.supplement_id = s.id AND i.date = ?
        ORDER BY CASE s.time_of_day WHEN 'morning' THEN 0 WHEN 'noon' THEN 1 WHEN 'evening' THEN 2 END,
                 s.sort_order, s.id
        """,
        (target_date,),
    ).fetchall())

    journal_row = conn.execute(
        "SELECT morning_feeling, notes, followed_supplements, drank_alcohol, "
        "alcohol_amount, is_work_day FROM journal_entries WHERE date = ?",
        (target_date,),
    ).fetchone()
    journal_entry = dict(journal_row) if journal_row else {}

    goal_rows = conn.execute("SELECT nutrient_key, amount FROM nutrient_goals").fetchall()
    nutrition_goals = {r["nutrient_key"]: r["amount"] for r in goal_rows}

    return {
        "target_date": target_date,
        "activities_today": activities,
        "workouts_today": workouts,
        "steps_today": steps,
        "stress_today": stress_today,
        "hrv_last_night": hrv_last_night,
        "sleep_last_14_days": sleep_window,
        "meals_today": meals_today,
        "last_meal_time": last_meal_time,
        "nutrition_totals_today": nutrition_totals,
        "nutrition_goals": nutrition_goals,
        "water_ml_today": water_ml,
        "evening_supplements_pending": evening_pending,
        "all_supplements_today": all_supplements,
        "journal_entry_today": journal_entry,
    }


class NightBriefingBody(BaseModel):
    date: Optional[str] = None
    regenerate: bool = False


@app.post("/api/briefing/night")
async def night_briefing(body: NightBriefingBody):
    if not AI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"AI analysis not configured (provider={AI_PROVIDER}, no API key set)",
        )

    target_date = body.date or date.today().isoformat()

    conn = get_db()
    try:
        if not body.regenerate:
            cached = conn.execute(
                "SELECT payload_json, model FROM briefings WHERE date = ? AND kind = 'night'",
                (target_date,),
            ).fetchone()
            if cached:
                return {
                    **json.loads(cached["payload_json"]),
                    "model": cached["model"],
                    "analysis_date": target_date,
                    "cached": True,
                }

        data = _gather_night_briefing_data(conn, target_date)
    finally:
        conn.close()

    data_json = json.dumps(data, indent=2, default=str)

    system_prompt = (
        "You are a personal health coach with expertise in sleep physiology, recovery science, "
        "and strength training. Analyse the user's day — training, nutrition, stress, supplements, "
        "and sleep history — and produce a structured night briefing to close the day well and "
        "set up tonight's sleep. Be specific: reference actual values, times, and names from the "
        "data. Alerts and watch-outs must be grounded in what actually happened today. "
        "Do not give medical advice. Frame insights as evidence-informed self-tracking observations. "
        "Tone is direct, calm, and practical — not a cheerleader, not alarmist."
    )

    user_text = (
        f"Generate a night briefing for {target_date}. "
        "Identify what needs to happen before bed, any sleep-risk factors from today, "
        f"and how to set up tomorrow.\n\nData (JSON):\n{data_json}"
    )

    payload = await _call_ai_text_tool(
        system=system_prompt,
        user_text=user_text,
        tool=_NIGHT_BRIEFING_TOOL,
        timeout_sec=NIGHT_BRIEFING_AI_TIMEOUT_SEC,
    )

    result = {
        "today_readout": str(payload.get("today_readout") or ""),
        "sleep_debt_posture": str(payload.get("sleep_debt_posture") or ""),
        "pre_sleep_checklist": [str(i) for i in (payload.get("pre_sleep_checklist") or []) if i],
        "watch_outs": [
            {
                "issue": str(wo.get("issue") or ""),
                "mitigation": str(wo.get("mitigation") or ""),
            }
            for wo in (payload.get("watch_outs") or [])
            if isinstance(wo, dict)
        ],
        "tomorrow_setup": [str(i) for i in (payload.get("tomorrow_setup") or []) if i],
    }

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = get_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO briefings "
            "(date, kind, payload_json, model, provider, generated_at) "
            "VALUES (?, 'night', ?, ?, ?, ?)",
            (target_date, json.dumps(result), AI_MODEL, AI_PROVIDER, generated_at),
        )
        conn.commit()
    finally:
        conn.close()

    return {**result, "model": AI_MODEL, "analysis_date": target_date, "cached": False}


# --- Bloodwork panels (CRUD) ---

class BloodworkResultIn(BaseModel):
    analyte: str
    value: Optional[float] = None
    value_text: Optional[str] = None
    unit: Optional[str] = None
    reference_low: Optional[float] = None
    reference_high: Optional[float] = None
    reference_text: Optional[str] = None
    flag: Optional[str] = None


class BloodworkPanelIn(BaseModel):
    date: str
    source: Literal["bloodwork-ai", "bloodwork-manual"] = "bloodwork-ai"
    source_upload_id: Optional[int] = None
    lab_name: Optional[str] = None
    notes: Optional[str] = None
    confidence: Optional[str] = None
    results: list[BloodworkResultIn] = []


def _row_to_panel(row: sqlite3.Row, results: Optional[list[sqlite3.Row]] = None) -> dict:
    out = {
        "id": row["id"],
        "date": row["date"],
        "source": row["source"],
        "source_upload_id": row["source_upload_id"],
        "lab_name": row["lab_name"],
        "notes": row["notes"],
        "confidence": row["confidence"],
        "created_at": row["created_at"],
    }
    if results is not None:
        out["results"] = [dict(r) for r in results]
    return out


@app.post("/api/bloodwork-panels")
def create_bloodwork_panel(body: BloodworkPanelIn):
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = get_db()
    try:
        cur = conn.execute(
            """INSERT INTO bloodwork_panels
               (date, source, source_upload_id, lab_name, notes, confidence, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                body.date, body.source, body.source_upload_id,
                body.lab_name, body.notes, body.confidence, now,
            ),
        )
        panel_id = cur.lastrowid
        for idx, r in enumerate(body.results):
            conn.execute(
                """INSERT INTO bloodwork_results
                   (panel_id, analyte, value, value_text, unit,
                    reference_low, reference_high, reference_text, flag, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    panel_id, r.analyte, r.value, r.value_text, r.unit,
                    r.reference_low, r.reference_high, r.reference_text, r.flag, idx,
                ),
            )
        if body.source_upload_id is not None:
            conn.execute(
                "UPDATE uploads SET bloodwork_panel_id = ? WHERE id = ? AND kind = 'bloodwork'",
                (panel_id, body.source_upload_id),
            )
        conn.commit()
        panel_row = conn.execute(
            "SELECT * FROM bloodwork_panels WHERE id = ?", (panel_id,)
        ).fetchone()
        result_rows = conn.execute(
            "SELECT * FROM bloodwork_results WHERE panel_id = ? ORDER BY sort_order, id",
            (panel_id,),
        ).fetchall()
    finally:
        conn.close()
    return _row_to_panel(panel_row, result_rows)


@app.get("/api/bloodwork-panels")
def list_bloodwork_panels(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    panels = conn.execute(
        """SELECT p.*, COUNT(r.id) AS result_count
           FROM bloodwork_panels p
           LEFT JOIN bloodwork_results r ON r.panel_id = p.id
           WHERE p.date >= ? AND p.date <= ?
           GROUP BY p.id
           ORDER BY p.date DESC, p.id DESC""",
        (s, e),
    ).fetchall()
    conn.close()
    return [{**dict(row), "result_count": row["result_count"]} for row in panels]


@app.get("/api/bloodwork-panels/{panel_id}")
def get_bloodwork_panel(panel_id: int):
    conn = get_db()
    panel = conn.execute(
        "SELECT * FROM bloodwork_panels WHERE id = ?", (panel_id,)
    ).fetchone()
    if not panel:
        conn.close()
        raise HTTPException(status_code=404, detail="panel not found")
    results = conn.execute(
        "SELECT * FROM bloodwork_results WHERE panel_id = ? ORDER BY sort_order, id",
        (panel_id,),
    ).fetchall()
    conn.close()
    return _row_to_panel(panel, results)


@app.delete("/api/bloodwork-panels/{panel_id}")
def delete_bloodwork_panel(panel_id: int):
    conn = get_db()
    exists = conn.execute(
        "SELECT 1 FROM bloodwork_panels WHERE id = ?", (panel_id,)
    ).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail="panel not found")
    conn.execute(
        "UPDATE uploads SET bloodwork_panel_id = NULL WHERE bloodwork_panel_id = ?",
        (panel_id,),
    )
    conn.execute("DELETE FROM bloodwork_panels WHERE id = ?", (panel_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


# --- Genome uploads (VCF parse + CRUD) ---

_TARGET_RS_IDS: frozenset = frozenset({
    "rs429358", "rs7412",       # APOE ε2/ε3/ε4
    "rs1801133", "rs1801131",   # MTHFR C677T, A1298C
    "rs731236", "rs1544410",    # VDR TaqI, BsmI
    "rs174546", "rs1535",       # FADS1, FADS2
    "rs1815739",                # ACTN3 R577X
    "rs762551",                 # CYP1A2 *1F
})

_CONV_PANELS = [
    {
        "id": "apoe",
        "label": "APOE × Lipids",
        "description": "APOE genotype is the strongest common genetic determinant of LDL-C, ApoB, and cardiovascular risk.",
        "rs_ids": ["rs429358", "rs7412"],
        "analyte_patterns": ["LDL", "ApoB", "Apolipoprotein B", "Lp(a)", "Lipoprotein(a)"],
    },
    {
        "id": "mthfr",
        "label": "MTHFR × Methylation",
        "description": "MTHFR variants reduce folate-to-methylfolate conversion, affecting homocysteine, B12, and methylation capacity.",
        "rs_ids": ["rs1801133", "rs1801131"],
        "analyte_patterns": ["Homocysteine", "Vitamin B12", "B12", "Cobalamin", "Folate", "Folic Acid"],
    },
    {
        "id": "vdr",
        "label": "VDR × Vitamin D",
        "description": "VDR variants affect vitamin D receptor sensitivity and 25(OH)D utilisation.",
        "rs_ids": ["rs731236", "rs1544410"],
        "analyte_patterns": ["25-OH", "25(OH)", "Vitamin D", "25-Hydroxy", "Calcidiol"],
    },
    {
        "id": "fads",
        "label": "FADS × Omega-3",
        "description": "FADS1/FADS2 variants reduce fatty acid desaturation efficiency, affecting conversion of ALA to EPA/DHA.",
        "rs_ids": ["rs174546", "rs1535"],
        "analyte_patterns": ["Omega-3", "Omega 3", "EPA", "DHA", "Fatty Acid Index"],
    },
    {
        "id": "actn3",
        "label": "ACTN3 × Training",
        "description": "ACTN3 R577X determines alpha-actinin-3 expression in fast-twitch fibres, influencing power versus endurance phenotype.",
        "rs_ids": ["rs1815739"],
        "analyte_patterns": [],
    },
    {
        "id": "cyp1a2",
        "label": "CYP1A2 × Caffeine",
        "description": "CYP1A2 controls caffeine metabolism rate. Slow metabolisers retain caffeine longer, with greater cardiovascular impact.",
        "rs_ids": ["rs762551"],
        "analyte_patterns": [],
    },
]


def _chrom_sort_key(c: str) -> tuple:
    stripped = c.lstrip("chr").lstrip("Chr")
    return (0, int(stripped), "") if stripped.isdigit() else (1, 0, stripped)


def _resolve_gt(format_str: str, sample_str: str, ref: str, alt_str: str) -> Optional[str]:
    try:
        fmt_fields = format_str.split(":")
        samp_fields = sample_str.split(":")
        gt_idx = fmt_fields.index("GT") if "GT" in fmt_fields else 0
        gt_raw = samp_fields[gt_idx] if gt_idx < len(samp_fields) else ""
        indices = gt_raw.replace("|", "/").split("/")
        allele_list = [ref] + alt_str.split(",")
        allele_map = {str(i): nuc for i, nuc in enumerate(allele_list)}
        allele_map["."] = None
        resolved = [allele_map.get(idx) for idx in indices]
        if any(a is None for a in resolved):
            return None
        return "/".join(sorted(resolved))
    except Exception:
        return None


def _count_alt(v: Optional[dict]) -> int:
    if not v:
        return 0
    geno = v.get("genotype") or ""
    alt = (v.get("alt_allele") or "").split(",")[0]
    if not alt or not geno:
        return 0
    return geno.split("/").count(alt)


def _has_geno(v: Optional[dict]) -> bool:
    return bool(v and v.get("genotype"))


def _interp_apoe(vmap: dict) -> dict:
    v1 = vmap.get("rs429358")
    v2 = vmap.get("rs7412")
    if not (_has_geno(v1) and _has_geno(v2)):
        return {"label": None, "risk_level": None,
                "risk_note": "APOE ε2/ε3/ε4 status requires both rs429358 and rs7412; one or both were absent from this genome file."}
    e4 = _count_alt(v1)
    e2 = _count_alt(v2)
    e3 = max(0, 2 - e4 - e2)
    alleles = sorted(["ε4"] * e4 + ["ε3"] * e3 + ["ε2"] * e2)
    label = f"APOE {alleles[0]}/{alleles[1]}" if len(alleles) == 2 else f"APOE {'/'.join(alleles)}"
    if e4 == 2:
        return {"label": label, "risk_level": "high",
                "risk_note": "Homozygous APOE ε4/ε4 substantially elevates LDL-C, ApoB, and lifetime cardiovascular risk. Statin therapy and aggressive lipid management are typically indicated."}
    if e4 == 1:
        return {"label": label, "risk_level": "elevated",
                "risk_note": "One APOE ε4 allele increases LDL-C and cardiovascular risk above the ε3/ε3 baseline. Dietary fat quality matters more than quantity; lipid response to diet may be blunted."}
    if e2 == 2:
        return {"label": label, "risk_level": "low",
                "risk_note": "APOE ε2/ε2 typically lowers LDL-C but can elevate Lp(a) and triglycerides. Monitor the full lipid panel rather than LDL alone."}
    if e2 == 1:
        return {"label": label, "risk_level": "low",
                "risk_note": "APOE ε2/ε3 is typically associated with lower LDL-C and mildly elevated triglycerides in some individuals."}
    return {"label": label, "risk_level": "low",
            "risk_note": "APOE ε3/ε3 (most common genotype) — standard lipid response to diet; routine monitoring sufficient."}


def _interp_mthfr(vmap: dict) -> dict:
    v1 = vmap.get("rs1801133")
    v2 = vmap.get("rs1801131")
    if not (_has_geno(v1) or _has_geno(v2)):
        return {"label": None, "risk_level": None,
                "risk_note": "MTHFR variants rs1801133 (C677T) and rs1801131 (A1298C) were not found in this genome file."}
    parts = []
    risk = "low"
    if _has_geno(v1):
        n = _count_alt(v1)
        if n == 1:
            parts.append("C677T heterozygous")
            risk = "elevated"
        elif n == 2:
            parts.append("C677T homozygous")
            risk = "high"
    if _has_geno(v2):
        n = _count_alt(v2)
        if n == 1:
            parts.append("A1298C heterozygous")
            if risk == "low":
                risk = "elevated"
        elif n == 2:
            parts.append("A1298C homozygous")
            if risk == "low":
                risk = "elevated"
    label = f"MTHFR {', '.join(parts)}" if parts else "MTHFR wild-type"
    if not parts:
        note = "No common MTHFR variants detected. Folate-to-methylfolate conversion appears unimpaired."
    elif risk == "high":
        note = "Homozygous MTHFR C677T substantially reduces enzyme activity (~30% of normal). Active methylfolate (5-MTHF) is typically more effective than standard folic acid. Monitor homocysteine; B12 and folate status are key."
    else:
        note = "Reduced MTHFR enzyme activity detected. Ensure adequate B12 and folate intake; consider methylated forms. Elevated homocysteine is possible — especially under low B12/folate conditions."
    return {"label": label, "risk_level": risk if parts else "low", "risk_note": note}


def _interp_vdr(vmap: dict) -> dict:
    v1 = vmap.get("rs731236")
    v2 = vmap.get("rs1544410")
    if not (_has_geno(v1) or _has_geno(v2)):
        return {"label": None, "risk_level": None,
                "risk_note": "VDR variants rs731236 (TaqI) and rs1544410 (BsmI) were not found in this genome file."}
    parts = []
    if _has_geno(v1):
        parts.append(f"TaqI {v1['genotype']}")
    if _has_geno(v2):
        parts.append(f"BsmI {v2['genotype']}")
    label = f"VDR {' · '.join(parts)}"
    note = "VDR variants can reduce vitamin D receptor sensitivity, meaning higher 25(OH)D levels may be needed for equivalent biological effect. Target serum 25(OH)D at the higher end of the optimal range (50–80 ng/mL)."
    return {"label": label, "risk_level": "elevated", "risk_note": note}


def _interp_fads(vmap: dict) -> dict:
    v1 = vmap.get("rs174546")
    v2 = vmap.get("rs1535")
    if not (_has_geno(v1) or _has_geno(v2)):
        return {"label": None, "risk_level": None,
                "risk_note": "FADS1/FADS2 variants rs174546 and rs1535 were not found in this genome file."}
    parts = []
    if _has_geno(v1):
        parts.append(f"FADS1 {v1['genotype']}")
    if _has_geno(v2):
        parts.append(f"FADS2 {v2['genotype']}")
    label = f"FADS {' · '.join(parts)}"
    note = "FADS variants reduce conversion of ALA to EPA/DHA. Pre-formed EPA/DHA from fish oil or algal oil is more effective than ALA-rich sources (flaxseed, chia) for this genotype."
    return {"label": label, "risk_level": "elevated", "risk_note": note}


def _interp_actn3(vmap: dict) -> dict:
    v = vmap.get("rs1815739")
    if not _has_geno(v):
        return {"label": None, "risk_level": None,
                "risk_note": "ACTN3 rs1815739 (R577X) was not found in this genome file."}
    n = _count_alt(v)
    if n == 0:
        label, note = "ACTN3 RR (power)", "Both ACTN3 alleles produce alpha-actinin-3 in fast-twitch fibres. Associated with sprint and power performance. Responds well to high-load, low-rep strength protocols."
    elif n == 1:
        label, note = "ACTN3 RX (mixed)", "One functional ACTN3 allele. Mixed power/endurance profile. Responds well to both strength and endurance training."
    else:
        label, note = "ACTN3 XX (endurance)", "No alpha-actinin-3 in fast-twitch fibres. Associated with endurance phenotype. Zone 2 aerobic work and sustained efforts play to this genotype’s strengths."
    return {"label": label, "risk_level": "low", "risk_note": note}


def _interp_cyp1a2(vmap: dict) -> dict:
    v = vmap.get("rs762551")
    if not _has_geno(v):
        return {"label": None, "risk_level": None,
                "risk_note": "CYP1A2 rs762551 was not found in this genome file."}
    n = _count_alt(v)
    if n == 2:
        label, note = "CYP1A2 AA (fast metaboliser)", "Fast caffeine metaboliser. Pre-exercise caffeine is associated with improved performance. Cardiovascular impact of caffeine is lower at typical doses."
    elif n == 1:
        label, note = "CYP1A2 AC (intermediate)", "Intermediate caffeine metaboliser. Moderate intake is well tolerated; high doses late in the day may impair sleep."
    else:
        label, note = "CYP1A2 CC (slow metaboliser)", "Slow caffeine metaboliser. Higher plasma caffeine levels persist longer. Associated with elevated cardiovascular risk at high intake. Lower doses and an earlier daily cutoff are advisable."
    return {"label": label, "risk_level": "low", "risk_note": note}


_PANEL_INTERP = {
    "apoe": _interp_apoe,
    "mthfr": _interp_mthfr,
    "vdr": _interp_vdr,
    "fads": _interp_fads,
    "actn3": _interp_actn3,
    "cyp1a2": _interp_cyp1a2,
}


def _parse_vcf(path: Path, extract_rs: Optional[frozenset] = None) -> dict:
    with open(path, "rb") as _fcheck:
        is_gz = _fcheck.read(2) == b"\x1f\x8b"
    open_fn = (lambda p: gzip.open(p, "rt", encoding="utf-8", errors="replace")) if is_gz else (lambda p: open(p, "rt", encoding="utf-8", errors="replace"))
    variant_count = 0
    rs_count = 0
    chromosomes: set[str] = set()
    header_found = False
    extracted: dict[str, dict] = {}
    with open_fn(path) as fh:
        for line in fh:
            if line.startswith("##"):
                continue
            if line.startswith("#CHROM"):
                header_found = True
                continue
            parts = line.split("\t", 3)
            if len(parts) < 3:
                continue
            variant_count += 1
            chrom = parts[0].strip()
            if chrom:
                chromosomes.add(chrom)
            rs_id = parts[2].strip()
            if rs_id and rs_id != ".":
                rs_count += 1
                if extract_rs and rs_id in extract_rs and rs_id not in extracted:
                    cols = line.split("\t")
                    if len(cols) >= 10:
                        ref = cols[3].strip()
                        alt = cols[4].strip()
                        pos_str = cols[1].strip()
                        gt = _resolve_gt(cols[8].strip(), cols[9].strip(), ref, alt)
                        extracted[rs_id] = {
                            "chrom": chrom,
                            "pos": int(pos_str) if pos_str.lstrip("-").isdigit() else None,
                            "ref": ref,
                            "alt": alt,
                            "genotype": gt,
                        }
    if not header_found and variant_count == 0:
        raise ValueError("not a valid VCF file")
    return {
        "variant_count": variant_count,
        "rs_count": rs_count,
        "chromosomes": sorted(chromosomes, key=_chrom_sort_key),
        "targeted_variants": extracted,
    }


class GenomeParseBody(BaseModel):
    upload_id: int


class GenomeUploadIn(BaseModel):
    date: str
    source_upload_id: Optional[int] = None
    variant_count: int = 0
    rs_count: int = 0
    chromosomes: list[str] = []
    notes: Optional[str] = None


def _row_to_genome_upload(row: sqlite3.Row) -> dict:
    chroms = json.loads(row["chromosomes"] or "[]")
    return {
        "id": row["id"],
        "date": row["date"],
        "source_upload_id": row["source_upload_id"],
        "variant_count": row["variant_count"],
        "rs_count": row["rs_count"],
        "chromosomes": chroms,
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


@app.post("/api/genome/parse-upload")
def parse_genome_upload(body: GenomeParseBody):
    conn = get_db()
    row = conn.execute(
        "SELECT kind, filename FROM uploads WHERE id = ?", (body.upload_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="upload not found")
    if row["kind"] != "genome":
        raise HTTPException(status_code=400, detail="upload is not a genome file")
    path = (UPLOADS_DIR / row["filename"]).resolve()
    if not str(path).startswith(str(UPLOADS_DIR.resolve())) or not path.is_file():
        raise HTTPException(status_code=404, detail="file missing on disk")
    try:
        result = _parse_vcf(path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"VCF parse error: {exc}")
    return result


@app.post("/api/genome-uploads")
def create_genome_upload(body: GenomeUploadIn):
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO genome_uploads
           (date, source_upload_id, variant_count, rs_count, chromosomes, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            body.date, body.source_upload_id, body.variant_count, body.rs_count,
            json.dumps(body.chromosomes), body.notes, now,
        ),
    )
    genome_id = cur.lastrowid
    if body.source_upload_id is not None:
        conn.execute(
            "UPDATE uploads SET genome_upload_id = ? WHERE id = ? AND kind = 'genome'",
            (genome_id, body.source_upload_id),
        )
    conn.commit()
    if body.source_upload_id is not None:
        try:
            urow = conn.execute(
                "SELECT filename FROM uploads WHERE id = ?", (body.source_upload_id,)
            ).fetchone()
            if urow:
                path = (UPLOADS_DIR / urow["filename"]).resolve()
                if str(path).startswith(str(UPLOADS_DIR.resolve())) and path.is_file():
                    vcf_data = _parse_vcf(path, extract_rs=_TARGET_RS_IDS)
                    for rs_id, vdata in vcf_data["targeted_variants"].items():
                        conn.execute(
                            """INSERT INTO genome_variants
                               (genome_upload_id, rs_id, chrom, pos, ref_allele, alt_allele, genotype, created_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                            (genome_id, rs_id, vdata["chrom"], vdata["pos"],
                             vdata["ref"], vdata["alt"], vdata["genotype"], now),
                        )
                    conn.commit()
        except Exception:
            pass
    row = conn.execute("SELECT * FROM genome_uploads WHERE id = ?", (genome_id,)).fetchone()
    conn.close()
    return _row_to_genome_upload(row)


@app.get("/api/genome-uploads")
def list_genome_uploads(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM genome_uploads WHERE date >= ? AND date <= ? ORDER BY date DESC, id DESC",
        (s, e),
    ).fetchall()
    conn.close()
    return [_row_to_genome_upload(r) for r in rows]


@app.get("/api/genome-uploads/{genome_id}")
def get_genome_upload(genome_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM genome_uploads WHERE id = ?", (genome_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="genome upload not found")
    return _row_to_genome_upload(row)


@app.delete("/api/genome-uploads/{genome_id}")
def delete_genome_upload(genome_id: int):
    conn = get_db()
    exists = conn.execute("SELECT 1 FROM genome_uploads WHERE id = ?", (genome_id,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail="genome upload not found")
    conn.execute(
        "UPDATE uploads SET genome_upload_id = NULL WHERE genome_upload_id = ?", (genome_id,)
    )
    conn.execute("DELETE FROM genome_uploads WHERE id = ?", (genome_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


# --- Genotype × phenotype convergence ---

def _bloodwork_analytes(conn: sqlite3.Connection, patterns: list) -> list:
    if not patterns:
        return []
    seen: dict = {}
    for pattern in patterns:
        rows = conn.execute(
            """SELECT bp.date, br.analyte, br.value, br.unit, br.flag
               FROM bloodwork_results br
               JOIN bloodwork_panels bp ON bp.id = br.panel_id
               WHERE UPPER(br.analyte) LIKE UPPER(?)
               ORDER BY bp.date DESC LIMIT 20""",
            (f"%{pattern}%",),
        ).fetchall()
        for r in rows:
            key = (r["date"], r["analyte"].lower())
            if key not in seen:
                seen[key] = dict(r)
    return sorted(seen.values(), key=lambda x: x["date"])


def _weekly_volume(conn: sqlite3.Connection, weeks: int = 12) -> list:
    cutoff = (date.today() - timedelta(weeks=weeks)).isoformat()
    rows = conn.execute(
        """SELECT strftime('%Y-%W', w.date) AS week,
                  MIN(w.date) AS week_start,
                  COUNT(DISTINCT w.id) AS sessions,
                  ROUND(SUM(CASE WHEN ws.set_type='working'
                            THEN COALESCE(ws.weight_kg * ws.reps, 0) ELSE 0 END), 0) AS volume_kg
           FROM workouts w
           LEFT JOIN workout_sets ws ON ws.workout_id = w.id
           WHERE w.date >= ?
           GROUP BY week
           ORDER BY week""",
        (cutoff,),
    ).fetchall()
    return [dict(r) for r in rows]


def _omega3_supplements(conn: sqlite3.Connection) -> list:
    rows = conn.execute(
        """SELECT name FROM supplements
           WHERE UPPER(name) LIKE '%OMEGA%' OR UPPER(name) LIKE '%FISH OIL%'
           OR UPPER(name) LIKE '% EPA%' OR UPPER(name) LIKE '% DHA%'"""
    ).fetchall()
    return [r["name"] for r in rows]


@app.get("/api/orient/genotype-phenotype")
def get_genotype_phenotype():
    conn = get_db()
    genome_row = conn.execute(
        "SELECT id FROM genome_uploads ORDER BY date DESC, id DESC LIMIT 1"
    ).fetchone()
    if not genome_row:
        conn.close()
        return {"has_genome": False, "panels": []}
    variant_rows = conn.execute(
        "SELECT rs_id, ref_allele, alt_allele, genotype "
        "FROM genome_variants WHERE genome_upload_id = ?",
        (genome_row["id"],),
    ).fetchall()
    vmap = {r["rs_id"]: dict(r) for r in variant_rows}
    panels = []
    for pdef in _CONV_PANELS:
        pid = pdef["id"]
        interp = _PANEL_INTERP[pid](vmap)
        found_variants = [
            {"rs_id": rsid, "genotype": vmap[rsid].get("genotype")}
            for rsid in pdef["rs_ids"] if rsid in vmap
        ]
        bloodwork = _bloodwork_analytes(conn, pdef["analyte_patterns"])
        wearable = None
        if pid == "actn3":
            wearable = {"type": "weekly_volume", "data": _weekly_volume(conn)}
        elif pid == "fads" and not bloodwork:
            names = _omega3_supplements(conn)
            wearable = {"type": "supplements", "names": names}
        panels.append({
            "id": pid,
            "label": pdef["label"],
            "description": pdef["description"],
            "rs_ids": pdef["rs_ids"],
            "variants_found": found_variants,
            "interpretation": interp.get("label"),
            "risk_level": interp.get("risk_level"),
            "risk_note": interp.get("risk_note"),
            "bloodwork": bloodwork,
            "wearable": wearable,
        })
    conn.close()
    return {"has_genome": True, "panels": panels}


# --- Pharmacogenomics (CYP450 × caffeine / supplements) ---


def _compute_caffeine_curve(
    intakes: list[dict],
    half_life_h: float,
    day_date: str,
) -> list[dict]:
    day_start = datetime.strptime(day_date, "%Y-%m-%d")
    kel = math.log(2) / half_life_h
    points = []
    for h in range(5, 25):  # 05:00 → 24:00 (midnight)
        t_point = day_start + timedelta(hours=h)
        total_mg = 0.0
        for intake in intakes:
            t_str = (intake["time"] or "07:00")[:5]
            intake_dt = datetime.strptime(f"{intake['date']}T{t_str}", "%Y-%m-%dT%H:%M")
            hours_elapsed = (t_point - intake_dt).total_seconds() / 3600
            if hours_elapsed < 0:
                continue
            total_mg += intake["mg"] * math.exp(-kel * hours_elapsed)
        hour_label = h % 24
        points.append({
            "hours_since_midnight": hour_label,
            "time": f"{hour_label:02d}:00",
            "concentration_mg": round(max(0.0, total_mg), 1),
        })
    return points


@app.get("/api/pharmacogenomics/profile")
def get_pharmacogenomics_profile():
    conn = get_db()
    phenotype_rows = {
        r["cyp"]: dict(r)
        for r in conn.execute("SELECT * FROM cyp_phenotypes").fetchall()
    }
    has_genome = conn.execute("SELECT 1 FROM genome_uploads LIMIT 1").fetchone() is not None
    conn.close()
    cyps = []
    for cyp, cyp_data in CYP_PHARMACOGENOMICS.items():
        user_row = phenotype_rows.get(cyp)
        phenotype = user_row["phenotype"] if user_row else cyp_data["default_phenotype"]
        pheno_info = cyp_data["phenotypes"].get(
            phenotype, cyp_data["phenotypes"][cyp_data["default_phenotype"]]
        )
        cyps.append({
            "cyp": cyp,
            "label": cyp_data["label"],
            "substrates": cyp_data["substrates"],
            "phenotype": phenotype,
            "phenotype_source": user_row["source"] if user_row else "default",
            "phenotype_id": user_row["id"] if user_row else None,
            "phenotype_label": pheno_info["label"],
            "description": pheno_info["description"],
            "half_life_hours": pheno_info["half_life_hours"],
            "is_default": user_row is None,
            "all_phenotypes": [
                {
                    "key": k,
                    "label": v["label"],
                    "description": v["description"],
                    "half_life_hours": v["half_life_hours"],
                }
                for k, v in cyp_data["phenotypes"].items()
            ],
        })
    return {"has_genome": has_genome, "cyps": cyps}


class CypPhenotypeIn(BaseModel):
    cyp: str
    phenotype: str
    source: str = "manual"
    notes: Optional[str] = None


@app.post("/api/pharmacogenomics/phenotypes")
def upsert_cyp_phenotype(body: CypPhenotypeIn):
    if body.cyp not in CYP_PHARMACOGENOMICS:
        raise HTTPException(status_code=422, detail=f"Unknown CYP: {body.cyp!r}")
    valid_phenotypes = set(CYP_PHARMACOGENOMICS[body.cyp]["phenotypes"].keys())
    if body.phenotype not in valid_phenotypes:
        raise HTTPException(status_code=422, detail=f"Invalid phenotype {body.phenotype!r} for {body.cyp}")
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = get_db()
    conn.execute(
        """
        INSERT INTO cyp_phenotypes (cyp, phenotype, source, notes, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(cyp) DO UPDATE SET
            phenotype  = excluded.phenotype,
            source     = excluded.source,
            notes      = excluded.notes,
            created_at = excluded.created_at
        """,
        (body.cyp, body.phenotype, body.source, body.notes, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM cyp_phenotypes WHERE cyp = ?", (body.cyp,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/pharmacogenomics/phenotypes/{cyp}")
def delete_cyp_phenotype(cyp: str):
    conn = get_db()
    exists = conn.execute("SELECT 1 FROM cyp_phenotypes WHERE cyp = ?", (cyp,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail="phenotype not found")
    conn.execute("DELETE FROM cyp_phenotypes WHERE cyp = ?", (cyp,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


class CaffeineIntakeIn(BaseModel):
    date: str
    time: Optional[str] = None
    mg: float
    source: Optional[str] = None
    notes: Optional[str] = None


@app.get("/api/caffeine-intake")
def list_caffeine_intake(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM caffeine_intake WHERE date >= ? AND date <= ? ORDER BY date DESC, time ASC, id DESC",
        (s, e),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/caffeine-intake")
def create_caffeine_intake(body: CaffeineIntakeIn):
    if body.mg <= 0:
        raise HTTPException(status_code=422, detail="mg must be positive")
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO caffeine_intake (date, time, mg, source, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (body.date, body.time, body.mg, body.source, body.notes, now),
    )
    intake_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM caffeine_intake WHERE id = ?", (intake_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/caffeine-intake/{intake_id}")
def delete_caffeine_intake(intake_id: int):
    conn = get_db()
    exists = conn.execute("SELECT 1 FROM caffeine_intake WHERE id = ?", (intake_id,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail="intake not found")
    conn.execute("DELETE FROM caffeine_intake WHERE id = ?", (intake_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.get("/api/pharmacogenomics/concentration-curve")
def get_concentration_curve(date: Optional[str] = None):
    target_date = date or datetime.utcnow().date().isoformat()
    prev_date = (datetime.strptime(target_date, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    conn = get_db()
    pheno_row = conn.execute(
        "SELECT phenotype FROM cyp_phenotypes WHERE cyp = 'CYP1A2'"
    ).fetchone()
    phenotype = pheno_row["phenotype"] if pheno_row else "extensive"
    intakes = [
        dict(r) for r in conn.execute(
            "SELECT * FROM caffeine_intake WHERE date IN (?, ?) ORDER BY date, time",
            (prev_date, target_date),
        ).fetchall()
    ]
    conn.close()
    cyp1a2 = CYP_PHARMACOGENOMICS["CYP1A2"]
    half_life = cyp1a2["phenotypes"][phenotype]["half_life_hours"]
    baseline_hl = cyp1a2["phenotypes"]["extensive"]["half_life_hours"]
    curve = _compute_caffeine_curve(intakes, half_life, target_date)
    baseline = (
        _compute_caffeine_curve(intakes, baseline_hl, target_date)
        if phenotype != "extensive"
        else None
    )
    return {
        "date": target_date,
        "cyp1a2_phenotype": phenotype,
        "half_life_hours": half_life,
        "is_default": pheno_row is None,
        "curve": curve,
        "baseline_curve": baseline,
        "intakes": [i for i in intakes if i["date"] == target_date],
    }


# --- Body composition estimates (CRUD) ---

class BodyCompositionEstimateIn(BaseModel):
    date: str
    source_upload_id: Optional[int] = None
    body_fat_pct: Optional[float] = None
    muscle_mass_category: Optional[str] = None
    water_retention: Optional[str] = None
    visible_definition: Optional[str] = None
    posture_note: Optional[str] = None
    symmetry_note: Optional[str] = None
    fatigue_signs: Optional[str] = None
    hydration_signs: Optional[str] = None
    general_vigor_note: Optional[str] = None
    notes: Optional[str] = None
    confidence: Optional[str] = None


def _row_to_estimate(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "date": row["date"],
        "source": row["source"],
        "source_upload_id": row["source_upload_id"],
        "body_fat_pct": row["body_fat_pct"],
        "muscle_mass_category": row["muscle_mass_category"],
        "water_retention": row["water_retention"],
        "visible_definition": row["visible_definition"],
        "posture_note": row["posture_note"],
        "symmetry_note": row["symmetry_note"],
        "fatigue_signs": row["fatigue_signs"],
        "hydration_signs": row["hydration_signs"],
        "general_vigor_note": row["general_vigor_note"],
        "notes": row["notes"],
        "confidence": row["confidence"],
        "created_at": row["created_at"],
    }


@app.post("/api/body-composition-estimates")
def create_body_composition_estimate(body: BodyCompositionEstimateIn):
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn = get_db()
    cur = conn.execute(
        """
        INSERT INTO body_composition_estimates (
            date, source, source_upload_id,
            body_fat_pct, muscle_mass_category, water_retention, visible_definition,
            posture_note, symmetry_note, fatigue_signs, hydration_signs,
            general_vigor_note, notes, confidence, created_at
        )
        VALUES (?, 'form-check-ai', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            body.date,
            body.source_upload_id,
            body.body_fat_pct,
            body.muscle_mass_category,
            body.water_retention,
            body.visible_definition,
            body.posture_note,
            body.symmetry_note,
            body.fatigue_signs,
            body.hydration_signs,
            body.general_vigor_note,
            body.notes,
            body.confidence,
            now,
        ),
    )
    new_id = cur.lastrowid
    if body.source_upload_id is not None:
        conn.execute(
            "UPDATE uploads SET body_composition_estimate_id = ? WHERE id = ? AND kind = 'form'",
            (new_id, body.source_upload_id),
        )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM body_composition_estimates WHERE id = ?", (new_id,)
    ).fetchone()
    conn.close()
    return _row_to_estimate(row)


@app.get("/api/body-composition-estimates")
def list_body_composition_estimates(start: Optional[str] = None, end: Optional[str] = None):
    s, e = default_range(start, end)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM body_composition_estimates WHERE date >= ? AND date <= ? ORDER BY date DESC, id DESC",
        (s, e),
    ).fetchall()
    conn.close()
    return [_row_to_estimate(r) for r in rows]


@app.get("/api/body-composition-estimates/{estimate_id}")
def get_body_composition_estimate(estimate_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM body_composition_estimates WHERE id = ?", (estimate_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="estimate not found")
    return _row_to_estimate(row)


@app.delete("/api/body-composition-estimates/{estimate_id}")
def delete_body_composition_estimate(estimate_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT id FROM body_composition_estimates WHERE id = ?", (estimate_id,)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="estimate not found")
    conn.execute("DELETE FROM body_composition_estimates WHERE id = ?", (estimate_id,))
    conn.execute(
        "UPDATE uploads SET body_composition_estimate_id = NULL WHERE body_composition_estimate_id = ?",
        (estimate_id,),
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


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

    # Backfill params from env vars for any param that has an env_var and is currently unset.
    # Also enable the plugin if all required params are now populated.
    for name, plugin in PLUGIN_REGISTRY.items():
        row = conn.execute(
            "SELECT enabled, params_json FROM plugin_configs WHERE name=?", (name,)
        ).fetchone()
        if row is None:
            continue
        params = json.loads(row["params_json"] or "{}")
        changed = False
        for spec in plugin.param_schema:
            if spec.env_var and not params.get(spec.key):
                val = os.environ.get(spec.env_var, "")
                if val:
                    params[spec.key] = val
                    changed = True
        if changed:
            all_required_filled = all(
                params.get(s.key) for s in plugin.param_schema if s.required
            )
            new_enabled = 1 if all_required_filled else row["enabled"]
            conn.execute(
                "UPDATE plugin_configs SET params_json=?, enabled=? WHERE name=?",
                (json.dumps(params), new_enabled, name),
            )

    # Mark any plugin_runs that were still 'running' when the server last stopped.
    conn.execute(
        "UPDATE plugin_runs SET status='interrupted', finished_at=? WHERE status='running'",
        (datetime.now(timezone.utc).isoformat(),),
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


def _avg_duration_seconds(name: str) -> Optional[float]:
    conn = get_db()
    row = conn.execute(
        "SELECT AVG(CAST(strftime('%s', finished_at) AS REAL) - CAST(strftime('%s', started_at) AS REAL)) "
        "FROM (SELECT started_at, finished_at FROM plugin_runs "
        "      WHERE name=? AND status='ok' AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 10)",
        (name,),
    ).fetchone()
    conn.close()
    if row and row[0] is not None:
        return round(row[0], 1)
    return None


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
        "avg_duration_seconds": _avg_duration_seconds(plugin.name),
    }


class PluginUpdateBody(BaseModel):
    enabled: bool
    interval_minutes: int
    params: dict[str, Any] = {}


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_plugin_sync(name: str, run_id: Optional[int] = None, param_overrides: Optional[dict] = None) -> None:
    """Execute a plugin synchronously and record the run. Called from a threadpool."""
    plugin = PLUGIN_REGISTRY.get(name)
    if plugin is None:
        return
    cfg = _plugin_config_row(name) or {"params": {}}
    params = {**cfg["params"], **(param_overrides or {})}

    if run_id is None:
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


async def _run_plugin_async(name: str, run_id: Optional[int] = None, param_overrides: Optional[dict] = None) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _run_plugin_sync, name, run_id, param_overrides)


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
async def run_plugin_now(name: str, full: bool = False):
    plugin = PLUGIN_REGISTRY.get(name)
    if plugin is None:
        raise HTTPException(status_code=404, detail="plugin not found")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO plugin_runs (name, started_at, status) VALUES (?, ?, 'running')",
        (name, _utcnow()),
    )
    run_id = cur.lastrowid
    conn.commit()
    conn.close()
    overrides = {"full_sync": True, "all_history": True} if full else None
    asyncio.create_task(_run_plugin_async(name, run_id, overrides))
    return {"status": "started", "name": name, "run_id": run_id}


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
