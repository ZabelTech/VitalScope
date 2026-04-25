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
export type MoodTag = "great" | "good" | "flat" | "low" | "irritable" | "anxious";

export interface JournalEntry {
  date: string;
  created_at?: string;
  followed_supplements: boolean;
  drank_alcohol: boolean;
  alcohol_amount: string | null;
  morning_feeling: MorningFeeling;
  notes: string | null;
  is_work_day: boolean | null;
  focus: number | null;
  mood_tag: MoodTag | null;
  cognitive_load: number | null;
  subjective_energy: number | null;
  avg_rt_ms: number | null;
  rt_trials: number | null;
}

export interface CognitionDaily {
  date: string;
  focus: number | null;
  mood_tag: MoodTag | null;
  cognitive_load: number | null;
  subjective_energy: number | null;
  avg_rt_ms: number | null;
  rt_trials: number | null;
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

export type UploadKind = "meal" | "form" | "bloodwork" | "genome";

export interface Upload {
  id: number;
  kind: UploadKind;
  date: string;
  filename: string;
  mime: string;
  bytes: number;
  created_at: string;
  meal_id: number | null;
  body_composition_estimate_id: number | null;
  bloodwork_panel_id: number | null;
  genome_upload_id: number | null;
}

export interface MealAnalysisResult {
  model: string;
  suggested_name: string;
  suggested_notes: string;
  confidence: "low" | "medium" | "high";
  nutrients: { nutrient_key: string; amount: number }[];
  unknown_keys: string[];
}

export type MuscleMassCategory = "low" | "average" | "moderate" | "high" | "very_high";
export type WaterRetentionLevel = "none" | "mild" | "moderate" | "pronounced";
export type VisibleDefinitionLevel = "low" | "moderate" | "high" | "very_high";
export type FatigueSigns = "none" | "mild" | "moderate" | "notable";
export type HydrationSigns =
  | "well_hydrated"
  | "neutral"
  | "mild_dehydration"
  | "notable_dehydration";

export interface FormCheckAnalysisResult {
  model: string;
  confidence: "low" | "medium" | "high";
  body_fat_pct: number | null;
  muscle_mass_category: MuscleMassCategory | null;
  water_retention: WaterRetentionLevel | null;
  visible_definition: VisibleDefinitionLevel | null;
  fatigue_signs: FatigueSigns | null;
  hydration_signs: HydrationSigns | null;
  posture_note: string | null;
  symmetry_note: string | null;
  general_vigor_note: string | null;
  notes: string;
  unknown_keys: string[];
}

export interface BodyCompositionEstimate {
  id: number;
  date: string;
  source: "form-check-ai";
  source_upload_id: number | null;
  body_fat_pct: number | null;
  muscle_mass_category: MuscleMassCategory | null;
  water_retention: WaterRetentionLevel | null;
  visible_definition: VisibleDefinitionLevel | null;
  posture_note: string | null;
  symmetry_note: string | null;
  fatigue_signs: FatigueSigns | null;
  hydration_signs: HydrationSigns | null;
  general_vigor_note: string | null;
  notes: string | null;
  confidence: "low" | "medium" | "high" | null;
  created_at: string;
}

export interface BodyCompositionEstimateInput {
  date: string;
  source_upload_id?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_category?: MuscleMassCategory | null;
  water_retention?: WaterRetentionLevel | null;
  visible_definition?: VisibleDefinitionLevel | null;
  posture_note?: string | null;
  symmetry_note?: string | null;
  fatigue_signs?: FatigueSigns | null;
  hydration_signs?: HydrationSigns | null;
  general_vigor_note?: string | null;
  notes?: string | null;
  confidence?: "low" | "medium" | "high" | null;
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

export type BloodworkFlag = "low" | "normal" | "high" | "critical";

export interface BloodworkResult {
  id?: number;
  analyte: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  reference_low: number | null;
  reference_high: number | null;
  reference_text: string | null;
  flag: BloodworkFlag | null;
  sort_order?: number;
}

export interface BloodworkAnalysisResult {
  model: string;
  confidence: "low" | "medium" | "high";
  collection_date: string | null;
  lab_name: string | null;
  notes: string;
  results: BloodworkResult[];
}

export interface BloodworkPanel {
  id: number;
  date: string;
  source: "bloodwork-ai" | "bloodwork-manual";
  source_upload_id: number | null;
  lab_name: string | null;
  notes: string | null;
  confidence: "low" | "medium" | "high" | null;
  created_at: string;
  result_count?: number;
  results?: BloodworkResult[];
}

export interface BloodworkPanelInput {
  date: string;
  source?: "bloodwork-ai" | "bloodwork-manual";
  source_upload_id?: number | null;
  lab_name?: string | null;
  notes?: string | null;
  confidence?: "low" | "medium" | "high" | null;
  results: BloodworkResult[];
}

export interface OrientTopic {
  id: "health" | "performance" | "recovery" | "body_composition";
  label: string;
  summary: string;
  insights: string[];
  alerts: string[];
  recommendations: string[];
}

export interface OrientAnalysis {
  model: string;
  analysis_date: string;
  window_days: number;
  overall_summary: string;
  topics: OrientTopic[];
}

export interface MorningBriefing {
  recovery_readout: string;
  yesterday_carryover: string;
  tonight_outlook: string;
  whats_up: string[];
  whats_planned: string[];
  suggestions: string[];
  model: string;
  provider: string;
  generated_at: string;
  briefing_date: string;
  cached: boolean;
}

export interface NightBriefingWatchOut {
  issue: string;
  mitigation: string;
}

export interface NightBriefing {
  model: string;
  analysis_date: string;
  today_readout: string;
  sleep_debt_posture: string;
  pre_sleep_checklist: string[];
  watch_outs: NightBriefingWatchOut[];
  tomorrow_setup: string[];
  cached?: boolean;
}

export interface GenomeVariant {
  rs_id: string;
  gene: string;
  variant_name: string;
  domain: string;
  genotype: string;
  zygosity: string;
  impact_label: string;
  interpretation: string;
}

export interface GenomeParseResult {
  variant_count: number;
  rs_count: number;
  chromosomes: string[];
  variants: GenomeVariant[];
}

export interface GenomeUpload {
  id: number;
  date: string;
  source_upload_id: number | null;
  variant_count: number;
  rs_count: number;
  chromosomes: string[];
  notes: string | null;
  created_at: string;
}

export interface GenomeUploadInput {
  date: string;
  source_upload_id?: number | null;
  variant_count: number;
  rs_count: number;
  chromosomes: string[];
  notes?: string | null;
  variants?: GenomeVariant[];
}

export interface JournalQuestion {
  id: number;
  question: string;
  sort_order: number;
  created_at: string;
}

export interface JournalQuestionResponse {
  question_id: number;
  question: string;
  response: string;
}

export type AiProvider = "anthropic" | "openai" | "openrouter";
export type AiEffort = "low" | "medium" | "high";

export interface ConvVariant {
  rs_id: string;
  genotype: string | null;
}

export interface ConvBloodwork {
  date: string;
  analyte: string;
  value: number | null;
  unit: string | null;
  flag: string | null;
}

export interface ConvWearable {
  type: "weekly_volume" | "supplements";
  data?: { week: string; week_start: string; sessions: number; volume_kg: number }[];
  names?: string[];
}

export interface ConvergencePanel {
  id: string;
  label: string;
  description: string;
  rs_ids: string[];
  variants_found: ConvVariant[];
  interpretation: string | null;
  risk_level: "low" | "elevated" | "high" | null;
  risk_note: string | null;
  bloodwork: ConvBloodwork[];
  wearable: ConvWearable | null;
}

export interface GenotypePhenotypeData {
  has_genome: boolean;
  panels: ConvergencePanel[];
}

export interface AiSettings {
  provider: AiProvider;
  model: string;
  effort: AiEffort;
  anthropic_key_hint: string | null;
  openai_key_hint: string | null;
  openrouter_key_hint: string | null;
}

export interface AiSettingsUpdate {
  provider: AiProvider;
  model: string;
  effort?: AiEffort;
  anthropic_api_key?: string | null;
  openai_api_key?: string | null;
  openrouter_api_key?: string | null;
}

export interface CaffeineIntake {
  id: number;
  date: string;
  time: string | null;
  mg: number;
  source: string | null;
  notes: string | null;
  created_at: string;
}

export interface CypPhenotypeOption {
  key: string;
  label: string;
  description: string;
  half_life_hours: number | null;
}

export interface CypProfileEntry {
  cyp: string;
  label: string;
  substrates: string[];
  phenotype: string;
  phenotype_source: "manual" | "genome" | "default";
  phenotype_id: number | null;
  phenotype_label: string;
  description: string;
  half_life_hours: number | null;
  is_default: boolean;
  all_phenotypes: CypPhenotypeOption[];
}

export interface PharmacogenomicsProfile {
  has_genome: boolean;
  cyps: CypProfileEntry[];
}

export interface ConcentrationPoint {
  hours_since_midnight: number;
  time: string;
  concentration_mg: number;
}

export interface ConcentrationCurve {
  date: string;
  cyp1a2_phenotype: string;
  half_life_hours: number;
  is_default: boolean;
  curve: ConcentrationPoint[];
  baseline_curve: ConcentrationPoint[] | null;
  intakes: CaffeineIntake[];
}
