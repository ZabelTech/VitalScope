import {
  ComposedChart,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import { Card, CardHeader } from "./Card";
import { MetricCards } from "./MetricCards";
import type { GlucoseDaily, StatValues } from "../types";

interface Props { start: string; end: string }

interface GlucoseStats {
  avg_mgdl: StatValues;
  tir_pct: StatValues;
  cv_percent: StatValues;
}

export function GlucoseChart({ start, end }: Props) {
  const { data, loading } = useMetricData<GlucoseDaily[]>("glucose/daily", start, end);
  const { data: stats } = useMetricData<GlucoseStats>("glucose/stats", start, end);

  if (loading) return <div className="chart-loading">Loading glucose...</div>;
  if (!data || data.length === 0) return null;

  return (
    <Card id="orient.chart-glucose" className="chart-section">
      <CardHeader id="orient.chart-glucose" level="h2">Glucose</CardHeader>
      <MetricCards
        items={[
          { label: "Avg Glucose", stats: stats?.avg_mgdl ?? null, unit: " mg/dL", decimals: 0 },
          { label: "Time in Range", stats: stats?.tir_pct ?? null, unit: "%" },
          { label: "CV", stats: stats?.cv_percent ?? null, unit: "%" },
        ]}
      />
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={[40, 280]} tick={{ fontSize: 11 }} unit=" mg/dL" width={72} />
            <Tooltip formatter={(v) => [`${v} mg/dL`]} />
            <Legend />
            {/* Target range band: 70–180 mg/dL */}
            <ReferenceArea y1={70} y2={180} fill="#22c55e" fillOpacity={0.06} />
            <Line
              type="monotone"
              dataKey="avg_mgdl"
              name="Avg"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="min_mgdl"
              name="Min"
              stroke="#22c55e"
              strokeDasharray="3 3"
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="max_mgdl"
              name="Max"
              stroke="#ef4444"
              strokeDasharray="3 3"
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
