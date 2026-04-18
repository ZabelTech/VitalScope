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
- **Supplements**: two tables. `supplements` is the master list (`name`, `dosage`, `time_of_day IN ('morning','noon','evening')`, `sort_order`). `journal_supplement_intake` is per-date check-off with `PRIMARY KEY (date, supplement_id)` and `ON DELETE CASCADE` from `supplements`. The `GET /api/journal/{date}/supplements` query uses `COALESCE(i.taken, 1)` so dates with no intake row default to **all checked** — this is deliberate UX, don't "fix" it. `journal_entries.followed_supplements` is kept for backwards compat and derived on journal save as `all(taken)` (or `true` when the master list is empty).
- **Nutrition**: four tables using a key/value schema instead of a column-per-nutrient layout, because vitamins/minerals/bioactives are an open list.
  - `nutrient_defs(key PK, label, unit, category IN ('macro','mineral','vitamin','bioactive'), sort_order)` — the nutrient registry. Seeded on startup via `NUTRIENT_SEED` (~37 entries) using `INSERT OR IGNORE`, so the user can rename or delete seeded rows and restart without them reappearing.
  - `meals(id PK, date, time, name, notes, created_at)` — one row per logged meal.
  - `meal_nutrients(meal_id, nutrient_key, amount, PK(meal_id, nutrient_key))` — the actual values. `ON DELETE CASCADE` from `meals`; FK to `nutrient_defs(key)` so referenced definitions can't be deleted. `DELETE /api/nutrients/definitions/{key}` returns **409** if any `meal_nutrients` row references it — don't paper over this with a cascade, the user needs to know they're about to lose data.
  - `water_intake(id PK, date, time, amount_ml, created_at)` — per-drink entries; aggregate via `GET /api/water/daily` (`SUM(amount_ml) GROUP BY date`).
  - Daily nutrient totals via `GET /api/nutrition/daily` return `[{ date, totals: { key: amount } }]` — shape is deliberately keyed by nutrient so a chart can pluck one key without client-side grouping. When adding a chart, import `fetchNutritionDaily`/`fetchWaterDaily` directly rather than shoehorning into `useMetricData` (the shape doesn't match `fetchMetric`'s generic `T`).

## Sync-script conventions

Every sync script must:

1. **Be incremental by default.** Query `MAX(date)` or the relevant cutoff from the DB, fetch only new data.
2. **Support `--full` / `--all`** to force a complete resync.
3. **Cache auth tokens** at `~/.<service>app` (e.g. `~/.garminconnect`, `~/.strongapp`).
4. **Read credentials from env vars** (`<SERVICE>_EMAIL`, `<SERVICE>_PASSWORD`) on first login.
5. **Use `python3 -u` / `print(..., flush=True)`** if the script has long-running phases — stdout buffering will hide progress.
6. **Expose a `main()`** that parses `sys.argv` and reads env vars — `backend/plugins/_script_runner.py` calls `main()` after patching argv+env, so any flag the CLI accepts has to work when passed through `cli_args`.
7. **Register a plugin wrapper** in `backend/plugins/<name>.py`. The wrapper maps plugin params → `cli_args` + env, then calls `run_script_main(...)` and returns a `RunResult`. The APScheduler in `backend/app.py` runs these on configured intervals and records every run in the `plugin_runs` table.

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
- **SQLite ALTER TABLE is limited.** When you change a table schema in a sync script, drop & recreate rather than trying to `ALTER`.
- **Backend's `strftime('%Y-%W', ...)`** must be escaped as `'%%Y-%%W'` inside an f-string or Python `%` formatting will eat the percents.
- **FastAPI path routing order matters**: `/api/workouts/{workout_id}` must be registered *after* `/api/workouts/stats`, `/api/workouts/weekly-volume`, etc., or the more specific routes get matched by the `{workout_id}` variable.
- **Plugins re-enter the legacy sync scripts**: `_script_runner.py` patches `sys.argv` and credential env vars around `main()`. If a sync script reads globals at import time (not in `main()`), those globals get captured *once* at first import and won't reflect later runs with different credentials. Keep auth setup inside `main()`.

## Credentials

Stored in the user's environment or the user will paste them when asked. **Never commit credentials.** Token cache files (`~/.garminconnect`, `~/.strongapp`, `~/.eufylife`) are already in the user's home directory and should not be moved into the repo.

## Before reporting a task done

- Frontend changes → `cd frontend && npx tsc --noEmit` must exit 0.
- Backend changes → hit the new/changed endpoint with `curl` to confirm it returns valid JSON, not a 500 / 404.
- Sync script changes → run the script once with the real incremental path (no `--full`) and confirm it doesn't re-fetch everything or infinite-loop.
- **Always review `README.md` and `AGENTS.md` after implementing a feature or fix** and update whatever is now stale: page/route lists, architecture tree, route-groups table, data-model notes, gotchas, and any conventions the change introduced or invalidated. Treat the docs as part of the task, not a follow-up.
