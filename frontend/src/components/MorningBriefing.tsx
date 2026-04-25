import { format } from "date-fns";
import { type ReactNode, useState } from "react";
import { getMorningBriefing } from "../api";
import type { MorningBriefing as MorningBriefingType } from "../types";

function fmtAge(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (isNaN(d.getTime())) return isoTimestamp;
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return format(d, "MMM d");
}

function BriefingBlock({
  label,
  accent,
  children,
}: {
  label: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div className="briefing-block" style={{ borderLeftColor: accent }}>
      <span className="briefing-block-label" style={{ color: accent }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="briefing-empty">Nothing logged yet.</p>;
  return (
    <ul className="briefing-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function MorningBriefing() {
  const [briefing, setBriefing] = useState<MorningBriefingType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(regenerate = false) {
    setLoading(true);
    setError(null);
    try {
      setBriefing(await getMorningBriefing(regenerate));
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
          Your morning briefing stitches last night's recovery, yesterday's load, and
          today's plan into a single read. Generated once per day and cached — hit
          Regenerate to refresh.
        </p>
        <button className="orient-ai-btn" onClick={() => load(false)}>
          Generate Briefing
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="orient-ai-loading">
        <div className="orient-ai-spinner" />
        <span>Generating your briefing…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="orient-ai-error">
        <span>{error}</span>
        <button onClick={() => load(false)}>Retry</button>
      </div>
    );
  }

  if (!briefing) return null;

  return (
    <div className="briefing-result">
      <div className="briefing-meta">
        {briefing.briefing_date} · {briefing.model}
        {briefing.cached && " · cached"}
        {" · "}
        {fmtAge(briefing.generated_at)}
      </div>

      <BriefingBlock label="Recovery readout" accent="#22c55e">
        <p className="briefing-prose">{briefing.recovery_readout}</p>
      </BriefingBlock>

      <BriefingBlock label="Yesterday's carryover" accent="#f97316">
        <p className="briefing-prose">{briefing.yesterday_carryover}</p>
      </BriefingBlock>

      <BriefingBlock label="Tonight's outlook" accent="#8b5cf6">
        <p className="briefing-prose">{briefing.tonight_outlook}</p>
      </BriefingBlock>

      <BriefingBlock label="What's up today" accent="#3b82f6">
        <BulletList items={briefing.whats_up} />
      </BriefingBlock>

      <BriefingBlock label="What's planned" accent="#64748b">
        <BulletList items={briefing.whats_planned} />
      </BriefingBlock>

      <BriefingBlock label="Suggestions" accent="#eab308">
        <ul className="briefing-list briefing-suggestions">
          {briefing.suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </BriefingBlock>

      <div className="orient-ai-footer">
        <button
          className="orient-ai-btn orient-ai-btn--sm"
          onClick={() => load(true)}
          disabled={loading}
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}
