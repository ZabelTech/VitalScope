# AGENTS.md

Guidance for Claude Code (and other AI agents) working on this repo. Read this before making changes.

## What this is

**VitalScope: The State of You** — a personal health dashboard that pulls data from Garmin Connect, the Strong gym tracker, and the EufyLife smart scale into a SQLite file (`vitalscope.db`) and visualises it with a FastAPI backend + Vite/React frontend. See `README.md` for the user-facing description.

## Workflow shortcuts

```bash
# Always run from /home/robert/vitalscope
cd /home/robert/vitalscope && source venv/bin/activate

# Backend (auto-reloads on Python edits)
uvicorn backend.app:app --reload --port 8000

# Frontend (proxies /api → :8000)
cd frontend && npm run dev        # → http://localhost:5173

# Type-check the frontend after changes
cd frontend && npx tsc --noEmit

# Inspect the DB
python3 -c "import sqlite3; c=sqlite3.connect('vitalscope.db'); c.row_factory=sqlite3.Row; ..."
```

**Backend reload**: if you edit `backend/app.py` while uvicorn is running without `--reload`, restart it manually or the new endpoint returns 404.

**No `venv` in subdirectories**: `source venv/bin/activate` only works from `/home/robert/vitalscope/`. If you `cd frontend && source venv/bin/activate`, you'll get "No such file".

## Where to put things

