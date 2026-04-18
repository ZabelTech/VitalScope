export interface HeartRateDaily {
  date: string;
  resting_hr: number | null;
  min_hr: number | null;
  max_hr: number | null;
  avg_7d_resting_hr: number | null;
}

export interface HrvDaily {
  date: string;
  weekly_avg: number | null;
  last_night_avg: number | null;
  last_night_5min_high: number | null;
  baseline_low_upper: number | null;
  baseline_balanced_low: number | null;
  baseline_balanced_upper: number | null;
}

export interface BodyBatteryDaily {
  date: string;
  charged: number | null;
  drained: number | null;
}

export interface SleepDaily {
  date: string;
  sleep_time_seconds: number | null;
  deep_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  awake_seconds: number | null;
  sleep_start: string | null;
  sleep_end: string | null;
  avg_spo2: number | null;
  avg_respiration: number | null;
  avg_sleep_stress: number | null;
  sleep_score: number | null;
  sleep_score_quality: string | null;
  resting_hr: number | null;
}

export interface StressDaily {
  date: string;
  max_stress: number | null;
  avg_stress: number | null;
}

export interface StepsDaily {
  date: string;
  total_steps: number | null;
  total_distance_m: number | null;
  step_goal: number | null;
}

export interface GarminActivity {
  activity_id: number;
  date: string;
  start_time: string;
  end_time: string | null;
  name: string | null;
  sport_type: string | null;
  activity_type: string | null;
  duration_sec: number | null;
  moving_time_sec: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed_mps: number | null;
  calories: number | null;
  avg_power_w: number | null;
  training_effect: number | null;
  anaerobic_te: number | null;
}

export interface ActivityWeekly {
  week: string;
  week_start: string;
  sessions: number;
  distance_m: number | null;
  duration_sec: number | null;
  elevation_m: number | null;
}

export interface ActivityStats {
  activity_count: number;
  total_distance_m: number | null;
  total_duration_sec: number | null;
  total_calories: number | null;
  total_elevation_m: number | null;
}

export interface WeightDaily {
  date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  bone_mass_kg: number | null;
  water_pct: number | null;
  bmi: number | null;
  visceral_fat: number | null;
  bmr: number | null;
  protein_pct: number | null;
  lean_body_mass_kg: number | null;
  body_age: number | null;
  heart_rate: number | null;
}

export interface StatValues {
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  volatility: number | null;
}

export type MorningFeeling = "sleepy" | "energetic" | "normal" | "sick";

export interface JournalEntry {
  date: string;
  created_at?: string;
  followed_supplements: boolean;
  drank_alcohol: boolean;
  alcohol_amount: string | null;
  morning_feeling: MorningFeeling;
  notes: string | null;
  is_work_day: boolean | null;
}

export type NutrientCategory = "macro" | "mineral" | "vitamin" | "bioactive";

export interface NutrientDef {
  key: string;
  label: string;
  unit: string;
  category: NutrientCategory;
  sort_order: number;
}

export interface MealNutrient {
  key: string;
  amount: number;
}

export interface Meal {
  id: number;
  date: string;
  time: string | null;
  name: string;
  notes: string | null;
  created_at: string;
  nutrients: MealNutrient[];
}

export interface WaterEntry {
  id: number;
  date: string;
  time: string | null;
  amount_ml: number;
  created_at: string;
}

export interface NutritionDailyTotals {
  date: string;
  totals: Record<string, number>;
}

export interface WaterDaily {
  date: string;
  total_ml: number;
}

export type TimeOfDay = "morning" | "noon" | "evening";

export interface Supplement {
  id: number;
  name: string;
  dosage: string;
  time_of_day: TimeOfDay;
  sort_order: number;
}

export interface SupplementIntake extends Supplement {
  taken: boolean;
}

export interface Workout {
  id: string;
  date: string;
  end_date: string | null;
  name: string;
  duration_sec: number | null;
  notes: string | null;
  total_sets: number;
  total_volume: number;
  exercise_count?: number;
}

export interface WorkoutSet {
  exercise: string;
  set_order: number;
  set_type: "working" | "rest";
  weight_kg: number | null;
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  rpe: number | null;
}

export interface WorkoutDetail extends Workout {
  sets: WorkoutSet[];
}

export interface WeeklyVolume {
  week: string;
  week_start: string;
  sessions: number;
  volume: number;
}

export interface DateRange {
  earliest: string;
  latest: string;
}

export type UploadKind = "meal" | "form";

export interface Upload {
  id: number;
  kind: UploadKind;
  date: string;
  filename: string;
  mime: string;
  bytes: number;
  created_at: string;
}

export interface PlannedActivity {
  id: number;
  date: string;
  sport_type: string;
  target_distance_m: number | null;
  target_duration_sec: number | null;
  notes: string | null;
}

export type NutrientGoals = Record<string, number>;
