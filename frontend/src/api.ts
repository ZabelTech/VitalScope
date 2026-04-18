import type {
  BodyCompositionEstimate,
  BodyCompositionEstimateInput,
  FormCheckAnalysisResult,
  JournalEntry,
  Meal,
  MealAnalysisResult,
  NutrientDef,
  NutrientCategory,
  NutrientGoals,
  NutritionDailyTotals,
  PlannedActivity,
  Supplement,
  SupplementIntake,
  TimeOfDay,
  Upload,
  UploadKind,
  WaterDaily,
  WaterEntry,
} from "./types";

export interface RuntimeInfo {
  demo: boolean;
  env: string;
  commit: string;
  ai_available: boolean;
}

export async function fetchRuntime(): Promise<RuntimeInfo> {
  const res = await fetch("/api/runtime");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchMetric<T>(
  endpoint: string,
  start: string,
  end: string
): Promise<T> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`/api/${endpoint}?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchDateRange() {
  const res = await fetch("/api/date-range");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchJournalEntry(date: string): Promise<JournalEntry | null> {
  const res = await fetch(`/api/journal/${date}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function submitJournalEntry(entry: JournalEntry): Promise<void> {
  const res = await fetch("/api/journal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export interface SupplementInput {
  name: string;
  dosage: string;
  time_of_day: TimeOfDay;
  sort_order?: number;
}

export async function listSupplements(): Promise<Supplement[]> {
  const res = await fetch("/api/supplements");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createSupplement(body: SupplementInput): Promise<Supplement> {
  const res = await fetch("/api/supplements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sort_order: 0, ...body }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateSupplement(id: number, body: SupplementInput): Promise<Supplement> {
  const res = await fetch(`/api/supplements/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sort_order: 0, ...body }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteSupplement(id: number): Promise<void> {
  const res = await fetch(`/api/supplements/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchJournalSupplements(date: string): Promise<SupplementIntake[]> {
  const res = await fetch(`/api/journal/${date}/supplements`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function submitJournalSupplements(
  date: string,
  items: { supplement_id: number; taken: boolean }[]
): Promise<void> {
  const res = await fetch(`/api/journal/${date}/supplements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function listNutrientDefs(): Promise<NutrientDef[]> {
  const res = await fetch("/api/nutrients/definitions");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createNutrientDef(body: {
  key: string;
  label: string;
  unit: string;
  category: NutrientCategory;
  sort_order?: number;
}): Promise<NutrientDef> {
  const res = await fetch("/api/nutrients/definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sort_order: 0, ...body }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteNutrientDef(key: string): Promise<void> {
  const res = await fetch(`/api/nutrients/definitions/${key}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export interface MealInput {
  date: string;
  time: string | null;
  name: string;
  notes: string | null;
  nutrients: { nutrient_key: string; amount: number }[];
  source_upload_id?: number | null;
}

export async function listMeals(start: string, end: string): Promise<Meal[]> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`/api/meals?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createMeal(body: MealInput): Promise<Meal> {
  const res = await fetch("/api/meals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateMeal(id: number, body: MealInput): Promise<Meal> {
  const res = await fetch(`/api/meals/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteMeal(id: number): Promise<void> {
  const res = await fetch(`/api/meals/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchNutritionDaily(
  start: string,
  end: string
): Promise<NutritionDailyTotals[]> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`/api/nutrition/daily?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listWater(start: string, end: string): Promise<WaterEntry[]> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`/api/water?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createWater(body: {
  date: string;
  time: string | null;
  amount_ml: number;
}): Promise<WaterEntry> {
  const res = await fetch("/api/water", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteWater(id: number): Promise<void> {
  const res = await fetch(`/api/water/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchWaterDaily(start: string, end: string): Promise<WaterDaily[]> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`/api/water/daily?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Nutrition goals ---

export async function fetchNutritionGoals(): Promise<NutrientGoals> {
  const res = await fetch("/api/nutrition/goals");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateNutritionGoals(goals: NutrientGoals): Promise<void> {
  const res = await fetch("/api/nutrition/goals", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goals }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// --- Planned activities ---

export async function fetchPlanned(start: string, end: string): Promise<PlannedActivity[]> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`/api/planned?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Uploads ---

export async function fetchUploads(kind?: UploadKind, date?: string): Promise<Upload[]> {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (date) params.set("date", date);
  const res = await fetch(`/api/uploads?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function uploadImage(kind: UploadKind, date: string, file: File): Promise<Upload> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("date", date);
  fd.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteUpload(id: number): Promise<void> {
  const res = await fetch(`/api/uploads/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export function uploadImageUrl(id: number): string {
  return `/api/uploads/${id}`;
}

// --- AI meal analysis ---

export async function analyzeMealImage(
  upload_id: number,
  user_notes?: string,
): Promise<MealAnalysisResult> {
  return postAnalyze("/api/meals/analyze-image", upload_id, user_notes);
}

export async function analyzeFormCheckImage(
  upload_id: number,
  user_notes?: string,
): Promise<FormCheckAnalysisResult> {
  return postAnalyze("/api/form-checks/analyze-image", upload_id, user_notes);
}

async function postAnalyze<T>(
  path: string,
  upload_id: number,
  user_notes?: string,
): Promise<T> {
  const body: { upload_id: number; user_notes?: string } = { upload_id };
  const trimmed = user_notes?.trim();
  if (trimmed) body.user_notes = trimmed;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `API error: ${res.status}`);
  }
  return res.json();
}

// --- Body composition estimates ---

export async function createBodyCompositionEstimate(
  body: BodyCompositionEstimateInput,
): Promise<BodyCompositionEstimate> {
  const res = await fetch("/api/body-composition-estimates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listBodyCompositionEstimates(
  start: string,
  end: string,
): Promise<BodyCompositionEstimate[]> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`/api/body-composition-estimates?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteBodyCompositionEstimate(id: number): Promise<void> {
  const res = await fetch(`/api/body-composition-estimates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// --- Plugins ---

export type PluginParamType = "text" | "secret" | "int" | "bool";

export interface PluginParamSpec {
  key: string;
  label: string;
  type: PluginParamType;
  default: unknown;
  required: boolean;
}

export interface PluginConfig {
  name: string;
  label: string;
  description: string;
  default_interval_minutes: number;
  param_schema: PluginParamSpec[];
  enabled: boolean;
  interval_minutes: number;
  params: Record<string, unknown>;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
}

export interface PluginRun {
  id: number;
  name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  message: string | null;
  rows_written: number | null;
}

export async function listPlugins(): Promise<PluginConfig[]> {
  const res = await fetch("/api/plugins");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updatePlugin(
  name: string,
  body: { enabled: boolean; interval_minutes: number; params: Record<string, unknown> }
): Promise<PluginConfig> {
  const res = await fetch(`/api/plugins/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function runPluginNow(name: string): Promise<void> {
  const res = await fetch(`/api/plugins/${name}/run`, { method: "POST" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function listPluginRuns(name: string, limit = 10): Promise<PluginRun[]> {
  const res = await fetch(`/api/plugins/${name}/runs?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
