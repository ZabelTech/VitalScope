import { useEffect, useState } from "react";
import type { GarminActivity, Workout, WorkoutDetail } from "../types";
import { apiFetch } from "../api";
import type { CardId } from "../cardInfo";
import { Card, CardHeader } from "./Card";

interface Props {
  activities: GarminActivity[];
  workouts: Workout[];
  title?: string | null;
  maxItems?: number;
  emptyHint?: string;
  cardId: CardId;
}

type MergedItem =
  | { kind: "garmin"; date: string; sortKey: string; data: GarminActivity }
  | { kind: "strong"; date: string; sortKey: string; data: Workout };

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtKm(meters: number | null): string {
  if (meters == null) return "";
  return `${(meters / 1000).toFixed(1)} km`;
}

function SportIcon({ sportType }: { sportType: string | null }) {
  const type = (sportType || "").toLowerCase();
  let icon = "●";
  if (type.includes("run")) icon = "🏃";
  else if (type.includes("bike") || type.includes("cycl")) icon = "🚴";
  else if (type.includes("swim")) icon = "🏊";
  else if (type.includes("walk") || type.includes("hik")) icon = "🚶";
  else if (type.includes("strength") || type.includes("weight")) icon = "🏋";
  else if (type.includes("yoga")) icon = "🧘";
  return <span className="sport-icon">{icon}</span>;
}

