import { useState } from "react";
import { analyzeOrient } from "../api";
import type { OrientAnalysis, OrientTopic } from "../types";

const TOPIC_ACCENT: Record<string, string> = {
  health: "#3b82f6",
  performance: "#8b5cf6",
  recovery: "#22c55e",
  body_composition: "#f97316",
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

export function OrientAiAnalysis() {
  const [analysis, setAnalysis] = useState<OrientAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!analysis && !loading && !error) {
    return (
      <div className="orient-ai-prompt">
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
      <div className="orient-ai-loading">
        <div className="orient-ai-spinner" />
        <span>Analysing your data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="orient-ai-error">
        <span>{error}</span>
        <button onClick={runAnalysis}>Retry</button>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="orient-ai-result">
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
