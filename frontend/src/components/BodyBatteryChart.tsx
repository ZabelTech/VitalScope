import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { Card, CardHeader } from "./Card";
import { MetricCards } from "./MetricCards";
import type { BodyBatteryDaily, StatValues } from "../types";

interface Props { start: string; end: string }

export function BodyBatteryChart({ start, end }: Props) {
  const { data, loading } = useMetricData<BodyBatteryDaily[]>("body-battery/daily", start, end);
  const { data: stats } = useMetricData<{ max_level: StatValues; charged: StatValues }>(
    "body-battery/stats",
    start,
    end,
  );

  if (loading) return <div className="chart-loading">Loading body battery...</div>;

  const chartData = (data ?? []).map((d) => ({
    date: d.date,
    charged: d.charged,
    drained: d.drained != null ? -d.drained : null,
  }));

  return (
    <Card id="orient.chart-body-battery" className="chart-section">
      <CardHeader id="orient.chart-body-battery" level="h2">Body Battery</CardHeader>
      <MetricCards
        items={[
          { label: "Daily Peak", stats: stats?.max_level ?? null },
          { label: "Charge Gained", stats: stats?.charged ?? null },
        ]}
      />
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="charged" name="Charged" fill="#22c55e" />
          <Bar dataKey="drained" name="Drained" fill="#ef4444" />
        </BarChart>
      </ResponsiveContainer></div>
    </Card>
  );
}
