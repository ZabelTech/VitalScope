import { useEffect, useState } from "react";
import {
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { fetchNutritionDaily, fetchWaterDaily } from "../api";
import { MetricCards } from "./MetricCards";
import type { NutritionDailyTotals, StatValues, WaterDaily } from "../types";

interface Props {
  start: string;
  end: string;
}

function computeStats(values: number[]): StatValues {
  if (values.length === 0) {
    return { min: null, max: null, avg: null, median: null, volatility: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance =
    values.length > 1
      ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
      : 0;
  return {
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
    avg: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    volatility: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

export function NutritionChart({ start, end }: Props) {
  const [nutrition, setNutrition] = useState<NutritionDailyTotals[] | null>(null);
  const [water, setWater] = useState<WaterDaily[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchNutritionDaily(start, end), fetchWaterDaily(start, end)])
      .then(([n, w]) => {
        if (cancelled) return;
        setNutrition(n);
        setWater(w);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  if (loading) return <div className="chart-loading">Loading nutrition...</div>;

  const waterByDate = new Map((water ?? []).map((w) => [w.date, w.total_ml]));
  const dates = Array.from(
    new Set([...(nutrition ?? []).map((n) => n.date), ...(water ?? []).map((w) => w.date)])
  ).sort();

  const chartData = dates.map((d) => {
    const row = (nutrition ?? []).find((n) => n.date === d);
    const t = row?.totals ?? {};
    return {
      date: d,
      calories_kcal: t["calories_kcal"] ?? null,
      protein_g: t["protein_g"] ?? null,
      carbs_g: t["carbs_g"] ?? null,
      fat_g: t["fat_g"] ?? null,
      water_ml: waterByDate.get(d) ?? null,
    };
  });

  const pluck = (key: keyof (typeof chartData)[number]): number[] =>
    chartData
      .map((r) => r[key] as number | null)
      .filter((v): v is number => v != null);

  const stats = {
    calories: computeStats(pluck("calories_kcal")),
    protein: computeStats(pluck("protein_g")),
    carbs: computeStats(pluck("carbs_g")),
    fat: computeStats(pluck("fat_g")),
    water: computeStats(pluck("water_ml")),
  };

  return (
    <div className="chart-section">
      <h2>Nutrition</h2>
      <MetricCards
        items={[
          { label: "Calories", stats: stats.calories, unit: "kcal" },
          { label: "Protein", stats: stats.protein, unit: "g" },
          { label: "Carbs", stats: stats.carbs, unit: "g" },
          { label: "Fat", stats: stats.fat, unit: "g" },
          { label: "Water", stats: stats.water, unit: "ml" },
        ]}
      />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" />
          <Tooltip />
          <Legend />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="calories_kcal"
            name="Calories"
            stroke="#3b82f6"
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="water_ml"
            name="Water (ml)"
            stroke="#22c55e"
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
