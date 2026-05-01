import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts";
import { useGoals } from "../hooks/useGoals";
import { useMetricData } from "../hooks/useMetricData";
import { Card, CardHeader } from "./Card";
import { MetricCards } from "./MetricCards";
import type { HrvDaily, StatValues } from "../types";

interface Props { start: string; end: string }

export function HrvChart({ start, end }: Props) {
  const { data, loading } = useMetricData<HrvDaily[]>("hrv/daily", start, end);
  const { data: stats } = useMetricData<{ weekly_avg: StatValues }>("hrv/stats", start, end);
  const goals = useGoals();
  const hrvGoal = goals?.hrv?.value ?? null;

  if (loading) return <div className="chart-loading">Loading HRV...</div>;

  const items = data ?? [];
  const baselineLow = items[0]?.baseline_low_upper;
  const baselineHigh = items[0]?.baseline_balanced_upper;

  return (
    <Card id="orient.chart-hrv" className="chart-section">
      <CardHeader id="orient.chart-hrv" level="h2">Heart Rate Variability</CardHeader>
      <MetricCards items={[{ label: "Weekly Avg HRV", stats: stats?.weekly_avg ?? null, unit: " ms" }]} />
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={items}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={["auto", "auto"]} />
          <Tooltip />
          <Legend />
          {baselineLow != null && baselineHigh != null && (
            <ReferenceArea y1={baselineLow} y2={baselineHigh} fill="#3b82f6" fillOpacity={0.1} label="Baseline" />
          )}
          {hrvGoal != null && (
            <ReferenceLine y={hrvGoal} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: `Goal ≥${hrvGoal}`, fill: "#f59e0b", fontSize: 11 }} />
          )}
          <Line type="monotone" dataKey="weekly_avg" name="Weekly Avg" stroke="#8b5cf6" dot={false} connectNulls />
          <Line type="monotone" dataKey="last_night_avg" name="Last Night" stroke="#a78bfa" dot={false} connectNulls strokeDasharray="4 4" />
        </LineChart>
      </ResponsiveContainer></div>
    </Card>
  );
}
