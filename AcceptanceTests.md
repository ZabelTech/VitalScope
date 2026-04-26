# Acceptance Tests

This document defines manual acceptance scenarios for VitalScope and adds explicit verification steps for each flow so QA can confirm end-to-end behavior.

## General preconditions

1. VitalScope backend is running and reachable at `http://localhost:8000`.
2. VitalScope frontend is running and reachable at `http://localhost:5173`.
3. The tester can sign in and access all top-level routes.
4. Relevant plugin credentials are configured when required by a scenario.

## Scenario 1: Full ReSync Garmin

### Steps
1. Login to VitalScope.
2. Navigate to **Settings**.
3. Open the **Garmin Health** plugin card.
4. Enable **Full Resync**.
5. Click **Run now**.

### Verification
1. A new run appears in the Garmin Health run history.
2. The run status transitions to `ok` (or equivalent success state).
3. The run message does not include auth, timeout, or parsing errors.
4. `Observe` and/or `Orient` pages show Garmin-backed metrics with valid dates and values after completion.

## Scenario 2: Pull latest Strong workout data after training

### Steps
1. Login to VitalScope.
2. Navigate to **Settings**.
3. Open the **Strong** plugin card.
4. Click **Run now**.
5. Navigate to **Orient → Activity history**.

### Verification
1. A new Strong plugin run appears with success status.
2. The latest workout is visible in **Activity history**.
3. Expanding the workout shows set-level details and no obvious missing fields (exercise name, reps/weight/time where applicable).
4. Workout counts/summary on the page are consistent with the newly imported session.

## Scenario 3: Daily OODA loop (Observe → Orient → Decide → Act)

### Steps
1. Open **Observe** and review today’s metrics.
2. Open **Orient** and review trend charts and AI analysis.
3. Open **Decide** and set/update daily goals or plan entries.
4. Open **Act** and log at least one action (supplement, meal/water, protocol event, or journal item).

### Verification
1. Each page loads without API errors.
2. Changes made in **Decide** and **Act** persist after page refresh.
3. Newly logged data appears in the expected section immediately or after a refresh.
4. No route breaks the OODA navigation flow (all four pages remain reachable and functional).

## Scenario 4: Log a meal and check postprandial glucose

### Steps
1. Navigate to **Act → Meals & water**.
2. Select a date and add a meal with name/time.
3. Enter nutrient values and save.
4. If CGM data exists around the meal time, view the inline postprandial glucose curve.

### Verification
1. The meal appears in the meal list for the selected date.
2. Saved nutrient values are preserved when reopening/editing the meal.
3. The daily nutrition totals update to reflect the new meal.
4. If CGM coverage exists, a postprandial chart renders and spans the expected post-meal window.

## Scenario 5: Add sync credentials and schedule automation

### Steps
1. Navigate to **Settings**.
2. Open a plugin card (Garmin, Garmin Activities, Strong, Eufy, or CGM).
3. Enter credentials and choose an interval.
4. Click **Save**.
5. Click **Run now** for immediate validation.

### Verification
1. Saving settings returns a success state and the card reflects persisted values.
2. Manual run completes successfully and is recorded in run history.
3. Subsequent scheduled runs execute at the configured interval (or show next-run metadata consistent with the interval).
4. New source data becomes visible in pages that consume that plugin’s data.
