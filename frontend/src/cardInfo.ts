export interface CardInfo {
  title: string;
  source: string;
  meaning: string;
  science?: string;
}

export const CARD_INFO = {
  "today.steps": {
    title: "Steps",
    source: "Garmin Connect (sync_garmin.py → steps_daily)",
    meaning:
      "Total steps recorded by your watch since midnight, alongside your configured daily goal and the distance covered.",
    science:
      "Paluch et al. 2022 (Lancet Public Health) meta-analysis of 47K adults: each additional 1 000 daily steps up to ~10 000 associates with ~12% lower all-cause mortality.",
  },
  "today.nutrition-summary": {
    title: "Nutrition",
    source: "Logged meals (meals + meal_nutrients) and water intake (water_intake), aggregated by date.",
    meaning:
      "A snapshot of today's logged calories, protein/carbs/fat, and total water, rolled up from every meal and drink you have entered.",
    science:
      "Macronutrient targets follow ISSN position stand on protein (Jäger 2017): 1.4–2.0 g/kg for active adults; energy balance is the primary lever for body composition (Hall 2017).",
  },
  "today.protocols-scheduled": {
    title: "Protocols scheduled today",
    source: "Protocols (protocols + protocol_adherence) filtered to today's recurrence schedule.",
    meaning:
      "Every protocol whose recurrence rule fires today, grouped by morning/noon/evening/anytime, with a checkbox to log adherence.",
  },
  "today.activity": {
    title: "Today's activity",
    source: "Garmin activities (sync_garmin_activities.py → garmin_activities) and Strong workouts (sync_strong.py → workouts), filtered to today.",
    meaning:
      "All cardio activities synced from Garmin plus any strength workouts logged in Strong for today, with summary metrics (duration, distance, volume).",
  },
  "observe.activity-history": {
    title: "Activity history",
    source: "Most recent Garmin activities and Strong workouts, merged and date-sorted.",
    meaning:
      "A scrolling history of your last few activities and strength sessions, with details available on click.",
  },
  "today.nutrition-detail": {
    title: "Nutrition (detailed)",
    source: "Logged meals broken out by meal time, with per-meal macronutrient detail.",
    meaning:
      "Today's meals listed individually — useful when you want to see what contributed to the running totals above.",
  },
  "today.water-quick-log": {
    title: "Water quick log",
    source: "water_intake table — one row per logged drink.",
    meaning:
      "Tap a button to log a fixed-volume drink. Total adds to today's running water tally.",
    science:
      "EFSA adequate-intake reference: 2.5 L/day (men), 2.0 L/day (women) including water from food. No strong evidence that exceeding this improves health outcomes (Armstrong 2018).",
  },
  "observe.sleep": {
    title: "Sleep",
    source: "Garmin Connect sleep tracking (sync_garmin.py → sleep_daily).",
    meaning:
      "Last night's total sleep duration, the time spent in deep / light / REM stages, and any awake intervals — measured by the wrist sensor's accelerometer + HR signal.",
    science:
      "AASM consensus: 7+ hours/night for adults; chronic <6h linked to ~13% higher all-cause mortality (Yin 2017 meta-analysis). Wrist trackers correlate r≈0.6 with PSG for total sleep, weaker for stages (de Zambotti 2020).",
  },
  "observe.hrv": {
    title: "HRV",
    source: "Garmin Connect overnight HRV (sync_garmin.py → hrv_daily). Readings start 2022-09-02 (device upgrade).",
    meaning:
      "Overnight RMSSD — beat-to-beat variability while you sleep. Higher values indicate better autonomic recovery; trends matter more than any single night.",
    science:
      "Plews et al. 2013: 7-day rolling HRV detects training-load adaptation in athletes. Single-night values have ~10% measurement noise; use trend lines, not single readings.",
  },
  "observe.body-battery": {
    title: "Body battery",
    source: "Garmin Firstbeat algorithm (sync_garmin.py → body_battery_daily). Charged at peak, drained at minimum.",
    meaning:
      "Garmin's proprietary 0–100 score combining HRV, stress, activity, and sleep. Charged = highest reading of the day; Drained = lowest.",
  },
  "observe.resting-hr": {
    title: "Resting heart rate",
    source: "Garmin Connect (sync_garmin.py → hr_daily.resting_hr).",
    meaning:
      "Lowest sustained heart rate over a continuous 5-minute window, typically captured during sleep.",
    science:
      "Lower RHR correlates with cardiovascular fitness and lower mortality (Aune 2017 meta-analysis: each +10 bpm = +17% all-cause mortality risk in adults). Endurance training reduces RHR by 5–25 bpm over months.",
  },
  "observe.stress": {
    title: "Stress",
    source: "Garmin Firstbeat stress score from HRV (sync_garmin.py → stress_daily).",
    meaning:
      "Daily average and peak of Garmin's 0–100 stress score, derived from HRV. Higher = more sympathetic dominance.",
  },
  "observe.weight": {
    title: "Weight & body composition",
    source: "EufyLife smart scale (sync_eufy.py → weight_daily).",
    meaning:
      "Most recent weight reading, plus body-fat % and lean mass when the impedance measurement succeeded.",
    science:
      "BIA scales have ±3–5% error vs DEXA for body fat (Achamrah 2018). Use trend over 2+ weeks; daily fluctuation is mostly water.",
  },
  "observe.bloodwork-panels": {
    title: "Bloodwork panels",
    source: "Manually uploaded lab PDFs/images, parsed by AI into bloodwork_panels + bloodwork_results.",
    meaning:
      "All your lab panels with each analyte's value, units, and reference range. Out-of-range values are flagged.",
  },
  "observe.blood-pressure": {
    title: "Blood pressure",
    source: "Manual entries from a home cuff (blood_pressure_entries table). Add via Entries → Blood pressure.",
    meaning:
      "Most recent systolic / diastolic reading and pulse, with the date the measurement was taken.",
    science:
      "ACC/AHA 2017 thresholds: <120/<80 normal, 120–129/<80 elevated, ≥130/≥80 hypertension. Single readings are noisy — track the rolling average.",
  },
  "journal.entry": {
    title: "Journal entry",
    source: "Manual entry — journal_entries table.",
    meaning:
      "Subjective notes on alcohol, mood, energy, and adherence to your protocols and supplements for a given date.",
  },
  "journal.meal-describe": {
    title: "Log a missed meal",
    source: "Manual text → AI estimator → meal_nutrients tagged to the journal date.",
    meaning:
      "When you're filling in a past day's journal, type what you ate and the AI fills in the nutrients against that date.",
  },
  "observe.caffeine-total": {
    title: "Caffeine — daily total",
    source: "Logged meals tagged with caffeine content.",
    meaning:
      "Sum of caffeine consumed today, in mg, across all logged drinks and foods.",
    science:
      "EFSA: single doses up to 200 mg and daily intake up to 400 mg are safe for healthy adults. Half-life is 3–7 hours, doubling in CYP1A2 slow metabolisers.",
  },
  "observe.caffeine-current": {
    title: "Caffeine — currently in system",
    source: "Logged caffeine intakes plus your CYP1A2 genotype-derived half-life.",
    meaning:
      "Estimated mg of caffeine still circulating right now, decayed exponentially from each intake using your personal half-life.",
  },
  "observe.caffeine-cyp1a2": {
    title: "Caffeine — CYP1A2 phenotype",
    source: "Genome upload (genotype_phenotype) — CYP1A2 *1F variant call.",
    meaning:
      "Your inferred caffeine metabolism speed (rapid / intermediate / slow) and the corresponding half-life used in the simulation above.",
    science:
      "Cornelis 2006: CYP1A2 *1A/*1A homozygotes metabolise caffeine ~2× faster than *1F carriers. Slow metabolisers have higher MI risk from heavy intake (Palatini 2009).",
  },
  "act.nutrition-gaps": {
    title: "Nutrient gaps",
    source: "Today's meal_nutrients totals compared against RDA defaults from nutrient_defs.",
    meaning:
      "Vitamins and minerals where today's intake is well under reference daily intake — a quick prompt for what's worth supplementing or eating.",
  },
  "act.intake-log": {
    title: "Supplement intake",
    source: "journal_supplement_intake — per-date check-off against the supplements master list.",
    meaning:
      "Tick off supplements as you take them. Adherence rolls up into the journal entry.",
  },
  "act.auto-ticked": {
    title: "Auto-logged today",
    source: "Sources that auto-populate without manual entry (Garmin steps, sleep, HRV, etc.).",
    meaning:
      "A confirmation strip showing which data sources have already synced fresh data for today, so you know what is and isn't covered.",
  },
  "nutrition.date-picker": {
    title: "Date",
    source: "Local UI control.",
    meaning:
      "Selects which date the meals below are being viewed and logged against. Defaults to today.",
  },
  "nutrition.meals": {
    title: "Meals",
    source: "meals + meal_nutrients tables, joined by date.",
    meaning:
      "All meals logged for the selected date, with macronutrient breakdown and a glucose-response curve when CGM data is available.",
  },
  "nutrition.meal-describe": {
    title: "Describe a meal (AI)",
    source: "Manual text → AI estimator → meal_nutrients.",
    meaning:
      "Type what you ate and let the AI estimate the nutrients. Useful when you didn't photograph the meal.",
  },
  "supplements.morning": {
    title: "Morning supplements",
    source: "supplements table filtered to time_of_day='morning'.",
    meaning:
      "Master list of morning supplements with their dosage, edit-in-place. Drives the morning slot of the daily intake check-off.",
  },
  "supplements.noon": {
    title: "Noon supplements",
    source: "supplements table filtered to time_of_day='noon'.",
    meaning:
      "Master list of midday supplements with their dosage. Drives the noon slot of the daily intake check-off.",
  },
  "supplements.evening": {
    title: "Evening supplements",
    source: "supplements table filtered to time_of_day='evening'.",
    meaning:
      "Master list of evening supplements with their dosage. Drives the evening slot of the daily intake check-off.",
  },
  "protocols.quick-log": {
    title: "Quick log (hormesis)",
    source: "protocols + protocol_events tables. Find-or-create logic in ProtocolsSection.findOrCreateQuick.",
    meaning:
      "One-tap loggers for Zone 2, Sauna, and Cold Plunge — the hormetic stressors you do regularly. Creates the protocol on first use.",
    science:
      "Hormetic stress: short, repeated bouts of mild physiological stress (heat, cold, moderate exertion) trigger cellular adaptations associated with longevity (Mattson 2008).",
  },
  "protocols.list": {
    title: "Active protocols",
    source: "protocols table filtered to active rows (no end_date or end_date in the future). Add-protocol form is nested inside.",
    meaning:
      "Every protocol currently in effect, with recurrence schedule, dose, and a one-tap log for today's occurrence. Use the form below the list to add new protocols.",
  },
  "protocols.todays-events": {
    title: "Today's protocol events",
    source: "protocol_events table — actual logged occurrences per date.",
    meaning:
      "Specific events logged today (e.g. 20-min sauna at 08:30) under any of your active protocols.",
  },
  "protocols.archived": {
    title: "Archived protocols",
    source: "protocols table where end_date is in the past.",
    meaning:
      "Past protocols kept for historical context. Click to expand.",
  },
  "plan.macro-targets": {
    title: "Macro targets",
    source: "Same store as nutrition.macro-targets — surfaced under Plan for editing.",
    meaning: "Edit your daily macronutrient and calorie targets.",
  },
  "plan.meal-templates": {
    title: "Meal templates",
    source: "Saved meal definitions.",
    meaning: "Manage the library of one-click meal templates.",
  },
  "plan.activities": {
    title: "Planned activities",
    source: "planned_activities table (manual entries).",
    meaning:
      "Forward-looking workouts and sessions you've planned for upcoming days — surfaces in the morning briefing under What's planned.",
  },
  "decide.goals-step": {
    title: "Daily step goal",
    source: "Garmin device setting. Read-only here.",
    meaning:
      "Your daily steps target as configured on your Garmin watch. Edit on the device itself; this card just surfaces the current value.",
  },
  "decide.goals-health": {
    title: "Health goals",
    source: "goals table keyed by metric (resting_hr, hrv, weight_kg, body_fat_pct, sleep_hours).",
    meaning:
      "Numeric targets for the metrics you track. Set values appear as reference lines on Trends charts and as comparison hints on today's metric cards.",
  },
  "decide.genome-upload": {
    title: "Genome upload",
    source: "23andMe / AncestryDNA raw files parsed into the genotypes table.",
    meaning:
      "Upload a raw genotype file. The variants are matched against the curated registry to drive the genotype-phenotype tables and CYP1A2 caffeine metabolism.",
  },
  "orient.genotype-phenotype": {
    title: "Genotype → phenotype",
    source: "genotypes joined against the curated variant_registry of clinically annotated SNPs.",
    meaning:
      "Your genotype calls translated into phenotypes (metaboliser status, disease-risk modifiers, drug response) with the underlying variant evidence.",
    science:
      "PharmGKB and ClinVar curate the variant–phenotype links used here. Pharmacogenomic associations have variable evidence strength; CYP1A2/caffeine and CYP2D6/codeine are well-established, others remain exploratory.",
  },
  "daily.today-journal": {
    title: "Today's journal",
    source: "journal_entries + journal_supplement_intake — combined into one card for today's quick logging.",
    meaning:
      "Today's journal entry plus the supplement intake check-off, so the morning routine fits in a single card.",
  },
  "daily.meal-describe": {
    title: "Describe a meal (AI)",
    source: "Manual text → AI estimator → meal_nutrients.",
    meaning:
      "Type what you ate; the AI estimates calories and macronutrients. Useful when you didn't photograph the meal.",
  },
  "orient.chart-heart-rate": {
    title: "Heart rate trend",
    source: "Garmin Connect daily HR (sync_garmin.py → hr_daily): resting, min, and max per day.",
    meaning:
      "Resting / min / max HR over your selected window. Resting HR is the most useful trend for cardiovascular fitness changes.",
    science:
      "Aune 2017 meta-analysis: each +10 bpm in resting HR raises all-cause mortality risk ~17% in adults.",
  },
  "orient.chart-stress": {
    title: "Stress trend",
    source: "Garmin daily stress score (stress_daily).",
    meaning:
      "Average and peak Firstbeat stress over time. Watch for rising baselines; single spikes are usually noise.",
  },
  "orient.chart-hrv": {
    title: "HRV trend",
    source: "Garmin overnight HRV (hrv_daily). Series starts 2022-09-02.",
    meaning:
      "Overnight RMSSD over time. Use the 7-day rolling line; nightly noise is high.",
    science:
      "Plews 2013: 7-day rolling HRV reliably tracks training adaptation and recovery state in endurance athletes.",
  },
  "orient.chart-body-battery": {
    title: "Body battery trend",
    source: "Garmin Firstbeat body battery (body_battery_daily) — charged and drained per day.",
    meaning:
      "Daily charged peak and drained minimum. A widening gap between the two suggests good recovery; a narrow band suggests chronic depletion.",
  },
  "orient.chart-steps": {
    title: "Steps trend",
    source: "Garmin daily steps (steps_daily).",
    meaning:
      "Daily step count with goal reference. Look for sustained averages, not single days.",
    science:
      "Paluch 2022 (Lancet PH): 7K–10K daily-step averages associate with the largest mortality benefit.",
  },
  "orient.chart-weight": {
    title: "Weight trend",
    source: "EufyLife smart scale (weight_daily).",
    meaning:
      "Body weight and (where measured) body-fat % over time. A 7-day moving average smooths daily water-weight fluctuation.",
  },
  "orient.chart-blood-pressure": {
    title: "Blood pressure trend",
    source: "Manual cuff entries (blood_pressure_entries) plotted by reading date.",
    meaning:
      "Systolic, diastolic, and pulse over time. Look at the trend; single readings are noisy.",
    science:
      "ACC/AHA 2017 thresholds: <120/<80 normal, 120–129/<80 elevated, ≥130/≥80 hypertension stage 1. Each 10 mmHg systolic reduction lowers stroke risk ~27% (Ettehad 2016).",
  },
  "orient.chart-glucose": {
    title: "Glucose (CGM) trend",
    source: "LibreLinkUp Freestyle Libre (sync_cgm.py → glucose_readings + glucose_daily).",
    meaning:
      "Continuous glucose readings (~15-min intervals) and daily aggregates (mean, std-dev, time-in-range 70–180 mg/dL).",
    science:
      "ADA target: TIR ≥ 70%, time-above-180 < 25%. CV < 36% indicates stable glycaemia (Battelino 2019 international consensus).",
  },
  "orient.chart-sleep": {
    title: "Sleep trend",
    source: "Garmin sleep tracking (sleep_daily) — total, deep, light, REM, awake per night.",
    meaning:
      "Sleep duration and stage breakdown over time. Stage values from wrist sensors are approximate; total duration is more reliable.",
    science:
      "AASM: 7+ h/night for adults; deep + REM together typically ~30–40% of total sleep in healthy adults.",
  },
  "orient.chart-nutrition": {
    title: "Nutrition trend",
    source: "Daily aggregates from meal_nutrients keyed by nutrient.",
    meaning:
      "Long-run trend for any tracked nutrient (calories, protein, a specific micronutrient). Useful for spotting chronic deficits.",
  },
  "orient.chart-training": {
    title: "Training",
    source: "Strong workouts (workouts + workout_sets, set_type='working' only) merged with Garmin activities, aggregated by week.",
    meaning:
      "Weekly cardio sessions, weekly strength sessions, and the distance trend on a second axis. Strength volume only counts working sets so warm-ups don't inflate numbers.",
    science:
      "Schoenfeld 2017 meta-analysis: weekly volume is the strongest dose-response predictor of hypertrophy; ~10–20 working sets per muscle group per week is typical for trained lifters.",
  },
  "orient.cognition": {
    title: "Cognition (processing speed)",
    source: "Symbol-digit task results stored in cog_processing_sessions / cog_processing_trials.",
    meaning:
      "Reaction-time and accuracy across 75-second runs of a symbol-digit task, with quality flags and a baseline-adjusted z-score.",
    science:
      "Symbol-digit substitution is the canonical processing-speed test (Salthouse 2000); declines with age and is sensitive to sleep deprivation, alcohol, and acute illness.",
  },
  "orient.longevity-clocks": {
    title: "Biological age — epigenetic clocks",
    source: "biological_age_entries — manual entry of GrimAge / Horvath / PhenoAge / DunedinPACE / TelomereLength results.",
    meaning:
      "Your epigenetic-clock readings over time, with rate-of-ageing where the assay reports it (e.g. DunedinPACE).",
    science:
      "Horvath 2013, Levine 2018 (PhenoAge), Lu 2019 (GrimAge), Belsky 2022 (DunedinPACE) — clocks correlate with mortality risk above and beyond chronological age, but inter-assay variance is high.",
  },
  "orient.longevity-analytes": {
    title: "Longevity-relevant analytes",
    source: "bloodwork_results filtered through the longevity analyte registry (apoB, hs-CRP, HOMA-IR, etc.).",
    meaning:
      "Your historical readings for analytes most strongly tied to long-term mortality and healthspan, with delta vs your earliest reading.",
    science:
      "ApoB > LDL-C as a CVD predictor (Sniderman 2019); hs-CRP < 1 mg/L = low cardiovascular risk (Ridker 2003); fasting insulin / HOMA-IR for early metabolic dysfunction (Matthews 1985).",
  },
  "orient.longevity-vo2max": {
    title: "VO₂ max trend",
    source: "Garmin activities — vo2MaxValue field extracted from raw_json.",
    meaning:
      "Your estimated VO₂ max over time, deduplicated to one value per date.",
    science:
      "Mandsager 2018 (>120K patients): each 1-MET increase in cardiorespiratory fitness associates with ~12% lower all-cause mortality. VO₂ max is the single strongest mortality predictor in middle-aged adults.",
  },
  "orient.longevity-grip": {
    title: "Grip strength",
    source: "grip_strength_entries — manual handgrip dynamometer readings.",
    meaning:
      "Maximal grip force per hand, logged from a dynamometer test. A simple proxy for whole-body strength.",
    science:
      "Leong 2015 (PURE study, 140K adults): each 5 kg lower grip strength = 16% higher all-cause mortality, independent of age and chronic disease.",
  },
  "orient.genome-wiki": {
    title: "Genomic wiki",
    source:
      "AI-compiled markdown pages under genome_wiki/wiki/ — synthesised from your matched SNPedia bundle plus the curated variant registry, written by the LLM, audited by the lint pass.",
    meaning:
      "A browseable, longitudinal interpretation of your variants. Per-variant pages cite their SNPedia source; gene and system pages synthesise across them. Every clinical claim is wikilinked to a source page so you can trace it back to the raw bundle.",
    science:
      "Karpathy LLM-Wiki pattern (April 2026) applied to personal genomics. Pages use ACMG/AMP terminology (Pathogenic / Likely Pathogenic / VUS / Likely Benign / Benign / drug-response / risk-factor). Informational only — not a medical device. Confirm any clinical action with a CLIA-certified lab and a board-certified geneticist.",
  },
  "decide.genome-wiki-qa": {
    title: "Genome Q&A",
    source:
      "Questions answered by the AI from the wiki context (genome_wiki_index + page bodies). Each answer is filed back to wiki/synthesis/qa/<slug>.md so explorations compound.",
    meaning:
      "Ask anything about your genome. The agent reads the relevant wiki pages, answers in four sections (what it is / your data / what it means / what we don't know), and saves the answer for next time. Every clinical claim wikilinks to a source page.",
    science:
      "Hallucination is the design's biggest risk. Mitigations: write-time citation validators, ACMG-only vocabulary, auto-injected disclaimer, lint pass. Still informational only — confirm clinical actions with a board-certified geneticist.",
  },
} as const satisfies Record<string, CardInfo>;

export type CardId = keyof typeof CARD_INFO;
