import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  createMeal,
  deleteMeal,
  listMeals,
  listNutrientDefs,
} from "../api";
import type { Meal, NutrientCategory, NutrientDef } from "../types";
import { MealFormFields, type MealFormOutput } from "./MealFormFields";
import { WaterQuickLog } from "./WaterQuickLog";

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function NutritionPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [defs, setDefs] = useState<NutrientDef[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    listNutrientDefs().then(setDefs).catch(() => setStatus("error"));
  }, []);

  async function reload() {
    setStatus("loading");
    try {
      setMeals(await listMeals(date, date));
      setStatus("idle");
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
              <button
                type="button"
                className="supplement-delete"
                onClick={() => handleDeleteMeal(m.id)}
                aria-label={`Delete ${m.name}`}
              >
                ×
              </button>
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
          </div>
        ))}

        <AddMealForm
          date={date}
          defsByCategory={defsByCategory}
          onAdded={reload}
        />
      </div>

      <WaterQuickLog date={date} />
    </div>
  );
}

function AddMealForm({
  date,
  defsByCategory,
  onAdded,
}: {
  date: string;
  defsByCategory: Record<NutrientCategory, NutrientDef[]>;
  onAdded: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);

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
      setResetKey((k) => k + 1); // remount form → clears inputs
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <MealFormFields
      key={resetKey}
      defsByCategory={defsByCategory}
      submitLabel="Add meal"
      onSubmit={handleSubmit}
      saving={saving}
      header={<h4 className="stat-label">Add meal</h4>}
    />
  );
}

