import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { MetricCards } from "./MetricCards";
import type { WeightDaily, StatValues } from "../types";

interface Props { start: string; end: string }

type WeightStats = {
  weight_kg: StatValues;
  bmi: StatValues;
  body_fat_pct: StatValues;
  water_pct: StatValues;
};

export function WeightChart({ start, end }: Props) {
  const { data, loading } = useMetricData<WeightDaily[]>("weight/daily", start, end);
  const { data: stats } = useMetricData<WeightStats>("weight/stats", start, end);

  if (loading) return <div className="chart-loading">Loading body composition...</div>;

  return (
    <div className="chart-section">
      <h2>Body Composition</h2>
      <MetricCards
        items={[
          { label: "Weight", stats: stats?.weight_kg ?? null, unit: " kg", decimals: 1 },
          { label: "BMI", stats: stats?.bmi ?? null, decimals: 1 },
          { label: "Body Fat", stats: stats?.body_fat_pct ?? null, unit: "%", decimals: 1 },
          { label: "Water", stats: stats?.water_pct ?? null, unit: "%", decimals: 1 },
        ]}
      />
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data ?? []}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="kg" domain={["auto", "auto"]} label={{ value: "kg", angle: -90, position: "insideLeft" }} />
          <YAxis yAxisId="pct" orientation="right" domain={["auto", "auto"]} label={{ value: "% / BMI", angle: 90, position: "insideRight" }} />
          <Tooltip />
          <Legend />
          <Line yAxisId="kg"  type="monotone" dataKey="weight_kg"    name="Weight (kg)" stroke="#3b82f6" dot={false} connectNulls />
          <Line yAxisId="pct" type="monotone" dataKey="bmi"          name="BMI"          stroke="#8b5cf6" dot={false} connectNulls />
          <Line yAxisId="pct" type="monotone" dataKey="body_fat_pct" name="Body Fat %"   stroke="#ef4444" dot={false} connectNulls />
          <Line yAxisId="pct" type="monotone" dataKey="water_pct"    name="Water %"      stroke="#22c55e" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
