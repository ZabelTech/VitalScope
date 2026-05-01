import { useEffect, useState } from "react";
import { fetchMetric, fetchPlanned } from "../api";
import type { GarminActivity, PlannedActivity, StepsDaily } from "../types";
import { Card, CardHeader } from "./Card";

interface Props {
  date: string;
}

function fmtKm(m: number | null | undefined): string {
  if (m == null) return "";
  return `${(m / 1000).toFixed(1)} km`;
}

function fmtMin(s: number | null | undefined): string {
  if (s == null) return "";
  return `${Math.round(s / 60)} min`;
}

export function AutoTickedToday({ date }: Props) {
  const [planned, setPlanned] = useState<PlannedActivity[]>([]);
  const [actual, setActual] = useState<GarminActivity[]>([]);
  const [steps, setSteps] = useState<StepsDaily | null>(null);

  useEffect(() => {
    Promise.all([
      fetchPlanned(date, date).catch(() => [] as PlannedActivity[]),
      fetchMetric<GarminActivity[]>("activities", date, date).catch(() => []),
      fetchMetric<StepsDaily[]>("steps/daily", date, date).catch(() => [] as StepsDaily[]),
    ]).then(([p, a, s]) => {
      setPlanned(p);
      setActual(a);
      setSteps(s[0] ?? null);
    });
  }, [date]);

  const stepGoal = steps?.step_goal ?? 10000;
  const stepsDone = steps?.total_steps ?? 0;
  const stepsMet = stepsDone >= stepGoal;
  const stepsPct = stepGoal ? Math.min(100, Math.round((stepsDone / stepGoal) * 100)) : 0;

  // Match planned → actual by sport_type. Mark a planned row "done" if at
  // least one actual activity today shares the sport_type.
  const actualSports = new Set(actual.map((a) => a.sport_type).filter(Boolean));

  const unplannedActuals = actual.filter(
    (a) => !planned.some((p) => p.sport_type === a.sport_type)
  );

  return (
    <Card id="act.auto-ticked" className="overview-card auto-ticked">
      <CardHeader id="act.auto-ticked" />
      <div className="checklist-row">
        <span className={`tick ${stepsMet ? "tick-on" : ""}`} aria-hidden="true">
          {stepsMet ? "✓" : "◯"}
        </span>
        <div className="checklist-body">
          <div className="checklist-title">Steps</div>
          <div className="checklist-sub">
            {stepsDone.toLocaleString()} / {stepGoal.toLocaleString()}
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${stepsPct}%` }} />
          </div>
        </div>
      </div>

      {planned.length === 0 && actual.length === 0 && (
        <p className="journal-hint">No planned or recorded activity today.</p>
      )}

      {planned.map((p) => {
        const done = actualSports.has(p.sport_type);
        return (
          <div key={p.id} className="checklist-row">
            <span className={`tick ${done ? "tick-on" : ""}`} aria-hidden="true">
              {done ? "✓" : "◯"}
            </span>
            <div className="checklist-body">
              <div className="checklist-title">{p.sport_type.replace(/_/g, " ")}</div>
              <div className="checklist-sub">
                {[fmtKm(p.target_distance_m), fmtMin(p.target_duration_sec)]
                  .filter(Boolean)
                  .join(" · ") || p.notes || "planned"}
              </div>
            </div>
          </div>
        );
      })}

      {unplannedActuals.map((a) => (
        <div key={a.activity_id} className="checklist-row">
          <span className="tick tick-on" aria-hidden="true">✓</span>
          <div className="checklist-body">
            <div className="checklist-title">
              {(a.sport_type ?? "activity").replace(/_/g, " ")}
              <span className="journal-hint"> (unplanned)</span>
            </div>
            <div className="checklist-sub">
              {[fmtKm(a.distance_m), fmtMin(a.duration_sec)].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}
