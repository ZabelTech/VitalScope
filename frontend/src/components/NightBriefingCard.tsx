import { format } from "date-fns";
import { useState } from "react";
import { analyzeNightBriefing } from "../api";
import type { NightBriefing } from "../types";

export function NightBriefingCard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [briefing, setBriefing] = useState<NightBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(regenerate = false) {
    setLoading(true);
    setError(null);
    try {
      setBriefing(await analyzeNightBriefing(today, regenerate));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!briefing && !loading && !error) {
    return (
      <div className="orient-ai-prompt">
        <p className="orient-ai-intro">
          End-of-day briefing — closes today, sets tonight up well. Pulls
          today's training, nutrition, stress, and supplement data and surfaces
          the small high-leverage choices left before sleep.
        </p>
        <button className="orient-ai-btn" onClick={() => generate()}>
          Generate Night Briefing
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="orient-ai-loading">
        <div className="orient-ai-spinner" />
        <span>Building your night briefing…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="orient-ai-error">
        <span>{error}</span>
        <button onClick={() => generate()}>Retry</button>
      </div>
    );
  }

  if (!briefing) return null;

  return (
    <div className="night-briefing">
      <div className="night-briefing-readout">
        <p>{briefing.today_readout}</p>
        <span className="orient-ai-meta">
          {briefing.analysis_date} · {briefing.model}
          {briefing.cached && " · cached"}
        </span>
      </div>

      <div className="night-briefing-block">
        <h4 className="night-briefing-block-title">Sleep posture</h4>
        <p className="night-briefing-block-text">{briefing.sleep_debt_posture}</p>
      </div>

      {briefing.pre_sleep_checklist.length > 0 && (
        <div className="night-briefing-block">
          <h4 className="night-briefing-block-title">Before bed</h4>
          <ul className="orient-list night-briefing-checklist">
            {briefing.pre_sleep_checklist.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {briefing.watch_outs.length > 0 && (
        <div className="night-briefing-block">
          <h4 className="night-briefing-block-title">Watch-outs</h4>
          <div className="night-briefing-watchouts">
            {briefing.watch_outs.map((wo, i) => (
              <div key={i} className="night-briefing-watchout">
                <div className="orient-alert">{wo.issue}</div>
                <p className="night-briefing-mitigation">{wo.mitigation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {briefing.tomorrow_setup.length > 0 && (
        <div className="night-briefing-block">
          <h4 className="night-briefing-block-title">Tomorrow setup</h4>
          <ul className="orient-list">
            {briefing.tomorrow_setup.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="orient-ai-footer">
        <button
          className="orient-ai-btn orient-ai-btn--sm"
          onClick={() => generate(true)}
          disabled={loading}
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}
