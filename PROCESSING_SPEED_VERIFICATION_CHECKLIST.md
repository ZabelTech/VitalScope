# Processing-speed verification checklist

Manual verification for the daily processing-speed flow.

## Backend endpoint checks

1. Run backend locally.
2. Submit one session payload to `POST /api/cognition/processing-speed/session` with at least 10 trials.
3. Confirm response includes `summary`, `baseline`, `delta_vs_baseline`, and `z_score`.
4. Confirm `GET /api/cognition/processing-speed/daily` returns rows with `include_in_quality_adjusted`, `baseline_confidence`, and `adjusted_score`.
5. Confirm `GET /api/cognition/processing-speed/baseline?date=<YYYY-MM-DD>` returns 404 before a session exists for that date and returns JSON after one is saved.

## Frontend behavior checks

1. Open Act → Today journal card.
2. Confirm first run requires practice and shows `Start practice` before `Start task` can be used.
3. Complete 6 untimed practice trials and confirm the main task can be started.
4. Start a scored run and verify:
   - timer counts down from 75 seconds,
   - YES/NO responses progress trial-by-trial,
   - timeout advances the trial after 4 seconds,
   - cancel returns to idle.
5. Complete a session and confirm the result card shows:
   - median RT,
   - accuracy,
   - throughput per minute,
   - baseline status and confidence,
   - quality badge.
6. Switch to Cognition chart and verify:
   - raw throughput view shows low-quality markers in red,
   - adjusted view plots only rows with sufficient baseline confidence.

## Regression checks

1. Frontend type-check passes (`cd frontend && npx tsc --noEmit`).
2. Existing journal sliders save values after running the processing-speed task.
3. `/api/journal/cognition` charts still render without processing-speed data.
4. Demo mode still seeds processing-speed sessions and chart data.

## Preview readiness checks

1. Open a pull request from the implementation branch.
2. Confirm GitHub Actions `preview-deploy.yml` jobs pass:
   - require-e2e-for-feature,
   - frontend-typecheck,
   - e2e-usecases,
   - deploy.
3. Open the preview URL comment (`https://vitalscope-pr-<N>.fly.dev`) and run one end-to-end processing-speed session.
4. Record any remaining blockers directly on the Linear issue before moving preview task to Done.
