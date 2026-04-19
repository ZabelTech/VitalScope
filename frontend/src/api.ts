import type {
  BloodworkAnalysisResult,
  BloodworkPanel,
  BloodworkPanelInput,
  BodyCompositionEstimate,
  BodyCompositionEstimateInput,
  FormCheckAnalysisResult,
  GenomeParseResult,
  GenomeUpload,
  GenomeUploadInput,
  JournalEntry,
  Meal,
  MealAnalysisResult,
  NutrientDef,
  NutrientCategory,
  NutrientGoals,
  NutritionDailyTotals,
  OrientAnalysis,
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
  ai_provider: "anthropic" | "openai" | "openrouter" | "demo" | null;
  ai_model: string | null;
}

// Wrapper around fetch that always sends the auth cookie and reloads on 401
// so the login form appears when the session expires. `same-origin` is the
// browser default, but making it explicit avoids variance in older iOS Safari
// and service-worker-mediated contexts where the cookie was being omitted.
const PUBLIC_AUTH_PATHS = new Set(["/api/login", "/api/logout", "/api/auth/status"]);

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, { credentials: "same-origin", ...init });
  if (res.status === 401 && !PUBLIC_AUTH_PATHS.has(input.split("?")[0])) {
    window.location.reload();
  }
  return res;
}

