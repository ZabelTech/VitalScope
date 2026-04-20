# VitalScope: The State of You

A personal health dashboard that aggregates data from **Garmin Connect**, the **Strong** gym tracker, and **EufyLife** smart scale into a single SQLite database and visualizes it in a React frontend organized around an **OODA loop** — Observe, Orient, Decide, Act.

## Current status

All four sync sources are wrapped as **plugins** that the backend schedules and runs on an interval (APScheduler). The UI has five routes (Observe / Orient / Decide / Act / Settings). The database holds ~4.3 years of daily health metrics plus journal, supplements, nutrition, and water logs.

### Data in the database

| Source | Rows | Range | Notes |
|---|---|---|---|
| Heart rate (daily) | 1,576 | 2021-12-19 → today | resting / min / max |
| Heart rate (readings) | 63,041 | | per-minute intraday |
| HRV (daily) | 1,083 | 2022-09-02 → today | weekly avg + baseline band |
| HRV (readings) | 8,909 | | overnight only |
| Body battery (daily) | 1,576 | 2021-12-19 → today | charged/drained totals |
| Body battery (readings) | 9,455 | | intraday level curve |
| Sleep | 1,576 | 2021-12-19 → today | stages, score, SpO2, respiration |
| Stress (daily) | 1,576 | 2021-12-19 → today | avg / max |
| Stress (readings) | 38,161 | | intraday |
| Steps | 1,472 | 2021-12-19 → today | total + goal + distance |
| Weight | 439 | 2023-04-13 → today | full body composition from Eufy smart scale |
| Garmin activities | 760 | 2019-11-21 → today | runs, rides, strength, yoga, etc. |
| Strong workouts | 292 | 2022-09-07 → 2026-04-09 | strength workouts with 6,557 sets |

## Architecture

```
/home/robert/vitalscope/
├── vitalscope.db                 # SQLite, ~18 MB
├── requirements.txt              # garminconnect, fastapi, uvicorn, pydantic, apscheduler, requests
├── venv/                         # Python venv
├── sync_garmin.py                # HR / HRV / sleep / stress / body battery / steps
├── sync_garmin_activities.py     # Runs, rides, strength sessions
├── sync_strong.py                # Strong gym tracker workouts + sets
├── sync_eufy.py                  # EufyLife smart scale (weight + composition)
├── backend/
│   ├── app.py                    # FastAPI — 51 routes + APScheduler
│   └── plugins/                  # Sync plugin registry
│       ├── base.py               #   Plugin / ParamSpec / RunResult / REGISTRY
│       ├── _script_runner.py     #   Invokes legacy sync_*.py main() with spoofed argv+env
│       ├── garmin_health.py
│       ├── garmin_activities.py
│       ├── strong.py
│       └── eufy.py
└── frontend/                     # Vite + React + TypeScript + Recharts
    └── src/
        ├── App.tsx               # BrowserRouter + NavBar → 5 OODA routes
        ├── api.ts                # fetch helpers
        ├── types.ts
        ├── hooks/useMetricData.ts
        └── components/
            ├── NavBar.tsx
            ├── OodaPage.tsx           # shared frame: title + section nav + anchored sections
            ├── ActPage.tsx            # / — Act
            ├── ObservePage.tsx        # /observe
            ├── OrientPage.tsx         # /orient
            ├── DecidePage.tsx         # /decide
            ├── SettingsPage.tsx       # /settings — sync plugins
            ├── TodayDashboard.tsx     # Act → Today
            ├── IntakeLog.tsx          # Act → Supplements & alcohol
            ├── NutritionPage.tsx      # Act → Meals & water
            ├── TodayMetrics.tsx       # Observe → Today's metrics
            ├── JournalPage.tsx        # Observe → Journal
            ├── BloodworkPlaceholder.tsx  # Observe/Orient → Bloodwork (placeholder)
            ├── TrendsPage.tsx         # Orient → Trends
            ├── ActivityHistory.tsx    # Orient → Activity history
            ├── GoalsPage.tsx          # Decide → Goals
            ├── PlanPage.tsx           # Decide → Plan (supplements / food / activity tabs)
            ├── SupplementsPage.tsx    # embedded in PlanPage
            ├── ActivityCard.tsx       # merged Garmin + Strong card, click to expand
            ├── DateRangePicker.tsx
            ├── MetricCards.tsx        # min/max/avg/median/volatility
            ├── HeartRateChart.tsx
            ├── HrvChart.tsx
            ├── SleepChart.tsx
            ├── StressChart.tsx
            ├── BodyBatteryChart.tsx
            ├── StepsChart.tsx
            ├── WeightChart.tsx
            ├── TrainingChart.tsx      # stacked Garmin + Strong weekly volume
            └── NutritionChart.tsx     # calories + water trend
```

