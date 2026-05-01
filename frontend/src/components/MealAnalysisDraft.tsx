import { useMemo } from "react";
import { createMeal } from "../api";
import type { MealAnalysisResult, NutrientCategory, NutrientDef } from "../types";
import { MealFormFields, type MealFormOutput } from "./MealFormFields";

interface Props {
  result: MealAnalysisResult;
  uploadId?: number | null;
  date: string;
  defsByCategory: Record<NutrientCategory, NutrientDef[]>;
  onSaved: () => void;
  onCancel: () => void;
}

export function MealAnalysisDraft({
  result,
  uploadId,
  date,
  defsByCategory,
  onSaved,
  onCancel,
}: Props) {
  const initial = useMemo(() => {
    const amounts: Record<string, string> = {};
    for (const n of result.nutrients) {
      amounts[n.nutrient_key] = String(n.amount);
    }
    return {
      name: result.suggested_name,
      time: "",
      notes: result.suggested_notes,
      amounts,
    };
  }, [result]);

  async function handleSubmit(out: MealFormOutput) {
    await createMeal({
      date,
      time: out.time,
      name: out.name,
      notes: out.notes,
      nutrients: out.nutrients,
      source_upload_id: uploadId ?? null,
    });
    onSaved();
  }

  const confidenceColor = {
    low: "#ef4444",
    medium: "#f59e0b",
    high: "#22c55e",
  }[result.confidence];

  return (
    <div className="meal-analysis-draft">
      <div className="meal-analysis-head">
        <span
          className="confidence-badge"
          style={{ background: confidenceColor }}
        >
          {result.confidence}
        </span>
        <span className="stat-label">
          AI estimate — review before saving
        </span>
      </div>
      <MealFormFields
        defsByCategory={defsByCategory}
        initial={initial}
        greyedKeys={result.unknown_keys}
        submitLabel="Save meal"
        cancelLabel="Discard"
        onSubmit={handleSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}
