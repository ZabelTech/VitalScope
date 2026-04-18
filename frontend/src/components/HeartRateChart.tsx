import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { MetricCards } from "./MetricCards";
import type { HeartRateDaily, StatValues } from "../types";

interface Props { start: string; end: string }

export function HeartRateChart({ start, end }: Props) {
  const { data, loading } = useMetricData<HeartRateDaily[]>("heart-rate/daily", start, end);
  const { data: stats } = useMetricData<{ resting_hr: StatValues }>("heart-rate/stats", start, end);

  if (loading) return <div className="chart-loading">Loading heart rate...</div>;

  return (
    <div className="chart-section">
      <h2>Heart Rate</h2>
      <MetricCards items={[{ label: "Resting HR", stats: stats?.resting_hr ?? null, unit: " bpm" }]} />
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data ?? []}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={["auto", "auto"]} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="resting_hr" name="Resting" stroke="#3b82f6" dot={false} connectNulls />
          <Line type="monotone" dataKey="min_hr" name="Min" stroke="#22c55e" dot={false} connectNulls />
          <Line type="monotone" dataKey="max_hr" name="Max" stroke="#ef4444" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
