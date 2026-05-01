import { format } from "date-fns";
import { useEffect, useState } from "react";
import { deleteGoal, fetchGoalDefaults, setGoal } from "../api";
import { notifyGoalsUpdated, useGoals } from "../hooks/useGoals";
import { useMetricData } from "../hooks/useMetricData";
import type { StepsDaily, UserGoals } from "../types";
import { Card, CardHeader } from "./Card";

const today = format(new Date(), "yyyy-MM-dd");

interface GoalDef {
  metric: string;
  label: string;
  unit: string;
  decimals: number;
  direction: string;
  step: number;
}

const GOAL_DEFS: GoalDef[] = [
  { metric: "sleep_hours",   label: "Sleep Duration",  unit: "h",    decimals: 1, direction: "≥", step: 0.5 },
  { metric: "hrv",           label: "HRV",             unit: "ms",   decimals: 0, direction: "≥", step: 1   },
  { metric: "resting_hr",    label: "Resting HR",      unit: "bpm",  decimals: 0, direction: "≤", step: 1   },
  { metric: "weight_kg",     label: "Body Weight",     unit: "kg",   decimals: 1, direction: "→", step: 0.5 },
  { metric: "body_fat_pct",  label: "Body Fat",        unit: "%",    decimals: 1, direction: "≤", step: 0.5 },
  { metric: "calories_kcal", label: "Daily Calories",  unit: "kcal", decimals: 0, direction: "≤", step: 50  },
  { metric: "protein_g",     label: "Protein",         unit: "g",    decimals: 0, direction: "≥", step: 5   },
  { metric: "carbs_g",       label: "Carbs",           unit: "g",    decimals: 0, direction: "≤", step: 5   },
  { metric: "fat_g",         label: "Fat",             unit: "g",    decimals: 0, direction: "≤", step: 5   },
];

function GoalCard({
  def,
  savedValue,
  defaultValue,
  onChange,
}: {
  def: GoalDef;
  savedValue: number | undefined;
  defaultValue: number | undefined;
  onChange: (metric: string, value: number | null) => void;
}) {
  const placeholder = defaultValue != null
    ? defaultValue.toFixed(def.decimals)
    : "";
  const [inputVal, setInputVal] = useState(
    savedValue != null ? savedValue.toFixed(def.decimals) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setInputVal(savedValue != null ? savedValue.toFixed(def.decimals) : "");
  }, [savedValue, def.decimals]);

  async function handleSave() {
    const num = parseFloat(inputVal);
    if (Number.isNaN(num) || inputVal.trim() === "") return;
    setSaving(true);
    try {
      await setGoal(def.metric, num);
      onChange(def.metric, num);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      await deleteGoal(def.metric);
      setInputVal("");
      onChange(def.metric, null);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave();
  }

  const isSet = savedValue != null;

  return (
    <div className="goal-card" style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", borderRadius: "8px", background: "#1e293b", marginBottom: "0.5rem" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#e2e8f0" }}>{def.label}</div>
        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{def.direction} target · {def.unit}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <input
          type="number"
          step={def.step}
          min={0}
          value={inputVal}
          placeholder={placeholder || "—"}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: "90px",
            background: "#0f172a",
            border: `1px solid ${isSet ? "#3b82f6" : "#334155"}`,
            borderRadius: "6px",
            color: "#e2e8f0",
            padding: "0.35rem 0.5rem",
            fontSize: "0.9rem",
            textAlign: "right",
          }}
        />
        <span style={{ fontSize: "0.8rem", color: "#64748b", width: "30px" }}>{def.unit}</span>
        <button
          onClick={handleSave}
          disabled={saving || inputVal.trim() === ""}
          style={{
            padding: "0.3rem 0.6rem",
            borderRadius: "6px",
            background: saved ? "#22c55e" : "#3b82f6",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: "0.8rem",
            minWidth: "48px",
            opacity: saving || inputVal.trim() === "" ? 0.5 : 1,
          }}
        >
          {saved ? "Saved" : "Set"}
        </button>
        {isSet && (
          <button
            onClick={handleClear}
            disabled={saving}
            title="Clear goal"
            style={{
              padding: "0.3rem 0.5rem",
              borderRadius: "6px",
              background: "transparent",
              color: "#64748b",
              border: "1px solid #334155",
              cursor: "pointer",
              fontSize: "0.8rem",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function GoalsPage() {
  const { data: stepsData } = useMetricData<StepsDaily[]>("steps/daily", today, today);
  const stepGoal = stepsData?.[0]?.step_goal ?? null;

  const savedGoals = useGoals();
  const [defaults, setDefaults] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchGoalDefaults()
      .then(setDefaults)
      .catch(() => {});
  }, []);

  function handleGoalChange(metric: string, value: number | null) {
    if (!savedGoals) return;
    const updated: UserGoals = { ...savedGoals };
    if (value == null) {
      delete updated[metric];
    } else {
      const def = GOAL_DEFS.find((d) => d.metric === metric);
      updated[metric] = { value, unit: def?.unit ?? "", updated_at: new Date().toISOString() };
    }
    notifyGoalsUpdated(updated);
  }

  return (
    <div className="journal-page">
      <Card id="decide.goals-step" as="section" style={{ margin: "1rem 0" }}>
        <CardHeader id="decide.goals-step">Daily step goal</CardHeader>
        <div className="overview-card-body">
          <div className="overview-stat">
            <span className="stat-label">Target</span>
            <span className="big-number">
              {stepGoal != null ? stepGoal.toLocaleString() : "--"}
            </span>
          </div>
          <p style={{ opacity: 0.6, fontSize: "0.85em", margin: "0.5rem 0 0" }}>
            Source: Garmin device setting. Edit on the device itself.
          </p>
        </div>
      </Card>

      <Card id="decide.goals-health" as="section" style={{ margin: "1rem 0" }}>
        <CardHeader id="decide.goals-health">Health goals</CardHeader>
        <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "0 0 0.75rem" }}>
          Placeholders are your 90-day averages. Set a goal to see it as a reference line in Trends charts and on today's metrics.
        </p>
        {GOAL_DEFS.map((def) => (
          <GoalCard
            key={def.metric}
            def={def}
            savedValue={savedGoals?.[def.metric]?.value}
            defaultValue={defaults[def.metric]}
            onChange={handleGoalChange}
          />
        ))}
      </Card>
    </div>
  );
}