export async function fetchRuntime(): Promise<RuntimeInfo> {
  const res = await apiFetch("/api/runtime");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchMetric<T>(
  endpoint: string,
  start: string,
  end: string
): Promise<T> {
  const params = new URLSearchParams({ start, end });
  const res = await apiFetch(`/api/${endpoint}?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchDateRange() {
  const res = await apiFetch("/api/date-range");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchJournalEntry(date: string): Promise<JournalEntry | null> {
  const res = await apiFetch(`/api/journal/${date}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function submitJournalEntry(entry: JournalEntry): Promise<void> {
  const res = await apiFetch("/api/journal", {
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
  const res = await apiFetch("/api/supplements");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createSupplement(body: SupplementInput): Promise<Supplement> {
  const res = await apiFetch("/api/supplements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sort_order: 0, ...body }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateSupplement(id: number, body: SupplementInput): Promise<Supplement> {
  const res = await apiFetch(`/api/supplements/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sort_order: 0, ...body }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteSupplement(id: number): Promise<void> {
  const res = await apiFetch(`/api/supplements/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchJournalSupplements(date: string): Promise<SupplementIntake[]> {
  const res = await apiFetch(`/api/journal/${date}/supplements`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function submitJournalSupplements(
  date: string,
  items: { supplement_id: number; taken: boolean }[]
): Promise<void> {
  const res = await apiFetch(`/api/journal/${date}/supplements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function listNutrientDefs(): Promise<NutrientDef[]> {
  const res = await apiFetch("/api/nutrients/definitions");
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
  const res = await apiFetch("/api/nutrients/definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sort_order: 0, ...body }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteNutrientDef(key: string): Promise<void> {
  const res = await apiFetch(`/api/nutrients/definitions/${key}`, { method: "DELETE" });
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
  const res = await apiFetch(`/api/meals?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createMeal(body: MealInput): Promise<Meal> {
  const res = await apiFetch("/api/meals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateMeal(id: number, body: MealInput): Promise<Meal> {
  const res = await apiFetch(`/api/meals/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteMeal(id: number): Promise<void> {
  const res = await apiFetch(`/api/meals/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchNutritionDaily(
  start: string,
  end: string
): Promise<NutritionDailyTotals[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiFetch(`/api/nutrition/daily?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listWater(start: string, end: string): Promise<WaterEntry[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiFetch(`/api/water?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createWater(body: {
  date: string;
  time: string | null;
  amount_ml: number;
}): Promise<WaterEntry> {
  const res = await apiFetch("/api/water", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteWater(id: number): Promise<void> {
  const res = await apiFetch(`/api/water/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchWaterDaily(start: string, end: string): Promise<WaterDaily[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiFetch(`/api/water/daily?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Nutrition goals ---

export async function fetchNutritionGoals(): Promise<NutrientGoals> {
  const res = await apiFetch("/api/nutrition/goals");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateNutritionGoals(goals: NutrientGoals): Promise<void> {
  const res = await apiFetch("/api/nutrition/goals", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goals }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// --- Planned activities ---

export async function fetchPlanned(start: string, end: string): Promise<PlannedActivity[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiFetch(`/api/planned?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Uploads ---

export async function fetchUploads(kind?: UploadKind, date?: string): Promise<Upload[]> {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (date) params.set("date", date);
  const res = await apiFetch(`/api/uploads?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function uploadImage(kind: UploadKind, date: string, file: File): Promise<Upload> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("date", date);
  fd.append("file", file);
  const res = await apiFetch("/api/uploads", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteUpload(id: number): Promise<void> {
  const res = await apiFetch(`/api/uploads/${id}`, { method: "DELETE" });
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

export async function analyzeBloodworkUpload(
  upload_id: number,
  user_notes?: string,
): Promise<BloodworkAnalysisResult> {
  return postAnalyze("/api/bloodwork/analyze-upload", upload_id, user_notes);
}

async function postAnalyze<T>(
  path: string,
  upload_id: number,
  user_notes?: string,
): Promise<T> {
  const body: { upload_id: number; user_notes?: string } = { upload_id };
  const trimmed = user_notes?.trim();
  if (trimmed) body.user_notes = trimmed;
  const res = await apiFetch(path, {
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
  const res = await apiFetch("/api/body-composition-estimates", {
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
  const res = await apiFetch(`/api/body-composition-estimates?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteBodyCompositionEstimate(id: number): Promise<void> {
  const res = await apiFetch(`/api/body-composition-estimates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// --- Bloodwork panels ---

export async function createBloodworkPanel(
  body: BloodworkPanelInput,
): Promise<BloodworkPanel> {
  const res = await apiFetch("/api/bloodwork-panels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listBloodworkPanels(
  start: string,
  end: string,
): Promise<BloodworkPanel[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiFetch(`/api/bloodwork-panels?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getBloodworkPanel(id: number): Promise<BloodworkPanel> {
  const res = await apiFetch(`/api/bloodwork-panels/${id}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteBloodworkPanel(id: number): Promise<void> {
  const res = await apiFetch(`/api/bloodwork-panels/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// --- Genome uploads ---

export async function parseGenomeUpload(upload_id: number): Promise<GenomeParseResult> {
  const res = await apiFetch("/api/genome/parse-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `API error: ${res.status}`);
  }
  return res.json();
}

export async function createGenomeUpload(body: GenomeUploadInput): Promise<GenomeUpload> {
  const res = await apiFetch("/api/genome-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listGenomeUploads(start: string, end: string): Promise<GenomeUpload[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiFetch(`/api/genome-uploads?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteGenomeUpload(id: number): Promise<void> {
  const res = await apiFetch(`/api/genome-uploads/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// --- Orient AI analysis ---

export async function analyzeOrient(window_days = 14): Promise<OrientAnalysis> {
  const res = await apiFetch("/api/orient/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ window_days }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `API error: ${res.status}`);
  }
  return res.json();
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
  avg_duration_seconds: number | null;
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
  const res = await apiFetch("/api/plugins");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updatePlugin(
  name: string,
  body: { enabled: boolean; interval_minutes: number; params: Record<string, unknown> }
): Promise<PluginConfig> {
  const res = await apiFetch(`/api/plugins/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function runPluginNow(name: string): Promise<{ status: string; name: string; run_id: number }> {
  const res = await apiFetch(`/api/plugins/${name}/run`, { method: "POST" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listPluginRuns(name: string, limit = 10): Promise<PluginRun[]> {
  const res = await apiFetch(`/api/plugins/${name}/runs?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
