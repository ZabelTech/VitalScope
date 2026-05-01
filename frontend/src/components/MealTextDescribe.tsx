import { useEffect, useMemo, useState } from "react";
import { analyzeMealText, listNutrientDefs } from "../api";
import type { MealAnalysisResult, NutrientCategory, NutrientDef } from "../types";
import { useRuntime } from "../hooks/useRuntime";
import { MealAnalysisDraft } from "./MealAnalysisDraft";

interface Props {
  date: string;
  onDateChange?: (date: string) => void;
  showDatePicker?: boolean;
  onSaved?: () => void;
  label?: string;
  hint?: string;
}

export function MealTextDescribe({
  date,
  onDateChange,
  showDatePicker = false,
  onSaved,
  label = "Describe a meal",
  hint,
}: Props) {
  const runtime = useRuntime();
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MealAnalysisResult | null>(null);

  const [nutrientDefs, setNutrientDefs] = useState<NutrientDef[]>([]);
  useEffect(() => {
    listNutrientDefs().then(setNutrientDefs).catch(() => setNutrientDefs([]));
  }, []);

  const defsByCategory = useMemo(() => {
    const groups: Record<NutrientCategory, NutrientDef[]> = {
      macro: [],
      mineral: [],
      vitamin: [],
      bioactive: [],
    };
    for (const d of nutrientDefs) groups[d.category].push(d);
    return groups;
  }, [nutrientDefs]);

  const canAnalyse = runtime?.ai_available === true;

  async function runAnalyse() {
    const text = description.trim();
    if (!text) return;
    setError(null);
    setAnalysing(true);
    try {
      const result = await analyzeMealText(text, note);
      setDraft(result);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setAnalysing(false);
    }
  }

  function reset() {
    setDescription("");
    setNote("");
    setDraft(null);
    setError(null);
  }

  function onDraftSaved() {
    reset();
    onSaved?.();
  }

  return (
    <div className="meal-text-describe">
      <div className="image-upload-header">
        <span className="stat-label">{label}</span>
      </div>
      {hint && <p className="journal-hint">{hint}</p>}
      {!canAnalyse && (
        <p className="journal-hint">AI analysis not configured — describe-a-meal is unavailable.</p>
      )}
      {showDatePicker && onDateChange && (
        <label className="journal-field">
          <span className="stat-label">Date</span>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </label>
      )}
      {!draft && (
        <div className="meal-analysis-preflight">
          <label className="journal-field">
            <span className="stat-label">What did you eat?</span>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. ~200g grilled salmon, 150g jasmine rice, mixed greens with olive oil"
              disabled={analysing || !canAnalyse}
            />
          </label>
          <label className="journal-field">
            <span className="stat-label">Extra context (optional)</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. lunch around 13:00, post-workout meal"
              disabled={analysing || !canAnalyse}
            />
          </label>
          <div className="journal-actions">
            <button
              type="button"
              onClick={runAnalyse}
              disabled={analysing || !canAnalyse || !description.trim()}
            >
              {analysing ? "Analysing… (~10s)" : "Analyse"}
            </button>
            {(description || note) && (
              <button
                type="button"
                className="chip"
                onClick={reset}
                disabled={analysing}
              >
                Clear
              </button>
            )}
          </div>
          {error && <p className="journal-err">{error}</p>}
        </div>
      )}
      {draft && (
        <MealAnalysisDraft
          result={draft}
          uploadId={null}
          date={date}
          defsByCategory={defsByCategory}
          onSaved={onDraftSaved}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}
