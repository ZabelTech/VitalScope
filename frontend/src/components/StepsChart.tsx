import {
  Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { MetricCards } from "./MetricCards";
import type { StepsDaily, StatValues } from "../types";

interface Props { start: string; end: string }

export function StepsChart({ start, end }: Props) {
  const { data, loading } = useMetricData<StepsDaily[]>("steps/daily", start, end);
  const { data: stats } = useMetricData<{ total_steps: StatValues }>("steps/stats", start, end);

  if (loading) return <div className="chart-loading">Loading steps...</div>;

  return (
    <div className="chart-section">
      <h2>Steps</h2>
      <MetricCards items={[{ label: "Daily Steps", stats: stats?.total_steps ?? null }]} />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data ?? []}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar  dataKey="total_steps" name="Steps" fill="#3b82f6" />
          <Line type="monotone" dataKey="step_goal" name="Goal" stroke="#ef4444" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
