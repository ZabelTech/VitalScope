import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import type { ActivityWeekly, ActivityStats, WeeklyVolume } from "../types";

interface Props { start: string; end: string }

interface WorkoutStats {
  workout_count: number;
  total_sets: number;
  total_volume: number;
  avg_duration_sec: number;
}

interface WeekRow {
  week_start: string;
  garmin_sessions: number;
  strong_sessions: number;
  distance_km: number;
  volume_kg: number;
}

function fmtVolume(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
}

export function TrainingChart({ start, end }: Props) {
  const { data: activitiesWeekly, loading: aLoading } =
    useMetricData<ActivityWeekly[]>("activities/weekly", start, end);
  const { data: activityStats } =
    useMetricData<ActivityStats>("activities/stats", start, end);
  const { data: workoutWeekly, loading: wLoading } =
    useMetricData<WeeklyVolume[]>("workouts/weekly-volume", start, end);
  const { data: workoutStats } =
    useMetricData<WorkoutStats>("workouts/stats", start, end);

  const loading = aLoading || wLoading;
  if (loading) return <div className="chart-loading">Loading training...</div>;

  // Merge by week_start into a single time series
  const byWeek = new Map<string, WeekRow>();

  const ensure = (weekStart: string): WeekRow => {
    let row = byWeek.get(weekStart);
    if (!row) {
      row = {
        week_start: weekStart,
        garmin_sessions: 0,
        strong_sessions: 0,
        distance_km: 0,
        volume_kg: 0,
      };
      byWeek.set(weekStart, row);
    }
    return row;
  };

  for (const w of activitiesWeekly ?? []) {
    const row = ensure(w.week_start);
    row.garmin_sessions = w.sessions ?? 0;
    row.distance_km = w.distance_m != null ? +(w.distance_m / 1000).toFixed(2) : 0;
  }
  for (const w of workoutWeekly ?? []) {
    const row = ensure(w.week_start);
    row.strong_sessions = w.sessions ?? 0;
    row.volume_kg = w.volume ?? 0;
  }

  const items = Array.from(byWeek.values()).sort((a, b) =>
    a.week_start.localeCompare(b.week_start),
  );

  if (items.length === 0) {
    return (
      <div className="chart-section">
        <h2>Training</h2>
        <div style={{ color: "#64748b", padding: "20px 0" }}>
          No training data yet for this range.
        </div>
      </div>
    );
  }

  const garminSessions = activityStats?.activity_count ?? 0;
  const strongSessions = workoutStats?.workout_count ?? 0;
  const totalSessions = garminSessions + strongSessions;

  const totalKm = activityStats?.total_distance_m != null
    ? (activityStats.total_distance_m / 1000).toFixed(1) : "--";
  const totalHours = activityStats?.total_duration_sec != null
    ? (activityStats.total_duration_sec / 3600).toFixed(1) : "--";
  const totalElev = activityStats?.total_elevation_m != null
    ? Math.round(activityStats.total_elevation_m) : "--";

  return (
    <div className="chart-section">
      <h2>Training</h2>
      <div className="metric-cards" style={{ marginBottom: 16 }}>
        <div className="metric-card">
          <div className="metric-card-label">Total Sessions</div>
          <div className="metric-card-value">
            {totalSessions}
            <span className="metric-card-unit">
              {" "}({garminSessions} garmin · {strongSessions} strong)
            </span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Distance</div>
          <div className="metric-card-value">{totalKm}<span className="metric-card-unit"> km</span></div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Moving Time</div>
          <div className="metric-card-value">{totalHours}<span className="metric-card-unit"> h</span></div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Elevation</div>
          <div className="metric-card-value">{totalElev}<span className="metric-card-unit"> m</span></div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Strength Sets</div>
          <div className="metric-card-value">{workoutStats?.total_sets ?? "--"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Strength Volume</div>
          <div className="metric-card-value">
            {workoutStats?.total_volume != null ? `${fmtVolume(workoutStats.total_volume)}` : "--"}
            <span className="metric-card-unit"> kg</span>
          </div>
        </div>
      </div>

      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={items}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week_start" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="sessions" label={{ value: "Sessions", angle: -90, position: "insideLeft", style: { fill: "#64748b", fontSize: 11 } }} />
          <YAxis yAxisId="km" orientation="right" label={{ value: "km", angle: 90, position: "insideRight", style: { fill: "#64748b", fontSize: 11 } }} />
          <Tooltip />
          <Legend />
          <Bar  yAxisId="sessions" dataKey="garmin_sessions" name="Garmin" stackId="sessions" fill="#3b82f6" />
          <Bar  yAxisId="sessions" dataKey="strong_sessions" name="Strong"  stackId="sessions" fill="#8b5cf6" />
          <Line yAxisId="km"       type="monotone" dataKey="distance_km" name="Distance (km)" stroke="#22c55e" dot={false} />
        </ComposedChart>
      </ResponsiveContainer></div>
    </div>
  );
}
