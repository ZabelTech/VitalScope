import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  createMeal,
  deleteMeal,
  listMeals,
  listNutrientDefs,
} from "../api";
import type { Meal, NutrientCategory, NutrientDef } from "../types";
import { WaterQuickLog } from "./WaterQuickLog";

const CATEGORY_ORDER: NutrientCategory[] = ["macro", "mineral", "vitamin", "bioactive"];
const CATEGORY_LABELS: Record<NutrientCategory, string> = {
  macro: "Macros",
  mineral: "Minerals",
  vitamin: "Vitamins",
  bioactive: "Bioactives",
};

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
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<NutrientCategory, boolean>>({
    macro: true,
    mineral: false,
    vitamin: false,
    bioactive: false,
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const nutrients = Object.entries(amounts)
      .map(([key, value]) => ({ nutrient_key: key, amount: parseFloat(value) }))
      .filter((n) => !Number.isNaN(n.amount));
    setSaving(true);
    try {
      await createMeal({
        date,
        time: time || null,
        name: name.trim(),
        notes: notes.trim() || null,
        nutrients,
      });
      setName("");
      setTime("");
      setNotes("");
      setAmounts({});
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="journal-form" onSubmit={handleSubmit}>
      <h4 className="stat-label">Add meal</h4>
      <div className="meal-header-inputs">
        <input
          type="text"
          placeholder="Name (e.g. Breakfast)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="nutrient-group">
          <button
            type="button"
            className="nutrient-group-header"
            onClick={() => setExpanded({ ...expanded, [cat]: !expanded[cat] })}
          >
            {expanded[cat] ? "▾" : "▸"} {CATEGORY_LABELS[cat]} (
            {defsByCategory[cat].length})
          </button>
          {expanded[cat] && (
            <div className="nutrient-grid">
              {defsByCategory[cat].map((d) => (
                <label key={d.key} className="nutrient-row">
                  <span className="nutrient-label">{d.label}</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={amounts[d.key] ?? ""}
                    onChange={(e) =>
                      setAmounts({ ...amounts, [d.key]: e.target.value })
                    }
                    placeholder="—"
                  />
                  <span className="nutrient-unit">{d.unit}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="journal-actions">
        <button type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Add meal"}
        </button>
      </div>
    </form>
  );
}

