import { useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Scatter, ScatterChart, ZAxis, Area,
} from "recharts";
import { useMetricData } from "../hooks/useMetricData";
import type { CognitionDaily, ProcessingSpeedDaily, SleepDaily } from "../types";

type CorrelationMetric = "deep_sleep_min" | "avg_rt_ms";
type ProcessingView = "raw" | "adjusted";

const CORRELATION_LABELS: Record<CorrelationMetric, string> = {
  deep_sleep_min: "Deep sleep (min)",
  avg_rt_ms: "Reaction time (ms)",
};

interface Props {
  start: string;
  end: string;
}

export function CognitionSection({ start, end }: Props) {
  const [corrMetric, setCorrMetric] = useState<CorrelationMetric>("deep_sleep_min");
  const [processingView, setProcessingView] = useState<ProcessingView>("raw");

  const { data: cognition, loading } = useMetricData<CognitionDaily[]>(
    "journal/cognition", start, end
  );
  const { data: processing } = useMetricData<ProcessingSpeedDaily[]>("cognition/processing-speed/daily", start, end);
  const { data: sleep } = useMetricData<SleepDaily[]>("sleep/daily", start, end);

  if (loading) return <div className="chart-loading">Loading cognition data…</div>;

  const hasCognitionData = (cognition ?? []).some(
    (d) => d.focus !== null || d.cognitive_load !== null || d.subjective_energy !== null
  );

  const hasProcessingData = (processing ?? []).length > 0;

  if (!hasCognitionData && !hasProcessingData) {
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


  const processingData = (processing ?? [])
    .map((d) => ({
      ...d,
      ts: new Date(d.started_at ?? d.created_at).getTime(),
      accuracy_pct: Math.round(d.accuracy * 100),
      adjusted_plot: d.baseline_confidence === "ok" ? d.adjusted_score : null,
      low_quality_throughput: d.quality_flag === "low" ? d.throughput_pm : null,
    }))
    .sort((a, b) => a.ts - b.ts);

  const formatProcessingTick = (ms: number) => {
    const d = new Date(ms);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${m}-${day}`;
  };
  const formatProcessingLabel = (ms: unknown) => {
    const t = typeof ms === "number" ? ms : Number(ms);
    if (!Number.isFinite(t)) return String(ms ?? "");
    const d = new Date(t);
    return d.toISOString().slice(0, 16).replace("T", " ");
  };
  const processingDomain: [number, number] | undefined = processingData.length
    ? [processingData[0].ts, processingData[processingData.length - 1].ts]
    : undefined;

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

      {hasCognitionData && (
        <>
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
        </>
      )}

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
          <h3 className="chart-subhead">
            Processing speed
            <select
              className="corr-select"
              value={processingView}
              onChange={(e) => setProcessingView(e.target.value as ProcessingView)}
              style={{ marginLeft: 12 }}
            >
              <option value="raw">Raw throughput</option>
              <option value="adjusted">Quality-adjusted z-score</option>
            </select>
          </h3>
          <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={processingData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={processingDomain ?? ["auto", "auto"]}
                tick={{ fontSize: 11 }}
                tickFormatter={formatProcessingTick}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              {processingView === "raw" && <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />}
              <Tooltip labelFormatter={formatProcessingLabel} />
              <Legend />
              {processingView === "raw" ? (
                <>
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="throughput_pm"
                    name="Throughput/min"
                    stroke="#8b5cf6"
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Scatter
                    yAxisId="left"
                    name="Low-quality sessions"
                    data={processingData}
                    dataKey="low_quality_throughput"
                    fill="#ef4444"
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="accuracy_pct"
                    name="Accuracy %"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.15}
                    connectNulls
                  />
                </>
              ) : (
                <>
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="adjusted_plot"
                    name="Adjusted score (z)"
                    stroke="#22c55e"
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer></div>
          <p className="chart-empty">
            Each point is one session — multiple runs per day are plotted separately. Red points mark low-quality sessions in raw view. Adjusted view only plots sessions with enough prior high-quality baseline history (3+ sessions).
          </p>
        </>
      )}
    </div>
  );
}
