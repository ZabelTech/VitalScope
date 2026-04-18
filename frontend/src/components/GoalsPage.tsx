import { format } from "date-fns";
import { useMetricData } from "../hooks/useMetricData";
import type { StepsDaily } from "../types";

const today = format(new Date(), "yyyy-MM-dd");

const PLACEHOLDERS = [
  "Sleep duration target",
  "HRV baseline",
  "Resting heart rate target",
  "Body weight target",
  "Daily calorie target",
  "Macro targets (protein / carbs / fat)",
];

export function GoalsPage() {
  const { data: stepsData } = useMetricData<StepsDaily[]>("steps/daily", today, today);
  const stepGoal = stepsData?.[0]?.step_goal ?? null;

  return (
    <div className="journal-page">
      <section className="overview-card" style={{ margin: "1rem 0" }}>
        <h3>Daily step goal</h3>
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
      </section>

      <section className="overview-card" style={{ margin: "1rem 0", opacity: 0.6 }}>
        <h3>Planned goals</h3>
        <div className="overview-card-body">
          <ul style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.8 }}>
            {PLACEHOLDERS.map((p) => (
              <li key={p}>{p} — coming soon</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
