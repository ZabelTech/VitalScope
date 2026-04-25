import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { listBodyCompositionEstimates } from "../api";
import { useMetricData } from "../hooks/useMetricData";
import { MetricCards } from "./MetricCards";
import type { BodyCompositionEstimate, WeightDaily, StatValues } from "../types";

interface Props { start: string; end: string }

type WeightStats = {
  weight_kg: StatValues;
  bmi: StatValues;
  body_fat_pct: StatValues;
  water_pct: StatValues;
};

type ChartRow = {
  date: string;
  weight_kg: number | null;
  bmi: number | null;
  body_fat_pct: number | null;
  water_pct: number | null;
  ai_body_fat_pct?: number | null;
};

export function WeightChart({ start, end }: Props) {
  const { data, loading } = useMetricData<WeightDaily[]>("weight/daily", start, end);
  const { data: stats } = useMetricData<WeightStats>("weight/stats", start, end);
  const [showAiBodyFat, setShowAiBodyFat] = useState(false);
  const [estimates, setEstimates] = useState<BodyCompositionEstimate[]>([]);

  useEffect(() => {
    if (!showAiBodyFat) return;
    listBodyCompositionEstimates(start, end).then(setEstimates).catch(() => {});
  }, [showAiBodyFat, start, end]);

  const chartData = useMemo((): ChartRow[] => {
    if (!showAiBodyFat || estimates.length === 0) return (data ?? []) as ChartRow[];
    const byDate = new Map<string, ChartRow>();
    for (const d of (data ?? [])) byDate.set(d.date, { ...d });
    for (const e of estimates) {
      if (e.body_fat_pct == null) continue;
      const row = byDate.get(e.date);
      if (row) {
        row.ai_body_fat_pct = e.body_fat_pct;
      } else {
        byDate.set(e.date, {
          date: e.date,
          weight_kg: null,
          bmi: null,
          body_fat_pct: null,
          water_pct: null,
          ai_body_fat_pct: e.body_fat_pct,
        });
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [data, showAiBodyFat, estimates]);

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
      <div style={{ marginBottom: 8 }}>
        <button
          className={`chip${showAiBodyFat ? " chip-active" : ""}`}
          onClick={() => setShowAiBodyFat((v) => !v)}
        >
          AI body fat %
        </button>
      </div>
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="kg" domain={["auto", "auto"]} label={{ value: "kg", angle: -90, position: "insideLeft" }} />
          <YAxis yAxisId="pct" orientation="right" domain={["auto", "auto"]} label={{ value: "% / BMI", angle: 90, position: "insideRight" }} />
          <Tooltip />
          <Legend />
          <Line yAxisId="kg"  type="monotone" dataKey="weight_kg"       name="Weight (kg)" stroke="#3b82f6" dot={false} connectNulls />
          <Line yAxisId="pct" type="monotone" dataKey="bmi"             name="BMI"          stroke="#8b5cf6" dot={false} connectNulls />
          <Line yAxisId="pct" type="monotone" dataKey="body_fat_pct"    name="Body Fat %"   stroke="#ef4444" dot={false} connectNulls />
          <Line yAxisId="pct" type="monotone" dataKey="water_pct"       name="Water %"      stroke="#22c55e" dot={false} connectNulls />
          {showAiBodyFat && (
            <Line yAxisId="pct" type="monotone" dataKey="ai_body_fat_pct" name="AI Body Fat %" stroke="#a78bfa" dot strokeDasharray="4 2" connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer></div>
    </div>
  );
}