## Sync — plugin system

Each data source is a plugin registered in `backend/plugins/`. At backend startup the scheduler (`AsyncIOScheduler`) loads each plugin's config from the `plugin_configs` table and schedules it at its configured interval. Every run writes a row to `plugin_runs` (started_at / finished_at / status / message).

The plugins delegate to the original `sync_*.py` scripts via `_script_runner.py`, which imports the module and calls `main()` with spoofed `sys.argv` and credentials injected into `os.environ`. The scripts are therefore usable two ways:

1. **Via the UI** — configure credentials and interval on `/settings`, click **Run now** or let the scheduler fire.
2. **Standalone CLI** — the original `python3 sync_*.py` invocations still work exactly as before.

All four scripts are **incremental by default** — they only fetch what's missing. Use `--full` / `--all` to force a complete resync.

### `sync_garmin.py`

Syncs daily health metrics from Garmin Connect using the `garminconnect` library. Stores HR, HRV, sleep, stress, body battery, and steps in daily + intraday readings tables.

**Incremental strategy**: finds `MAX(date)` across all daily tables, then re-fetches **the last 2 days** on every run to capture intraday updates (HR / stress / body battery still trickle in today, and last night's sleep is only finalized the next morning).

```bash
export GARMIN_EMAIL="you@example.com"
export GARMIN_PASSWORD="yourpassword"

python3 sync_garmin.py                         # incremental (default)
python3 sync_garmin.py --full                  # ignore DB state, resync full range
python3 sync_garmin.py --since 2021-12-19      # full historical backfill
python3 sync_garmin.py --date 2026-04-10 --days 7  # specific range
```

Tokens are cached at `~/.garminconnect` after the first login.

### `sync_garmin_activities.py`

Syncs activity sessions (runs, rides, strength, yoga, etc.) from Garmin Connect. Stores one row per activity with distance, duration, HR, power, elevation, training effect.

**Incremental strategy**: queries `MAX(start_time)` and stops paginating when activities become older than what's already stored.

### `sync_strong.py`

Syncs strength workouts from the **Strong** gym tracker. Strong has no public API — this script uses the reverse-engineered **new** REST API at `back.strong.app` (Azure Front Door / JWT auth), not the deprecated Parse Server backend at `ws13.strongapp.co`.

> ⚠️ **Account risk**: Strong has terminated accounts for unofficial API usage in the past. Use at your own risk.

**Incremental strategy**: loads the set of existing workout IDs from the DB, paginates newest-first, and stops as soon as a page contains zero new workouts.

**Data model**: `workouts` (one per session) + `workout_sets` (one per set). Rest timers are preserved as `set_type='rest'` rows interleaved with `set_type='working'` rows, so the original order is retained for display.

```bash
export STRONG_EMAIL="you@example.com"
export STRONG_PASSWORD="yourpassword"
python3 sync_strong.py           # incremental
python3 sync_strong.py --full    # resync all
```

Tokens cached at `~/.strongapp` with 20 min JWT access + refresh token.

### `sync_eufy.py`

Syncs body composition (weight, BMI, body fat, muscle, water, bone, BMR, etc.) from the **EufyLife** cloud — the smart scale's mobile app backend.

**Incremental strategy**: queries `MAX(created_at)` from `weight_readings` and passes `after=<latest - 24h>` to the Eufy API.

```bash
export EUFY_EMAIL="you@example.com"
export EUFY_PASSWORD="yourpassword"
python3 sync_eufy.py             # incremental
python3 sync_eufy.py --all       # full history
```

## Backend — `backend/app.py`

A single FastAPI file serving 51 routes from `vitalscope.db`. CORS is open to `http://localhost:5173` for the Vite dev server. On startup it creates the app-owned tables (journal, supplements, nutrition, water, plugin state) and starts the plugin scheduler.

**Route groups**:

| Group | Routes |
|---|---|
| Daily summaries | `GET /api/{heart-rate,hrv,body-battery,sleep,stress,weight,steps}/daily?start=&end=` |
| Range stats | `GET /api/{heart-rate,hrv,body-battery,sleep,stress,weight,steps}/stats?start=&end=` — `{min, max, avg, median, volatility}` |
| Body battery live | `GET /api/body-battery/current` — latest reading + today's min/max |
| Workouts (Strong) | `GET /api/workouts`, `/api/workouts/stats`, `/api/workouts/weekly-volume`, `/api/workouts/recent`, `/api/workouts/{id}` |
| Activities (Garmin) | `GET /api/activities`, `/api/activities/stats`, `/api/activities/weekly`, `/api/activities/recent` |
| Journal | `GET/POST /api/journal`, `GET /api/journal/{date}`, `GET/POST /api/journal/{date}/supplements` |
| Supplements | `GET/POST/PUT/DELETE /api/supplements[/{id}]` |
| Nutrition | `GET/POST/PUT/DELETE /api/meals[/{id}]`, `GET /api/nutrition/daily`, `GET/POST/DELETE /api/water[/{id}]`, `GET /api/water/daily`, `GET/POST /api/nutrients/definitions`, `DELETE /api/nutrients/definitions/{key}` |
| Plugins | `GET /api/plugins`, `GET/PUT /api/plugins/{name}`, `POST /api/plugins/{name}/run`, `GET /api/plugins/{name}/runs` |
| Meta | `GET /api/date-range` — earliest/latest date across all tables |

### Running the backend

```bash
cd /home/robert/vitalscope
source venv/bin/activate
uvicorn backend.app:app --reload --port 8000
```

## Frontend — `frontend/`

Vite + React 18 + TypeScript + Recharts + react-router-dom.

### Pages (OODA loop)

Each route uses the shared `OodaPage` frame: a page title, an in-page nav of anchor links, and stacked labelled sections.

- **`/observe` Observe** — what is true right now?
  - **Today's metrics** — today's snapshot with age badges: Last Night's Sleep (score + stages + SpO2), HRV, Body Battery (current / today range / charged / drained), Stress, Body Composition, Steps, Heart Rate.
  - **Journal** — daily journal entries: alcohol, morning feeling, free-text notes, and a per-supplement check-off grouped by morning / noon / evening. Supplements default to checked for a fresh date — you only uncheck the ones you missed.
  - **Bloodwork** — placeholder.
- **`/orient` Orient** — what does the pattern look like?
  - **Trends** — historical charts with a date range picker (30d / 90d / 6mo / 1yr / All). Each metric has a row of Min / Max / Avg / Median / Volatility cards above its chart. Training chart is merged: stacked bars of weekly Garmin sessions + Strong sessions with a distance line overlay. Calories + water chart at the bottom.
  - **Activity history** — merged Garmin + Strong card list with click-to-expand details.
  - **Bloodwork** — placeholder.
- **`/decide` Decide** — what is the plan?
  - **Goals** — daily step goal (from Garmin) + placeholder for upcoming targets (sleep, HRV, RHR, weight, calories, macros).
  - **Plan** — tabs for Supplements (the master list grouped Morning/Noon/Evening, drives the Journal check-off), Food (placeholder), Activity (placeholder).
- **`/` Act** — what to do today?
  - **Today** — `TodayDashboard`: quick snapshot + recent activity card.
  - **Supplements & alcohol** — `IntakeLog`: check off today's supplements and log alcohol.
  - **Meals & water** — `NutritionPage`: log meals for a date with free-text name + time + full nutrient breakdown (Macros / Minerals / Vitamins / Bioactives, ~37 seeded keys, collapsible sections). Water is logged as separate per-drink entries with a running daily total.
- **`/settings` Settings** — sync plugins. One card per plugin (Garmin Health, Garmin Activities, Strong, Eufy) with Enabled toggle, interval, credential fields, Save, Run now, last-run status, and recent-runs log.

### Running the frontend

```bash
cd /home/robert/vitalscope/frontend
npm install    # first time only
npm run dev
```

Open http://localhost:5173. Vite proxies `/api/*` to `http://localhost:8000`.

## Typical workflow

Day-to-day the scheduler keeps the DB fresh — no manual steps required. If you want to force a refresh:

- From the UI: `/settings` → **Run now** on the relevant plugin.
- From the CLI: the standalone scripts still work.

```bash
cd /home/robert/vitalscope && source venv/bin/activate
python3 sync_garmin.py
python3 sync_garmin_activities.py
python3 sync_strong.py
python3 sync_eufy.py
```

## Per-PR preview deploys

Every pull request gets an ephemeral Fly.io app at `https://vitalscope-pr-<N>.fly.dev`, provisioned by `.github/workflows/preview-deploy.yml` and torn down when the PR closes. Previews run with `VITALSCOPE_DEMO=1` — the scheduler is off, plugin credentials are inaccessible, and the SQLite file is reseeded from `seed_demo.py` on every boot so no real health data ever leaves this machine.

### Manual preview deploys

To share a preview without opening a PR (e.g. from a spike branch), run the **Preview deploy (manual)** workflow in the GitHub Actions UI: pick the branch, enter a `slug` (lowercase letters/digits/dashes), leave `action=deploy`, and click **Run workflow**. The app lands at `https://vitalscope-preview-<slug>.fly.dev` and the URL is printed to the workflow's job summary. Re-run the workflow with `action=destroy` and the same `slug` to tear it down — unlike per-PR previews, manual ones have no auto-cleanup.

Inside demo mode every external dependency is mocked in-process: clicking **Run now** on any sync plugin calls the matching generator in `backend/plugins/_demo_generators.py` (reusing the per-source seeders from `seed_demo.py`) and writes fresh rows for the last 7 days without touching Garmin / Strong / EufyLife. The AI analyse endpoints (meal, form check, bloodwork) go through `DemoProvider` in `backend/app.py`, which returns canned tool-call payloads matching each endpoint's schema — no API key needed, nothing leaves the container. `/api/runtime` reports `ai_provider: "demo"` in this mode.

## Claude-on-issues automation

Mentioning `@claude` in a GitHub issue runs `.github/workflows/claude.yml`, which has Claude push its work to a `claude/issue-<N>-<timestamp>` branch. `.github/workflows/claude-auto-open-pr.yml` then watches pushes to any `claude/issue-*` branch and opens a PR against `main` (if one isn't already open), linking back to the originating issue via `Closes #N`. The PR title is taken from the latest commit subject.

## Automatic merge-conflict resolution

When `main` moves, `.github/workflows/claude-resolve-conflicts.yml` scans open PRs, finds any whose GitHub `mergeable` status is `CONFLICTING`, and dispatches Claude Code to merge `main` in and resolve the conflicts. Claude pushes the merge commit back to the PR branch and comments on the PR summarising which files it touched. Fork PRs are skipped (no write access); ambiguous conflicts are left alone with a comment explaining what a human needs to decide. Trigger it manually for a single PR with `workflow_dispatch`.

## Known quirks

- **Strong pagination**: Strong's REST API returns `_links.next` with empty `_embedded.log` arrays after the last real page — the sync script stops when it sees an empty logs array (not when `next` is missing).
- **Rest timers**: Strong models rest periods as `cellSet`s with only `REST_TIMER` cells. These are stored as `set_type='rest'` rows with the duration in `seconds` so the set order is preserved.
- **Garmin 429**: Garmin Connect rate-limits aggressively. The sync script pauses 60s on 429 and retries once, plus throttles 1s between days for large backfills.
- **HRV gap**: HRV data starts 2022-09-02, not 2021-12-19 — likely when the Garmin device was upgraded to one that supports HRV tracking.
- **Plugin re-entry**: plugins call into the legacy `sync_*.py` modules, which is why `_script_runner.py` has to patch `sys.argv` and credential env vars around each call.
