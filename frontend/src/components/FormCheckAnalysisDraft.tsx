import { useState } from "react";
import { createBodyCompositionEstimate } from "../api";
import type {
  BodyCompositionEstimateInput,
  FatigueSigns,
  FormCheckAnalysisResult,
  HydrationSigns,
  MuscleMassCategory,
  VisibleDefinitionLevel,
  WaterRetentionLevel,
} from "../types";

interface Props {
  result: FormCheckAnalysisResult;
  uploadId: number;
  date: string;
  onSaved: () => void;
  onCancel: () => void;
}

const MUSCLE_OPTIONS: { value: MuscleMassCategory; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "average", label: "Average" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very high" },
];

const WATER_OPTIONS: { value: WaterRetentionLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "pronounced", label: "Pronounced" },
];

const DEFINITION_OPTIONS: { value: VisibleDefinitionLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very high" },
];

const FATIGUE_OPTIONS: { value: FatigueSigns; label: string }[] = [
  { value: "none", label: "None" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "notable", label: "Notable" },
];

const HYDRATION_OPTIONS: { value: HydrationSigns; label: string }[] = [
  { value: "well_hydrated", label: "Well hydrated" },
  { value: "neutral", label: "Neutral" },
  { value: "mild_dehydration", label: "Mild dehydration" },
  { value: "notable_dehydration", label: "Notable dehydration" },
];

export function FormCheckAnalysisDraft({
  result,
  uploadId,
  date,
  onSaved,
  onCancel,
}: Props) {
  const [bodyFat, setBodyFat] = useState<string>(
    result.body_fat_pct != null ? String(result.body_fat_pct) : "",
  );
  const [muscle, setMuscle] = useState<MuscleMassCategory | "">(
    result.muscle_mass_category ?? "",
  );
  const [water, setWater] = useState<WaterRetentionLevel | "">(
    result.water_retention ?? "",
  );
  const [definition, setDefinition] = useState<VisibleDefinitionLevel | "">(
    result.visible_definition ?? "",
  );
  const [fatigue, setFatigue] = useState<FatigueSigns | "">(
    result.fatigue_signs ?? "",
  );
  const [hydration, setHydration] = useState<HydrationSigns | "">(
    result.hydration_signs ?? "",
  );
  const [posture, setPosture] = useState(result.posture_note ?? "");
  const [symmetry, setSymmetry] = useState(result.symmetry_note ?? "");
  const [vigor, setVigor] = useState(result.general_vigor_note ?? "");
  const [notes, setNotes] = useState(result.notes ?? "");
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const greyed = new Set(result.unknown_keys);
  const confidenceColor = {
    low: "#ef4444",
    medium: "#f59e0b",
    high: "#22c55e",
  }[result.confidence];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: BodyCompositionEstimateInput = {
        date,
        source_upload_id: uploadId,
        body_fat_pct: bodyFat.trim() ? Number(bodyFat) : null,
        muscle_mass_category: muscle || null,
        water_retention: water || null,
        visible_definition: definition || null,
        fatigue_signs: fatigue || null,
        hydration_signs: hydration || null,
        posture_note: posture.trim() || null,
        symmetry_note: symmetry.trim() || null,
        general_vigor_note: vigor.trim() || null,
        notes: notes.trim() || null,
        confidence: result.confidence,
      };
      await createBodyCompositionEstimate(body);
      onSaved();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="meal-analysis-draft" onSubmit={handleSubmit}>
      <div className="meal-analysis-head">
        <span className="confidence-badge" style={{ background: confidenceColor }}>
          {result.confidence}
        </span>
        <span className="stat-label">AI estimate — review before saving</span>
      </div>

      <label className="journal-field">
        <span className="stat-label">
          Body fat %{" "}
          {greyed.has("body_fat_pct") && (
            <span className="journal-hint">(AI wasn't sure)</span>
          )}
        </span>
        <input
          type="number"
          step="0.5"
          min="0"
          max="60"
          value={bodyFat}
          placeholder="?"
          onChange={(e) => setBodyFat(e.target.value)}
        />
      </label>

      <SelectRow
        label="Muscle mass"
        value={muscle}
        options={MUSCLE_OPTIONS}
        greyed={greyed.has("muscle_mass_category")}
        onChange={(v) => setMuscle(v as MuscleMassCategory | "")}
      />
      <SelectRow
        label="Water retention"
        value={water}
        options={WATER_OPTIONS}
        greyed={greyed.has("water_retention")}
        onChange={(v) => setWater(v as WaterRetentionLevel | "")}
      />
      <SelectRow
        label="Visible definition"
        value={definition}
        options={DEFINITION_OPTIONS}
        greyed={greyed.has("visible_definition")}
        onChange={(v) => setDefinition(v as VisibleDefinitionLevel | "")}
      />
      <SelectRow
        label="Fatigue signs"
        value={fatigue}
        options={FATIGUE_OPTIONS}
        greyed={greyed.has("fatigue_signs")}
        onChange={(v) => setFatigue(v as FatigueSigns | "")}
      />
      <SelectRow
        label="Hydration signs"
        value={hydration}
        options={HYDRATION_OPTIONS}
        greyed={greyed.has("hydration_signs")}
        onChange={(v) => setHydration(v as HydrationSigns | "")}
      />

      <button
        type="button"
        className="nutrient-group-header"
        onClick={() => setShowMore((v) => !v)}
      >
        {showMore ? "▾" : "▸"} More observations
      </button>
      {showMore && (
        <>
          <label className="journal-field">
            <span className="stat-label">Posture</span>
            <textarea
              rows={2}
              value={posture}
              onChange={(e) => setPosture(e.target.value)}
            />
          </label>
          <label className="journal-field">
            <span className="stat-label">Symmetry</span>
            <textarea
              rows={2}
              value={symmetry}
              onChange={(e) => setSymmetry(e.target.value)}
            />
          </label>
          <label className="journal-field">
            <span className="stat-label">General vigor</span>
            <textarea
              rows={2}
              value={vigor}
              onChange={(e) => setVigor(e.target.value)}
            />
          </label>
        </>
      )}

      <label className="journal-field">
        <span className="stat-label">Summary notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <p className="journal-err">{error}</p>}

      <div className="journal-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save estimate"}
        </button>
        <button type="button" className="chip" onClick={onCancel} disabled={saving}>
          Discard
        </button>
      </div>
    </form>
  );
}

function SelectRow<V extends string>({
  label,
  value,
  options,
  greyed,
  onChange,
}: {
  label: string;
  value: V | "";
  options: { value: V; label: string }[];
  greyed: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="journal-field">
      <span className="stat-label">
        {label}{" "}
        {greyed && <span className="journal-hint">(AI wasn't sure)</span>}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
