import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { MetricCards } from "./MetricCards";
import type { SleepDaily, StatValues } from "../types";

interface Props { start: string; end: string }

function toHours(sec: number | null): number | null {
  return sec != null ? Math.round((sec / 3600) * 10) / 10 : null;
}

export function SleepChart({ start, end }: Props) {
  const { data, loading } = useMetricData<SleepDaily[]>("sleep/daily", start, end);
  const { data: stats } = useMetricData<{ sleep_score: StatValues; sleep_hours: StatValues }>("sleep/stats", start, end);

  if (loading) return <div className="chart-loading">Loading sleep...</div>;

  const chartData = (data ?? []).map((d) => ({
    date: d.date,
    deep: toHours(d.deep_sleep_seconds),
    light: toHours(d.light_sleep_seconds),
    rem: toHours(d.rem_sleep_seconds),
    awake: toHours(d.awake_seconds),
    score: d.sleep_score,
  }));

  return (
    <div className="chart-section">
      <h2>Sleep</h2>
      <MetricCards items={[
        { label: "Sleep Score", stats: stats?.sleep_score ?? null },
        { label: "Sleep Duration", stats: stats?.sleep_hours ?? null, unit: " hrs", decimals: 1 },
      ]} />
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="hours" label={{ value: "Hours", angle: -90, position: "insideLeft" }} />
          <YAxis yAxisId="score" orientation="right" domain={[0, 100]} label={{ value: "Score", angle: 90, position: "insideRight" }} />
          <Tooltip />
          <Legend />
          <Bar yAxisId="hours" dataKey="deep" name="Deep" stackId="sleep" fill="#1e3a5f" />
          <Bar yAxisId="hours" dataKey="light" name="Light" stackId="sleep" fill="#60a5fa" />
          <Bar yAxisId="hours" dataKey="rem" name="REM" stackId="sleep" fill="#a78bfa" />
          <Bar yAxisId="hours" dataKey="awake" name="Awake" stackId="sleep" fill="#fbbf24" />
          <Line yAxisId="score" type="monotone" dataKey="score" name="Score" stroke="#ef4444" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer></div>
    </div>
  );
}
