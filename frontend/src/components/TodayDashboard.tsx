import { format, subDays } from "date-fns";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  apiFetch,
  fetchNutritionDaily,
  fetchScheduledProtocols,
  fetchWaterDaily,
  saveProtocolAdherence,
} from "../api";
import { useMetricData } from "../hooks/useMetricData";
import type {
  GarminActivity,
  NutritionDailyTotals,
  ProtocolTimeOfDay,
  ScheduledProtocol,
  StepsDaily,
  WaterDaily,
  Workout,
} from "../types";
import { ActivityCard } from "./ActivityCard";
import { Card, CardHeader } from "./Card";

const today = format(new Date(), "yyyy-MM-dd");

function fmtAge(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return "";
  if (isoOrDate.length === 10) {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    if (isoOrDate >= todayStr) return "today";
    const yest = format(subDays(new Date(), 1), "yyyy-MM-dd");
    if (isoOrDate === yest) return "yesterday";
    return isoOrDate;
  }
  return isoOrDate.slice(0, 10);
}

function AgeBadge({ at }: { at: string | null | undefined }) {
  const text = fmtAge(at);
  if (!text) return null;
  return <span className="card-age">{text}</span>;
}

export function TodayDashboard() {
  const { data: stepsData, loading: stepsLoading } = useMetricData<StepsDaily[]>(
    "steps/daily",
    today,
    today,
  );
  const steps = stepsData?.[0] ?? null;

  const [todayWorkouts, setTodayWorkouts] = useState<Workout[]>([]);
  useEffect(() => {
    apiFetch("/api/workouts/recent?limit=20")
      .then((r) => r.json())
      .then((rows: Workout[]) => setTodayWorkouts(rows.filter((w) => w.date === today)))
      .catch(() => {});
  }, []);

  const [todayActivities, setTodayActivities] = useState<GarminActivity[]>([]);
  useEffect(() => {
    apiFetch(`/api/activities?start=${today}&end=${today}`)
      .then((r) => r.json())
      .then(setTodayActivities)
      .catch(() => {});
  }, []);

  const [nutritionToday, setNutritionToday] = useState<NutritionDailyTotals | null>(null);
  const [waterToday, setWaterToday] = useState<WaterDaily | null>(null);
  useEffect(() => {
    fetchNutritionDaily(today, today)
      .then((rows) => setNutritionToday(rows[0] ?? null))
      .catch(() => {});
    fetchWaterDaily(today, today)
      .then((rows) => setWaterToday(rows[0] ?? null))
      .catch(() => {});
  }, []);

  const [scheduledProtocols, setScheduledProtocols] = useState<ScheduledProtocol[]>([]);
  const [protocolSaving, setProtocolSaving] = useState(false);
  useEffect(() => {
    fetchScheduledProtocols(today)
      .then(setScheduledProtocols)
      .catch(() => {});
  }, []);

  async function toggleProtocol(p: ScheduledProtocol) {
    const next = !p.taken;
    setScheduledProtocols((prev) =>
      prev.map((row) => (row.id === p.id ? { ...row, taken: next } : row))
    );
    setProtocolSaving(true);
    try {
      await saveProtocolAdherence(today, {
        protocol_id: p.id,
        time_of_day: (p.time_of_day ?? null) as ProtocolTimeOfDay | null,
        taken: next,
      });
    } catch {
      setScheduledProtocols((prev) =>
        prev.map((row) => (row.id === p.id ? { ...row, taken: !next } : row))
      );
    } finally {
      setProtocolSaving(false);
    }
  }

  if (stepsLoading) return <div className="chart-loading">Loading today...</div>;

  return (
    <div className="overview">
      <div className="quick-actions">
        <Link to="/observe#journal" className="quick-action">Journal</Link>
        <Link to="/act#intake" className="quick-action">Log intake</Link>
        <Link to="/observe#metrics" className="quick-action">See metrics</Link>
      </div>

      <div className="overview-grid-bottom">
        <Card id="today.steps">
          <CardHeader id="today.steps">
            Steps
            <AgeBadge at={steps?.date} />
          </CardHeader>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Today</span>
              <span className="big-number">
                {steps?.total_steps != null ? steps.total_steps.toLocaleString() : "--"}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Goal</span>
              <span className="stat-value">
                {steps?.step_goal != null ? steps.step_goal.toLocaleString() : "--"}
                {steps?.total_steps != null && steps?.step_goal
                  ? ` (${Math.round((steps.total_steps / steps.step_goal) * 100)}%)`
                  : ""}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Distance</span>
              <span className="stat-value">
                {steps?.total_distance_m != null
                  ? `${(steps.total_distance_m / 1000).toFixed(2)} km`
                  : "--"}
              </span>
            </div>
          </div>
        </Card>

        <Card id="today.nutrition-summary">
          <CardHeader id="today.nutrition-summary">
            Nutrition
            <AgeBadge at={today} />
          </CardHeader>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Calories</span>
              <span className="big-number">
                {nutritionToday?.totals.calories_kcal != null
                  ? Math.round(nutritionToday.totals.calories_kcal)
                  : "--"}
                <span className="stat-unit">kcal</span>
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Protein</span>
              <span className="stat-value">
                {nutritionToday?.totals.protein_g != null
                  ? `${Math.round(nutritionToday.totals.protein_g)} g`
                  : "--"}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Carbs</span>
              <span className="stat-value">
                {nutritionToday?.totals.carbs_g != null
                  ? `${Math.round(nutritionToday.totals.carbs_g)} g`
                  : "--"}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Fat</span>
              <span className="stat-value">
                {nutritionToday?.totals.fat_g != null
                  ? `${Math.round(nutritionToday.totals.fat_g)} g`
                  : "--"}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Water</span>
              <span className="stat-value">
                {waterToday?.total_ml != null ? `${waterToday.total_ml} ml` : "--"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {scheduledProtocols.length > 0 && (
        <Card id="today.protocols-scheduled">
          <CardHeader id="today.protocols-scheduled">
            Protocols scheduled today
            <AgeBadge at={today} />
          </CardHeader>
          <div className="overview-card-body" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            {(["morning", "noon", "evening", null] as (ProtocolTimeOfDay | null)[]).map((slot) => {
              const items = scheduledProtocols.filter(
                (p) => (p.time_of_day ?? null) === slot
              );
              if (items.length === 0) return null;
              const slotLabel =
                slot === null
                  ? "Anytime"
                  : slot.charAt(0).toUpperCase() + slot.slice(1);
              return (
                <div key={slot ?? "anytime"} className="journal-supplement-group">
                  <span className="stat-label">{slotLabel}</span>
                  {items.map((p) => (
                    <label key={p.id} className="journal-radio">
                      <input
                        type="checkbox"
                        checked={p.taken}
                        onChange={() => toggleProtocol(p)}
                        disabled={protocolSaving}
                      />
                      {p.name}
                      {(p.dose || p.unit) && (
                        <span className="supplement-dosage">
                          {" "}
                          ({[p.dose, p.unit].filter(Boolean).join(" ")})
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <ActivityCard
        cardId="today.activity"
        activities={todayActivities}
        workouts={todayWorkouts}
        title="Today's activity"
        emptyHint="No activity logged today yet."
      />
    </div>
  );
}
