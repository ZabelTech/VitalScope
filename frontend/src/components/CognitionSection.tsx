import { useState } from "react";
import { format, subDays } from "date-fns";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Scatter, ScatterChart, ZAxis, Area,
} from "recharts";
import { DateRangePicker } from "./DateRangePicker";
import { useMetricData } from "../hooks/useMetricData";
import type { CognitionDaily, ProcessingSpeedDaily, SleepDaily } from "../types";

const today = format(new Date(), "yyyy-MM-dd");
const ninetyDaysAgo = format(subDays(new Date(), 90), "yyyy-MM-dd");

type CorrelationMetric = "deep_sleep_min" | "avg_rt_ms";

const CORRELATION_LABELS: Record<CorrelationMetric, string> = {
  deep_sleep_min: "Deep sleep (min)",
  avg_rt_ms: "Reaction time (ms)",
};

export function CognitionSection() {
  const [start, setStart] = useState(ninetyDaysAgo);
  const [end, setEnd] = useState(today);
  const [corrMetric, setCorrMetric] = useState<CorrelationMetric>("deep_sleep_min");

  const { data: cognition, loading } = useMetricData<CognitionDaily[]>(
    "journal/cognition", start, end
  );
  const { data: processing } = useMetricData<ProcessingSpeedDaily[]>("cognition/processing-speed/daily", start, end);
  const { data: sleep } = useMetricData<SleepDaily[]>("sleep/daily", start, end);

  if (loading) return <div className="chart-loading">Loading cognition data…</div>;

  const hasCognitionData = (cognition ?? []).some(
    (d) => d.focus !== null || d.cognitive_load !== null || d.subjective_energy !== null
  );

  if (!hasCognitionData) {
    return (
      <div className="chart-section">
        <h2>Cognition</h2>
        <p className="chart-empty">
          No cognition data yet. Log focus, mood, and energy in today's journal to see trends here.
        </p>
      </div>
    );
  }

  const trendData = (cognition ?? []).map((d) => ({
    date: d.date,
    focus: d.focus,
    cognitive_load: d.cognitive_load,
    subjective_energy: d.subjective_energy,
  }));

  const sleepByDate = Object.fromEntries(
    (sleep ?? []).map((s) => [s.date, s])
  );

  const corrData = (cognition ?? [])
    .filter((d): d is CognitionDaily & { focus: number } => d.focus !== null)
    .map((d) => {
      const s = sleepByDate[d.date];
      let y: number | null = null;
      if (corrMetric === "deep_sleep_min" && s?.deep_sleep_seconds != null) {
        y = Math.round(s.deep_sleep_seconds / 60);
      } else if (corrMetric === "avg_rt_ms" && d.avg_rt_ms != null) {
        y = Math.round(d.avg_rt_ms);
      }
      return y !== null ? { focus: d.focus, y, date: d.date } : null;
    })
    .filter((p): p is { focus: number; y: number; date: string } => p !== null);

  return (
    <div className="chart-section">
      <h2>Cognition</h2>
      <div className="trends-header">
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
      </div>

      <h3 className="chart-subhead">Trends</h3>
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={trendData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="focus" name="Focus" stroke="#3b82f6" dot={false} connectNulls />
          <Line type="monotone" dataKey="cognitive_load" name="Cognitive load" stroke="#f97316" dot={false} connectNulls />
          <Line type="monotone" dataKey="subjective_energy" name="Energy" stroke="#22c55e" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer></div>

      {corrData.length >= 3 && (
        <>
          <h3 className="chart-subhead">
            Focus vs{" "}
            <select
              className="corr-select"
              value={corrMetric}
              onChange={(e) => setCorrMetric(e.target.value as CorrelationMetric)}
            >
              {(Object.keys(CORRELATION_LABELS) as CorrelationMetric[]).map((k) => (
                <option key={k} value={k}>{CORRELATION_LABELS[k]}</option>
              ))}
            </select>
          </h3>
          <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="focus"
                name="Focus"
                domain={[0, 10]}
                ticks={[0, 2, 4, 6, 8, 10]}
                label={{ value: "Focus (0–10)", position: "insideBottom", offset: -4, fontSize: 11 }}
              />
              <YAxis
                dataKey="y"
                name={CORRELATION_LABELS[corrMetric]}
                label={{ value: CORRELATION_LABELS[corrMetric], angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <ZAxis range={[40, 40]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                formatter={(value, name) => [value, name]}
              />
              <Scatter
                name="Days"
                data={corrData}
                fill="#8b5cf6"
                fillOpacity={0.7}
              />
            </ScatterChart>
          </ResponsiveContainer></div>
        </>
      )}

      {(processing ?? []).length > 0 && (
        <>
          <h3 className="chart-subhead">Processing speed</h3>
          <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={processing ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="throughput_pm"
                name="Throughput/min"
                stroke="#8b5cf6"
                dot={{ r: 2 }}
                connectNulls
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey={(d: ProcessingSpeedDaily) => Math.round(d.accuracy * 100)}
                name="Accuracy %"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.15}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer></div>
          <p className="chart-empty">Low-quality sessions are still shown and marked in the task result card.</p>
        </>
      )}
    </div>
  );
}
