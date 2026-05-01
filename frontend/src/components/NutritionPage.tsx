import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  applyMealPreset,
  createMeal,
  createMealPreset,
  deleteMeal,
  deleteMealPreset,
  fetchGlucosePostprandial,
  listMealPresets,
  listMeals,
  listNutrientDefs,
} from "../api";
import type {
  GlucoseReading,
  Meal,
  MealPreset,
  NutrientCategory,
  NutrientDef,
} from "../types";
import { MealFormFields, type MealFormOutput, type MealFormValues } from "./MealFormFields";
import { NutritionGaps } from "./NutritionGaps";
import { WaterQuickLog } from "./WaterQuickLog";

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function PostprandialCurve({ date, time }: { date: string; time: string }) {
  const [readings, setReadings] = useState<GlucoseReading[] | null>(null);

  useEffect(() => {
    const timePart = time.length === 5 ? `${time}:00` : time;
    const mealTime = `${date}T${timePart}`;
    fetchGlucosePostprandial(mealTime)
      .then((r) => setReadings(r.length > 0 ? r : null))
      .catch(() => setReadings(null));
  }, [date, time]);

  if (!readings) return null;

  const chartData = readings.map((r) => ({
    ts: r.timestamp.slice(11, 16),
    mgdl: r.mgdl,
  }));

  return (
    <div className="postprandial-chart">
      <span className="stat-label">2-hour glucose response</span>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#334155" />
          <XAxis dataKey="ts" tick={{ fontSize: 10 }} />
          <YAxis domain={[60, "auto"]} tick={{ fontSize: 10 }} width={36} />
          <Tooltip formatter={(v) => [`${v} mg/dL`]} />
          <Line
            type="monotone"
            dataKey="mgdl"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NutritionPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [defs, setDefs] = useState<NutrientDef[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [presets, setPresets] = useState<MealPreset[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [gapsKey, setGapsKey] = useState(0);
  const [draftFromPreset, setDraftFromPreset] = useState<MealPreset | null>(null);

  useEffect(() => {
    listNutrientDefs().then(setDefs).catch(() => setStatus("error"));
    reloadPresets();
  }, []);

  async function reloadPresets() {
    try {
      setPresets(await listMealPresets());
    } catch {
      // non-fatal
    }
  }

  async function reload() {
    setStatus("loading");
    try {
      setMeals(await listMeals(date, date));
      setStatus("idle");
      setGapsKey((k) => k + 1);
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const defsByCategory = useMemo(() => {
    const groups: Record<NutrientCategory, NutrientDef[]> = {
      macro: [],
      mineral: [],
      vitamin: [],
      bioactive: [],
    };
    for (const d of defs) groups[d.category].push(d);
    return groups;
  }, [defs]);

  const defsByKey = useMemo(() => {
    const map: Record<string, NutrientDef> = {};
    for (const d of defs) map[d.key] = d;
    return map;
  }, [defs]);

  async function handleDeleteMeal(id: number) {
    await deleteMeal(id);
    await reload();
  }

  async function handleApplyPreset(presetId: number) {
    await applyMealPreset(presetId, date);
    await reload();
  }

  function handleUseDraft(preset: MealPreset) {
    setDraftFromPreset(preset);
  }

  async function handleSavePresetFromMeal(meal: Meal) {
    const name = window.prompt("Preset name:", meal.name);
    if (!name) return;
    try {
      await createMealPreset({ name: name.trim(), notes: meal.notes, from_meal_id: meal.id });
      await reloadPresets();
    } catch (err) {
      window.alert(`Failed to save preset: ${(err as Error).message}`);
    }
  }

  async function handleDeletePreset(id: number) {
    if (!window.confirm("Delete this preset?")) return;
    await deleteMealPreset(id);
    await reloadPresets();
  }

  return (
    <div className="journal-page">
      <div className="overview-card journal-form">
        <label className="journal-field">
          <span className="stat-label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {status === "error" && <p className="journal-err">Failed to load nutrition data</p>}
      </div>

      <div className="overview-card journal-form">
        <h3 className="stat-label">Meals</h3>
        {meals.length === 0 && <p className="journal-hint">No meals logged for this date.</p>}
        {meals.map((m) => (
          <div key={m.id} className="meal-row">
            <div className="meal-header">
              <span className="supplement-name">
                {m.time ? `${m.time} · ` : ""}
                {m.name}
              </span>
              <div>
                <button
                  type="button"
                  className="chip"
                  onClick={() => handleSavePresetFromMeal(m)}
                  aria-label={`Save ${m.name} as preset`}
                >
                  Save as preset
                </button>
                <button
                  type="button"
                  className="supplement-delete"
                  onClick={() => handleDeleteMeal(m.id)}
                  aria-label={`Delete ${m.name}`}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="meal-nutrients">
              {m.nutrients.map((n) => {
                const def = defsByKey[n.key];
                return (
                  <span key={n.key} className="meal-nutrient-chip">
                    {def?.label ?? n.key}: {n.amount}
                    {def?.unit ?? ""}
                  </span>
                );
              })}
              {m.nutrients.length === 0 && (
                <span className="supplement-dosage">(no nutrients)</span>
              )}
            </div>
            {m.notes && <div className="supplement-dosage">{m.notes}</div>}
            {m.time && <PostprandialCurve date={m.date} time={m.time} />}
          </div>
        ))}

        <PresetChooser
          presets={presets}
          onApply={handleApplyPreset}
          onUseDraft={handleUseDraft}
          onDelete={handleDeletePreset}
        />

        <AddMealForm
          date={date}
          defsByCategory={defsByCategory}
          onAdded={reload}
          draftFromPreset={draftFromPreset}
          onDraftConsumed={() => setDraftFromPreset(null)}
        />
      </div>

      <NutritionGaps date={date} refreshKey={gapsKey} asCard />

      <WaterQuickLog date={date} />
    </div>
  );
}

function PresetChooser({
  presets,
  onApply,
  onUseDraft,
  onDelete,
}: {
  presets: MealPreset[];
  onApply: (id: number) => Promise<void>;
  onUseDraft: (p: MealPreset) => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  if (presets.length === 0 && !manageOpen) {
    return (
      <p className="journal-hint">
        No presets yet. Save a meal as a preset to re-log it later.
      </p>
    );
  }

  const selected = presets.find((p) => p.id === selectedId) ?? null;

  async function handleApplyClick() {
    if (selected == null) return;
    setBusy(true);
    try {
      await onApply(selected.id);
    } finally {
      setBusy(false);
    }
  }

  function handleUseDraftClick() {
    if (selected == null) return;
    onUseDraft(selected);
  }

  return (
    <div className="journal-form" style={{ marginTop: 8 }}>
      <div className="meal-header-inputs">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">Pick a preset…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={selected == null || busy}
          onClick={handleApplyClick}
        >
          {busy ? "Logging…" : "Log preset"}
        </button>
        <button type="button" disabled={selected == null} onClick={handleUseDraftClick}>
          Use as draft
        </button>
        <button type="button" className="chip" onClick={() => setManageOpen((o) => !o)}>
          {manageOpen ? "Hide presets" : "Manage presets"}
        </button>
      </div>
      {manageOpen && (
        <div className="meal-nutrients" style={{ marginTop: 8 }}>
          {presets.length === 0 && <span className="supplement-dosage">No presets.</span>}
          {presets.map((p) => (
            <span key={p.id} className="meal-nutrient-chip">
              {p.name}
              <button
                type="button"
                className="supplement-delete"
                onClick={() => onDelete(p.id)}
                aria-label={`Delete ${p.name}`}
                style={{ marginLeft: 6 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AddMealForm({
  date,
  defsByCategory,
  onAdded,
  draftFromPreset,
  onDraftConsumed,
}: {
  date: string;
  defsByCategory: Record<NutrientCategory, NutrientDef[]>;
  onAdded: () => void;
  draftFromPreset: MealPreset | null;
  onDraftConsumed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (draftFromPreset) {
      setResetKey((k) => k + 1);
    }
  }, [draftFromPreset]);

  const initial: Partial<MealFormValues> | undefined = useMemo(() => {
    if (!draftFromPreset) return undefined;
    const amounts: Record<string, string> = {};
    for (const [k, v] of Object.entries(draftFromPreset.nutrients)) {
      amounts[k] = String(v);
    }
    return {
      name: draftFromPreset.name,
      time: "",
      notes: draftFromPreset.notes ?? "",
      amounts,
    };
  }, [draftFromPreset]);

  async function handleSubmit(out: MealFormOutput) {
    setSaving(true);
    try {
      await createMeal({
        date,
        time: out.time,
        name: out.name,
        notes: out.notes,
        nutrients: out.nutrients,
      });
      setResetKey((k) => k + 1);
      onDraftConsumed();
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <MealFormFields
      key={resetKey}
      defsByCategory={defsByCategory}
      initial={initial}
      submitLabel="Add meal"
      onSubmit={handleSubmit}
      saving={saving}
      header={<h4 className="stat-label">Add meal</h4>}
    />
  );
}
