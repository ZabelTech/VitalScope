import { useMemo, useState } from "react";
import type { NutrientCategory, NutrientDef } from "../types";

const CATEGORY_ORDER: NutrientCategory[] = ["macro", "mineral", "vitamin", "bioactive"];
const CATEGORY_LABELS: Record<NutrientCategory, string> = {
  macro: "Macros",
  mineral: "Minerals",
  vitamin: "Vitamins",
  bioactive: "Bioactives",
};

export interface MealFormValues {
  name: string;
  time: string;
  notes: string;
  /** nutrient_key → string amount (mirrors input state) */
  amounts: Record<string, string>;
}

export interface MealFormOutput {
  name: string;
  time: string | null;
  notes: string | null;
  nutrients: { nutrient_key: string; amount: number }[];
}

interface Props {
  defsByCategory: Record<NutrientCategory, NutrientDef[]>;
  initial?: Partial<MealFormValues>;
  /** Nutrient keys the caller wants rendered in a "not sure" style. */
  greyedKeys?: string[];
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: (out: MealFormOutput) => Promise<void> | void;
  onCancel?: () => void;
  saving?: boolean;
  header?: React.ReactNode;
}

/** Shared meal form — used by AddMealForm on /act and by MealAnalysisDraft
 *  on the landing after AI analysis. Owns its own inputs; the parent gets
 *  a clean MealFormOutput on submit. */
export function MealFormFields({
  defsByCategory,
  initial,
  greyedKeys,
  submitLabel = "Save",
  cancelLabel,
  onSubmit,
  onCancel,
  saving = false,
  header,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>(initial?.amounts ?? {});
  const [expanded, setExpanded] = useState<Record<NutrientCategory, boolean>>({
    macro: true,
    mineral: false,
    vitamin: false,
    bioactive: false,
  });

  const greyedSet = useMemo(() => new Set(greyedKeys ?? []), [greyedKeys]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const nutrients = Object.entries(amounts)
      .map(([key, value]) => ({ nutrient_key: key, amount: parseFloat(value) }))
      .filter((n) => !Number.isNaN(n.amount));
    await onSubmit({
      name: name.trim(),
      time: time || null,
      notes: notes.trim() || null,
      nutrients,
    });
  }

  return (
    <form className="journal-form" onSubmit={handleSubmit}>
      {header}
      <div className="meal-header-inputs">
        <input
          type="text"
          placeholder="Name (e.g. Breakfast)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
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
            {expanded[cat] ? "▾" : "▸"} {CATEGORY_LABELS[cat]} ({defsByCategory[cat].length})
          </button>
          {expanded[cat] && (
            <div className="nutrient-grid">
              {defsByCategory[cat].map((d) => {
                const greyed = greyedSet.has(d.key);
                return (
                  <label
                    key={d.key}
                    className={`nutrient-row ${greyed ? "nutrient-row-greyed" : ""}`}
                    title={greyed ? "AI wasn't sure — fill in if you know" : undefined}
                  >
                    <span className="nutrient-label">{d.label}</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={amounts[d.key] ?? ""}
                      onChange={(e) =>
                        setAmounts({ ...amounts, [d.key]: e.target.value })
                      }
                      placeholder={greyed ? "?" : "—"}
                    />
                    <span className="nutrient-unit">{d.unit}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <div className="journal-actions">
        <button type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="chip" onClick={onCancel} disabled={saving}>
            {cancelLabel ?? "Cancel"}
          </button>
        )}
      </div>
    </form>
  );
}
