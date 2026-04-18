import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { MetricCards } from "./MetricCards";
import type { BodyBatteryDaily, StatValues } from "../types";

interface Props { start: string; end: string }

export function BodyBatteryChart({ start, end }: Props) {
  const { data, loading } = useMetricData<BodyBatteryDaily[]>("body-battery/daily", start, end);
  const { data: stats } = useMetricData<{ charged: StatValues }>("body-battery/stats", start, end);

  if (loading) return <div className="chart-loading">Loading body battery...</div>;

  const chartData = (data ?? []).map((d) => ({
    date: d.date,
    charged: d.charged,
    drained: d.drained != null ? -d.drained : null,
  }));

  return (
    <div className="chart-section">
      <h2>Body Battery</h2>
      <MetricCards items={[{ label: "Charged", stats: stats?.charged ?? null }]} />
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="charged" name="Charged" fill="#22c55e" />
          <Bar dataKey="drained" name="Drained" fill="#ef4444" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
