import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { MetricCards } from "./MetricCards";
import type { StressDaily, StatValues } from "../types";

interface Props { start: string; end: string }

export function StressChart({ start, end }: Props) {
  const { data, loading } = useMetricData<StressDaily[]>("stress/daily", start, end);
  const { data: stats } = useMetricData<{ avg_stress: StatValues }>("stress/stats", start, end);

  if (loading) return <div className="chart-loading">Loading stress...</div>;

  return (
    <div className="chart-section">
      <h2>Stress</h2>
      <MetricCards items={[{ label: "Avg Stress", stats: stats?.avg_stress ?? null }]} />
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data ?? []}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} />
          <Tooltip />
          <Legend />
          <Area type="monotone" dataKey="avg_stress" name="Avg Stress" fill="#f97316" fillOpacity={0.3} stroke="#f97316" connectNulls />
          <Area type="monotone" dataKey="max_stress" name="Max Stress" fill="none" stroke="#ef4444" connectNulls />
        </AreaChart>
      </ResponsiveContainer></div>
    </div>
  );
}