| Adding a… | Goes in |
|---|---|
| New sync data source | Two parts: (1) a new `sync_*.py` in the repo root following the pattern of `sync_garmin.py` / `sync_strong.py` (always include `--full` / `--all` + an incremental default); (2) a plugin wrapper in `backend/plugins/<name>.py` that calls `run_script_main("sync_xxx", env={...}, cli_args=[...])` and `register(Plugin(...))`. The plugin is auto-discovered at backend startup. |
| New backend endpoint | `backend/app.py` — it's intentionally one file. Use `conn = get_db()` + `conn.row_factory = sqlite3.Row`. Group endpoints under an existing `# --- Section ---` comment. |
| New chart | `frontend/src/components/XxxChart.tsx`. Follow `HeartRateChart.tsx` as a template: `useMetricData<T[]>("endpoint", start, end)`, `ResponsiveContainer`, `MetricCards` above, add to `TrendsPage.tsx`. |
| New "today" card | Today-snapshot cards live in `TodayDashboard.tsx` (Act → Today) and `TodayMetrics.tsx` (Observe → Today's metrics). Always wrap the `<h3>` with `<AgeBadge at={...}/>` so users see data freshness. `AgeBadge` is currently duplicated in both files; if you change it, change both. |
| New type | `frontend/src/types.ts`. Keep interfaces flat — the backend returns `sqlite3.Row` dicts, so types should mirror column names exactly. |
| New section under an existing OODA page | Preferred. Add an entry to the `sections` array of `ActPage` / `ObservePage` / `OrientPage` / `DecidePage` — each entry is `{ id, label, content }`. The `OodaPage` frame renders an anchor nav + stacked sections automatically. |
| New top-level route | Rare. If you really need one, add a `<Route>` in `App.tsx` and a `<NavLink>` in `NavBar.tsx`. Think twice before breaking the OODA layout — most new things are sections, not routes. `SettingsPage` is the current exception (utility, deliberately outside the loop). |

## Data model notes

- **Daily tables** (`*_daily`) have `date TEXT PRIMARY KEY`. Use `INSERT OR REPLACE` for upserts.
- **Readings tables** (`*_readings`) are intraday time-series with `PRIMARY KEY (date, timestamp)`.
- **Workouts** (Strong) have an interleaved set order: `workout_sets.set_type` is either `'working'` or `'rest'`. When counting sets / computing volume, **always filter `set_type = 'working'`** — otherwise rest-timer rows inflate the numbers. See existing queries in `backend/app.py` for the correct pattern (`SUM(CASE WHEN ws.set_type = 'working' ...)`).
- **HRV readings** are overnight-only (not continuous). Daily HRV rows start 2022-09-02 — the device upgrade date.
- **Timestamps**: stored as ISO 8601 UTC strings. `ms_to_iso()` in `sync_garmin.py` handles Garmin's millisecond epochs.
- **Supplements**: two tables. `supplements` is the master list (`name`, `dosage`, `time_of_day IN ('morning','noon','evening')`, `sort_order`). `journal_supplement_intake` is per-date check-off with `PRIMARY KEY (date, supplement_id)` and `ON DELETE CASCADE` from `supplements`. The `GET /api/journal/{date}/supplements` query uses `COALESCE(i.taken, 0)` so dates with no intake row default to **all unchecked** — the user has to affirmatively tick what they took (or hit "Mark all taken"). `journal_entries.followed_supplements` is kept for backwards compat and derived on journal save as `all(taken)` (or `true` when the master list is empty). IntakeLog auto-saves on every checkbox toggle.
- **Nutrition**: four tables using a key/value schema instead of a column-per-nutrient layout, because vitamins/minerals/bioactives are an open list.
  - `nutrient_defs(key PK, label, unit, category IN ('macro','mineral','vitamin','bioactive'), sort_order)` — the nutrient registry. Seeded on startup via `NUTRIENT_SEED` (~37 entries) using `INSERT OR IGNORE`, so the user can rename or delete seeded rows and restart without them reappearing.
  - `meals(id PK, date, time, name, notes, created_at)` — one row per logged meal.
  - `meal_nutrients(meal_id, nutrient_key, amount, PK(meal_id, nutrient_key))` — the actual values. `ON DELETE CASCADE` from `meals`; FK to `nutrient_defs(key)` so referenced definitions can't be deleted. `DELETE /api/nutrients/definitions/{key}` returns **409** if any `meal_nutrients` row references it — don't paper over this with a cascade, the user needs to know they're about to lose data.
  - `water_intake(id PK, date, time, amount_ml, created_at)` — per-drink entries; aggregate via `GET /api/water/daily` (`SUM(amount_ml) GROUP BY date`).
  - Daily nutrient totals via `GET /api/nutrition/daily` return `[{ date, totals: { key: amount } }]` — shape is deliberately keyed by nutrient so a chart can pluck one key without client-side grouping. When adding a chart, import `fetchNutritionDaily`/`fetchWaterDaily` directly rather than shoehorning into `useMetricData` (the shape doesn't match `fetchMetric`'s generic `T`).
- **Bloodwork**: two tables. `bloodwork_panels(id PK, date, source, source_upload_id, lab_name, notes, confidence, created_at)` — one row per lab report. `bloodwork_results(id PK, panel_id FK, analyte, value, value_text, unit, reference_low, reference_high, reference_text, flag, sort_order)` with `ON DELETE CASCADE` from panels. Values use `value` for numbers, `value_text` for qualitative results (`"Negative"` etc.) — never both. Reference ranges use the low/high pair for numeric ranges, `reference_text` for anything else. The AI parses PDFs only on the **anthropic** provider (OpenAI chat-completions can't ingest PDFs); `OpenAIProvider.analyze_with_tool` raises 400 on `application/pdf` mime.
- **Uploads**: `uploads.kind` is a `CHECK` whitelist `('meal','form','bloodwork')`. To add a new kind, extend `Literal` on `/api/uploads`, `/api/uploads` list, and run the table-rebuild migration in `ensure_daily_landing_tables` (SQLite can't `ALTER` a `CHECK`). Bloodwork uploads additionally accept `application/pdf` and use a 10 MB size cap (everything else stays at 5 MB).
- **Briefings**: `briefings(date, kind, payload_json, model, provider, generated_at, PRIMARY KEY (date, kind))` — one row per date+kind. `kind='morning'` is the morning briefing. `payload_json` is the full AI result as JSON. Subsequent requests for the same date+kind return the cached row; pass `{ "regenerate": true }` to `POST /api/briefing/morning` to force a fresh generation (overwrites the existing row with `INSERT OR REPLACE`).
- **Processing-speed task**: `cog_processing_sessions` stores one row per completed run (summary metrics + quality flags + interruption telemetry + deterministic `stimulus_seed`). `cog_processing_trials` stores per-trial payload (`PRIMARY KEY (session_id, trial_index)`, `ON DELETE CASCADE`). Use `POST /api/cognition/processing-speed/session` for writes and `GET /api/cognition/processing-speed/daily` / `GET /api/cognition/processing-speed/baseline` for trend + baseline reads. `journal_entries.avg_rt_ms` / `rt_trials` are still populated for backwards-compatible charts and should mirror the latest session summary for that date.

## Sync-script conventions

Every sync script must:

1. **Be incremental by default.** Query `MAX(date)` or the relevant cutoff from the DB, fetch only new data.
2. **Support `--full` / `--all`** to force a complete resync.
3. **Cache auth tokens** at `~/.<service>app` (e.g. `~/.garminconnect`, `~/.strongapp`).
4. **Read credentials from env vars** (`<SERVICE>_EMAIL`, `<SERVICE>_PASSWORD`) on first login.
5. **Use `python3 -u` / `print(..., flush=True)`** if the script has long-running phases — stdout buffering will hide progress.
6. **Expose a `main()`** that parses `sys.argv` and reads env vars — `backend/plugins/_script_runner.py` calls `main()` after patching argv+env, so any flag the CLI accepts has to work when passed through `cli_args`.
7. **Register a plugin wrapper** in `backend/plugins/<name>.py`. The wrapper maps plugin params → `cli_args` + env, then calls `run_script_main(...)` and returns a `RunResult`. The APScheduler in `backend/app.py` runs these on configured intervals and records every run in the `plugin_runs` table.
8. **Branch on demo mode at the wrapper layer.** Call `run_if_demo(generate_<source>, full=...)` from `backend/plugins/_demo_generators.py` before `run_script_main`. The generators reuse the per-source helpers in `seed_demo.py` to refresh the last 7 days in-place; if you add a new sync plugin, add a matching `generate_<source>` that calls those helpers so demo mode keeps working end to end.

`sync_garmin.py` specifically **always re-fetches the last 2 days** regardless of incremental state, because today's HR/stress/battery update throughout the day and last night's sleep isn't finalized until morning. Don't break this.

`sync_garmin.py` uses **two fetch patterns**. Most metrics (HR, HRV, sleep, stress, body battery) are per-day via `fetch_and_save(client, conn, day)` in the main loop. Steps use a single batched `client.get_daily_steps(start, end)` call after the loop (`save_steps_range`) — that endpoint returns the whole range at once, so don't force it through the per-day loop.

## Frontend conventions

- **Dark theme** only (see `index.css` — `#0f172a` bg, `#1e293b` cards, `#e2e8f0` text, blue `#3b82f6` accent). Don't add light mode.
- **No CSS framework** — use plain CSS classes in `index.css`. Follow existing `.overview-card`, `.metric-cards`, `.chart-section` naming.
- **Recharts** for all charts. Always wrap in `<ResponsiveContainer width="100%" height={300}>`. Use `connectNulls` for sparse data. Tick `fontSize: 11`.
- **Date format**: `YYYY-MM-DD` everywhere. Use `date-fns` `format(..., "yyyy-MM-dd")` and `subDays`.
- **Stat cards** come from `MetricCards.tsx` with `{label, stats, unit, decimals}`. Decimal default is 0.
- **Age badges** on today-snapshot cards come from the `AgeBadge` component currently defined inside `TodayDashboard.tsx` and `TodayMetrics.tsx` (duplicated — keep in sync if you edit). Pass either a `YYYY-MM-DD` string or a full ISO timestamp — the formatter handles both.
- **Color palette** for metrics:
  - HR: `#3b82f6` (blue) / `#22c55e` (min) / `#ef4444` (max)
  - HRV: `#8b5cf6` (purple)
  - Sleep stages: `#1e3a5f` deep / `#60a5fa` light / `#a78bfa` rem / `#fbbf24` awake
  - Stress: `#f97316` avg / `#ef4444` max
  - Body battery: `#22c55e` charged / `#ef4444` drained
  - Workouts/volume: `#8b5cf6`
  - Garmin sessions: `#3b82f6`

## Things to NOT do

- **Don't add tests** unless explicitly asked. There are none and the project doesn't need them.
- **Don't write code comments** by default. The repo style is uncommented. Only add a comment when the WHY is non-obvious (e.g. the `sync_garmin.py` "always re-fetch 2 days" comment, or the Strong pagination stop condition).
- **Don't add docstrings** to new functions unless the caller can't tell from the name.
- **Don't create new top-level directories** without reason. Keep the layout flat.
- **Don't add emojis** to code, comments, or UI.
- **Don't split `backend/app.py`** into multiple files. Single-file is intentional.
- **Don't skip `set_type = 'working'` filter** when querying workouts — silently wrong results.
- **Don't use `print()` without `flush=True`** in long-running sync loops.
- **Don't commit without being asked.** The user will ask when it's time.
- **Don't commit directly to `main`.** Every feature or fix goes on its own branch (`feat/…`, `fix/…`, `chore/…`) and lands through a pull request. The per-PR Fly preview deploy (`.github/workflows/preview-deploy.yml`) only fires on `pull_request` events — pushing straight to `main` skips both the preview and the implicit review step.
- **Don't run destructive SQL** (`DROP`, `DELETE` without WHERE) without explicit permission.
- **Don't add new routes when a section will do.** The OODA layout is the skeleton of the app; prefer adding a `{ id, label, content }` entry to an existing `OodaPage`'s `sections` array over creating another top-level page.

## Gotchas I learned the hard way

- **Strong's REST API has an infinite pagination bug**: `_links.next` stays populated even after `_embedded.log` becomes empty. Always stop on empty-logs, not on missing-next.
- **Strong API base URL**: `back.strong.app` (Azure Front Door) — the old `ws13.strongapp.co` (Heroku Parse Server) is in permanent maintenance mode and not coming back. Found via certificate transparency logs.
- **Strong auth is JWT with 20 min TTL.** `sync_strong.py` handles refresh via `/auth/login/refresh`.
- **Strong set types**: weight cells are `BARBELL_WEIGHT`, `DUMBBELL_WEIGHT`, `MACHINE_WEIGHT`, etc. — not just `WEIGHT`. The parser matches any `*_WEIGHT` cellType.
- **Garmin Connect 429s** on login frequently. The `garminconnect` library retries internally; don't panic if you see `mobile+cffi returned 429` on first login — it usually succeeds on the next attempt.
- **`client.get_activities()` can return a dict or a list.** The upstream type hint is `dict[str, Any] | list[Any]`; Garmin has wrapped the response in `{"activityList": [...]}` at times. `sync_garmin_activities.py` normalises both shapes via `_extract_activities_list` and raises on anything else, because the previous "silently break on non-list" path meant the plugin recorded status=ok with zero rows written.
- **SQLite ALTER TABLE is limited.** When you change a table schema in a sync script, drop & recreate rather than trying to `ALTER`.
- **Backend's `strftime('%Y-%W', ...)`** must be escaped as `'%%Y-%%W'` inside an f-string or Python `%` formatting will eat the percents.
- **FastAPI path routing order matters**: `/api/workouts/{workout_id}` must be registered *after* `/api/workouts/stats`, `/api/workouts/weekly-volume`, etc., or the more specific routes get matched by the `{workout_id}` variable.
- **Plugins re-enter the legacy sync scripts**: `_script_runner.py` patches `sys.argv` and credential env vars around `main()`. If a sync script reads globals at import time (not in `main()`), those globals get captured *once* at first import and won't reflect later runs with different credentials. Keep auth setup inside `main()`.
- **Sync scripts must honor `VITALSCOPE_DB`.** The backend reads `DB_PATH = Path(os.environ.get("VITALSCOPE_DB", <repo>/vitalscope.db))`; every `sync_*.py` must mirror that same env-var lookup at module scope. The Docker image sets `VITALSCOPE_DB=/data/vitalscope.db` so the DB lives on the persistent volume; any script that hardcodes `Path(__file__).parent / "vitalscope.db"` writes to ephemeral `/app/vitalscope.db` that the backend never reads, and the plugin run silently looks successful.

## Credentials

Stored in the user's environment or the user will paste them when asked. **Never commit credentials.** Token cache files (`~/.garminconnect`, `~/.strongapp`, `~/.eufylife`) are already in the user's home directory and should not be moved into the repo.

## AI analyser provider

The AI analysis endpoints go through a provider adapter selected at boot by `VITALSCOPE_AI_PROVIDER`. Defaults to `anthropic`.

| Provider | Env var for key | Default model |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4.6` |

Override the model with `VITALSCOPE_AI_MODEL` (applies to whichever provider is active). `/api/runtime` reports `ai_provider` and `ai_model` when a key is set. OpenRouter and OpenAI share a single adapter class (`OpenAIProvider` in `backend/app.py`); OpenRouter is just the OpenAI SDK pointed at `https://openrouter.ai/api/v1`.

Timeout env vars (all default shown):
- `VITALSCOPE_AI_TIMEOUT_SEC=20` — image/form-check analysis
- `BLOODWORK_AI_TIMEOUT_SEC=60` — bloodwork PDF/image extraction
- `ORIENT_AI_TIMEOUT_SEC=90` — orient-phase text analysis (more tokens)
- `BRIEFING_AI_TIMEOUT_SEC=90` — morning briefing text analysis

### AI provider interface

Both `AnthropicProvider` and `OpenAIProvider` implement two methods:
- `analyze_with_tool(system, user_text, media_b64, mime, tool, timeout_sec)` — vision input (image/PDF). Only Anthropic accepts PDFs.
- `analyze_text_with_tool(system, user_text, tool, timeout_sec)` — text-only input; no media. Used by the orient analysis and morning briefing endpoints.

When adding a new AI endpoint that doesn't need an image, use `_call_ai_text_tool(...)` instead of `_call_ai_tool(...)`.

### Orient AI analysis (`POST /api/orient/analyze`)

Aggregates the last 14 days (configurable via `window_days`, 7–30) of wearable and workout data from the DB — heart rate, HRV, sleep, stress, body battery, steps, weight, recent workouts, and the latest bloodwork panel's flagged results — then calls the configured AI provider via `analyze_text_with_tool` to produce a structured report split into four topics: `health`, `performance`, `recovery`, `body_composition`. Each topic includes `insights`, `alerts`, and `recommendations`. Frontend component: `OrientAiAnalysis.tsx` in the Orient → AI Analysis section.

### Morning briefing (`POST /api/briefing/morning`)

Aggregates today's recovery data (last night's sleep, HRV, resting HR, body battery) and yesterday's load (Garmin sessions, Strong workouts, steps, stress, nutrition, journal entry) plus today's plan (planned activities, supplements schedule), then calls the AI provider via `analyze_text_with_tool` to produce six fields: `recovery_readout`, `yesterday_carryover`, `tonight_outlook`, `whats_up`, `whats_planned`, `suggestions`. Result is cached per-date in the `briefings(date, kind, payload_json, model, provider, generated_at, PRIMARY KEY (date, kind))` table; pass `{ "regenerate": true }` to bypass the cache. Frontend component: `MorningBriefing.tsx` in Act → Morning briefing (top of Today).

When `VITALSCOPE_DEMO=1`, `_get_ai_provider()` short-circuits to `DemoProvider` (also in `backend/app.py`) — no API key is consulted, all analyse endpoints succeed, and the returned `model` / `ai_provider` strings are both `"demo"`. `DemoProvider.analyze_with_tool` dispatches on `tool["name"]` for vision endpoints (`_demo_meal_payload`, `_demo_form_check_payload`, `_demo_bloodwork_payload`); `DemoProvider.analyze_text_with_tool` dispatches for text-only endpoints (`_demo_orient_payload`, `_demo_morning_briefing_payload`). If you add a new analyse endpoint, add a matching case in the relevant method or the demo build will 500 on an empty dict.

## Before reporting a task done

- Frontend changes → `cd frontend && npx tsc --noEmit` must exit 0.
- Backend changes → hit the new/changed endpoint with `curl` to confirm it returns valid JSON, not a 500 / 404.
- Sync script changes → run the script once with the real incremental path (no `--full`) and confirm it doesn't re-fetch everything or infinite-loop.
- **Always review `README.md` and `AGENTS.md` after implementing a feature or fix** and update whatever is now stale: page/route lists, architecture tree, route-groups table, data-model notes, gotchas, and any conventions the change introduced or invalidated. Treat the docs as part of the task, not a follow-up.
