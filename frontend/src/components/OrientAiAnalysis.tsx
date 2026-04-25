import { useEffect, useState } from "react";
import { analyzeOrient, explainOrient, fetchOrientAnomalies } from "../api";
import type {
  OrientAnalysis,
  OrientAnomaly,
  OrientExplain,
  OrientTopic,
} from "../types";

const TOPIC_ACCENT: Record<string, string> = {
  health: "#3b82f6",
  performance: "#8b5cf6",
  recovery: "#22c55e",
  body_composition: "#f97316",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "#22c55e",
  medium: "#f97316",
  low: "#64748b",
};

function TopicCard({ topic }: { topic: OrientTopic }) {
  const accent = TOPIC_ACCENT[topic.id] ?? "#64748b";
  return (
    <div className="orient-topic-card" style={{ borderLeftColor: accent }}>
      <h4 className="orient-topic-label" style={{ color: accent }}>
        {topic.label}
      </h4>
      <p className="orient-topic-summary">{topic.summary}</p>

      {topic.alerts.length > 0 && (
        <div className="orient-alerts">
          {topic.alerts.map((a, i) => (
            <div key={i} className="orient-alert">
              {a}
            </div>
          ))}
        </div>
      )}

      {topic.insights.length > 0 && (
        <ul className="orient-list orient-insights">
          {topic.insights.map((ins, i) => (
            <li key={i}>{ins}</li>
          ))}
        </ul>
      )}

      {topic.recommendations.length > 0 && (
        <div className="orient-recs">
          <span className="orient-recs-label">Recommendations</span>
          <ul className="orient-list">
            {topic.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AnomalyBadge({ anomaly }: { anomaly: OrientAnomaly }) {
  return (
    <span
      className={`orient-anomaly-badge orient-anomaly-badge--${anomaly.direction}`}
      title={`z=${anomaly.z_score > 0 ? "+" : ""}${anomaly.z_score} (mean ${anomaly.mean} ${anomaly.unit})`}
    >
      {anomaly.direction === "high" ? "↑" : "↓"} {anomaly.value} {anomaly.unit}
    </span>
  );
}

interface ExplainState {
  loading: boolean;
  result: OrientExplain | null;
  error: string | null;
}

function ExplainPanel({ explain }: { explain: OrientExplain }) {
  return (
    <div className="orient-explain-panel">
      <p className="orient-explain-summary">{explain.summary}</p>
      {explain.likely_contributors.length > 0 && (
        <div className="orient-explain-contributors">
          {explain.likely_contributors.map((c, i) => (
            <div key={i} className="orient-explain-contributor">
              <span
                className="orient-explain-factor"
                style={{ color: CONFIDENCE_COLOR[c.confidence] ?? "#64748b" }}
              >
                {c.factor}
              </span>
              <span className={`orient-explain-direction orient-explain-direction--${c.direction}`}>
                {c.direction}
              </span>
              <span className="orient-explain-evidence">{c.evidence}</span>
            </div>
          ))}
        </div>
      )}
      {explain.what_to_watch && (
        <div className="orient-explain-watch">
          <span className="orient-explain-watch-label">Watch:</span> {explain.what_to_watch}
        </div>
      )}
    </div>
  );
}

interface AnomalyRowProps {
  anomaly: OrientAnomaly;
  explainState: ExplainState | undefined;
  onExplain: () => void;
}

function AnomalyRow({ anomaly, explainState, onExplain }: AnomalyRowProps) {
  return (
    <div className="orient-anomaly-row">
      <div className="orient-anomaly-row-header">
        <span className="orient-anomaly-metric">{anomaly.metric_label}</span>
        <span className="orient-anomaly-date">{anomaly.date}</span>
        <AnomalyBadge anomaly={anomaly} />
        <button
          className="orient-explain-btn"
          onClick={onExplain}
          disabled={explainState?.loading}
        >
          {explainState?.loading ? "Explaining…" : "Explain"}
        </button>
      </div>
      {explainState?.error && (
        <div className="orient-explain-error">{explainState.error}</div>
      )}
      {explainState?.result && <ExplainPanel explain={explainState.result} />}
    </div>
  );
}

export function OrientAiAnalysis() {
  const [analysis, setAnalysis] = useState<OrientAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [anomalies, setAnomalies] = useState<OrientAnomaly[]>([]);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);

  const [explainStates, setExplainStates] = useState<
    Record<string, ExplainState>
  >({});

  useEffect(() => {
    fetchOrientAnomalies(14)
      .then((r) => setAnomalies(r.anomalies))
      .catch(() => setAnomalies([]))
      .finally(() => setAnomaliesLoading(false));
  }, []);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await analyzeOrient(14));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runExplain(anomaly: OrientAnomaly) {
    const key = `${anomaly.metric}:${anomaly.date}`;
    setExplainStates((prev) => ({
      ...prev,
      [key]: { loading: true, result: null, error: null },
    }));
    try {
      const result = await explainOrient(anomaly.metric, anomaly.date);
      setExplainStates((prev) => ({
        ...prev,
        [key]: { loading: false, result, error: null },
      }));
    } catch (e) {
      setExplainStates((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          result: null,
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  const anomaliesSection = (
    <div className="orient-anomalies-section">
      <div className="orient-anomalies-header">
        <span className="orient-anomalies-title">Anomalies</span>
        <span className="orient-anomalies-subtitle">
          Values ≥1.5σ from 14-day mean
        </span>
      </div>
      {anomaliesLoading ? (
        <div className="orient-anomalies-loading">
          <div className="orient-ai-spinner orient-ai-spinner--sm" />
        </div>
      ) : anomalies.length === 0 ? (
        <p className="orient-anomalies-none">No anomalies detected.</p>
      ) : (
        <div className="orient-anomaly-list">
          {anomalies.map((a) => (
            <AnomalyRow
              key={`${a.metric}:${a.date}`}
              anomaly={a}
              explainState={explainStates[`${a.metric}:${a.date}`]}
              onExplain={() => runExplain(a)}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (!analysis && !loading && !error) {
    return (
      <div className="orient-ai-prompt">
        {anomaliesSection}
        <p className="orient-ai-intro">
          AI analysis of your last 14 days — trends, evidence-based insights, and
          recommendations across Health, Performance, Recovery, and Body Composition.
        </p>
        <button className="orient-ai-btn" onClick={runAnalysis}>
          Generate Analysis
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <>
        {anomaliesSection}
        <div className="orient-ai-loading">
          <div className="orient-ai-spinner" />
          <span>Analysing your data…</span>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {anomaliesSection}
        <div className="orient-ai-error">
          <span>{error}</span>
          <button onClick={runAnalysis}>Retry</button>
        </div>
      </>
    );
  }

  if (!analysis) return null;

  return (
    <div className="orient-ai-result">
      {anomaliesSection}

      <div className="orient-ai-overall">
        <p>{analysis.overall_summary}</p>
        <span className="orient-ai-meta">
          {analysis.window_days}d window ending {analysis.analysis_date} · {analysis.model}
        </span>
      </div>

      <div className="orient-topics">
        {analysis.topics.map((topic) => (
          <TopicCard key={topic.id} topic={topic} />
        ))}
      </div>

      <div className="orient-ai-footer">
        <button
          className="orient-ai-btn orient-ai-btn--sm"
          onClick={runAnalysis}
          disabled={loading}
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}