function GarminDetail({ activity }: { activity: GarminActivity }) {
  const rows: [string, string][] = [];
  if (activity.distance_m != null) rows.push(["Distance", fmtKm(activity.distance_m)]);
  if (activity.duration_sec != null) rows.push(["Duration", fmtDuration(activity.duration_sec)]);
  if (activity.moving_time_sec != null) rows.push(["Moving time", fmtDuration(activity.moving_time_sec)]);
  if (activity.avg_hr != null) rows.push(["Avg HR", `${activity.avg_hr} bpm`]);
  if (activity.max_hr != null) rows.push(["Max HR", `${activity.max_hr} bpm`]);
  if (activity.calories != null) rows.push(["Calories", `${activity.calories} kcal`]);
  if (activity.elevation_gain_m != null) rows.push(["Elevation gain", `${Math.round(activity.elevation_gain_m)} m`]);
  if (activity.avg_speed_mps != null) {
    const kmh = activity.avg_speed_mps * 3.6;
    rows.push(["Avg speed", `${kmh.toFixed(1)} km/h`]);
  }
  if (activity.avg_power_w != null) rows.push(["Avg power", `${Math.round(activity.avg_power_w)} W`]);
  if (activity.training_effect != null) rows.push(["Training effect", activity.training_effect.toFixed(1)]);

  return (
    <div className="activity-detail">
      <div className="activity-detail-stats">
        {rows.map(([label, val]) => (
          <div key={label} className="detail-stat">
            <span className="detail-label">{label}</span>
            <span className="detail-value">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StrongDetail({ workoutId }: { workoutId: string }) {
  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/workouts/${workoutId}`)
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workoutId]);

  if (loading) return <div className="activity-detail" style={{ color: "#64748b" }}>Loading…</div>;
  if (!detail) return <div className="activity-detail" style={{ color: "#ef4444" }}>Failed to load</div>;

  const grouped: { exercise: string; sets: typeof detail.sets }[] = [];
  for (const s of detail.sets) {
    const last = grouped[grouped.length - 1];
    if (last && last.exercise === s.exercise) {
      last.sets.push(s);
    } else {
      grouped.push({ exercise: s.exercise, sets: [s] });
    }
  }

  return (
    <div className="activity-detail">
      <div className="activity-detail-stats">
        <div className="detail-stat">
          <span className="detail-label">Duration</span>
          <span className="detail-value">{fmtDuration(detail.duration_sec)}</span>
        </div>
        <div className="detail-stat">
          <span className="detail-label">Sets</span>
          <span className="detail-value">{detail.total_sets}</span>
        </div>
        <div className="detail-stat">
          <span className="detail-label">Exercises</span>
          <span className="detail-value">{detail.exercise_count ?? 0}</span>
        </div>
        <div className="detail-stat">
          <span className="detail-label">Volume</span>
          <span className="detail-value">{Math.round(detail.total_volume).toLocaleString()} kg</span>
        </div>
      </div>

      <div className="workout-exercises">
        {grouped.map((g) => {
          let workingIdx = 0;
          return (
            <div key={g.exercise} className="workout-exercise">
              <div className="workout-exercise-name">{g.exercise}</div>
              <div className="workout-sets">
                {g.sets.map((s) => {
                  if (s.set_type === "rest") {
                    return (
                      <div key={s.set_order} className="workout-set workout-set-rest">
                        <span className="rest-label">Rest</span>
                        <span className="rest-dur">{s.seconds}s</span>
                      </div>
                    );
                  }
                  workingIdx += 1;
                  const parts: string[] = [];
                  if (s.weight_kg != null) parts.push(`${s.weight_kg} kg`);
                  if (s.reps != null) parts.push(`${s.reps} reps`);
                  if (s.seconds != null) parts.push(`${s.seconds}s`);
                  return (
                    <div key={s.set_order} className="workout-set">
                      <span className="set-num">#{workingIdx}</span>
                      <span className="set-body">{parts.join(" × ") || "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActivityCard({
  activities,
  workouts,
  title,
  maxItems = 8,
  emptyHint,
  cardId,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const merged: MergedItem[] = [
    ...activities.map((a) => ({
      kind: "garmin" as const,
      date: a.date,
      sortKey: a.start_time || a.date,
      data: a,
    })),
    ...workouts.map((w) => ({
      kind: "strong" as const,
      date: w.date,
      sortKey: w.end_date || w.date,
      data: w,
    })),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  if (merged.length === 0) {
    if (!emptyHint) return null;
    return (
      <Card id={cardId} style={{ marginTop: 20 }}>
        <CardHeader id={cardId}>{title}</CardHeader>
        <div className="overview-card-body">
          <p style={{ opacity: 0.6, margin: 0 }}>{emptyHint}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card id={cardId} style={{ marginTop: 20 }}>
      <CardHeader id={cardId}>{title}</CardHeader>
      <div className="overview-card-body activity-list">
        {merged.slice(0, maxItems).map((item) => {
          const id = item.kind === "garmin"
            ? `g-${item.data.activity_id}`
            : `s-${item.data.id}`;
          const isOpen = expandedId === id;

          let title: string;
          let subtitle: string;
          let right: string;

          if (item.kind === "garmin") {
            const a = item.data;
            title = a.name || a.sport_type || "Activity";
            subtitle = `${a.sport_type || "Activity"} · ${a.date}`;
            right = [fmtKm(a.distance_m), fmtDuration(a.duration_sec)]
              .filter(Boolean).join(" · ") || "--";
          } else {
            const w = item.data;
            title = w.name || "Workout";
            subtitle = `Strength · ${w.date}`;
            right = `${w.exercise_count ?? 0} ex · ${w.total_sets} sets` +
              (w.duration_sec ? ` · ${Math.round(w.duration_sec / 60)}m` : "");
          }

          return (
            <div key={id} className={`activity-row ${isOpen ? "open" : ""}`}>
              <button
                className="activity-row-header"
                onClick={() => setExpandedId(isOpen ? null : id)}
              >
                <SportIcon sportType={item.kind === "garmin" ? item.data.sport_type : "strength"} />
                <div className="activity-row-title">
                  <div className="activity-title">{title}</div>
                  <div className="activity-subtitle">{subtitle}</div>
                </div>
                <div className="activity-row-right">{right}</div>
                <span className={`chevron ${isOpen ? "open" : ""}`}>▾</span>
              </button>
              {isOpen && (
                item.kind === "garmin"
                  ? <GarminDetail activity={item.data} />
                  : <StrongDetail workoutId={item.data.id} />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
