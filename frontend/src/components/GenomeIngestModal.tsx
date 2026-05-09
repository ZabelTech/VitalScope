import { useEffect, useRef, useState } from "react";
import { fetchGenomeIngestJob } from "../api";
import type {
  GenomeIngestCounters,
  GenomeIngestEvent,
  GenomeIngestJob,
} from "../types";

type Props = {
  jobId: number;
  initial?: GenomeIngestJob | null;
  onClose: () => void;
};

const POLL_INTERVAL_MS = 1500;

const STAGE_ORDER = [
  "setup",
  "positions",
  "gene-resolver",
  "dbsnp-lookup",
  "ensembl",
  "rank",
  "variants",
  "genes",
  "systems",
] as const;

type StageKey = (typeof STAGE_ORDER)[number];

const STAGE_LABELS: Record<StageKey, string> = {
  setup: "Initializing AI provider",
  positions: "Mapping rsids to genome positions",
  "gene-resolver": "Building gene-interval index",
  "dbsnp-lookup": "Cross-referencing dbSNP gene assignments",
  ensembl: "Resolving remaining genes via Ensembl REST",
  rank: "Ranking your variants by SNPedia magnitude",
  variants: "Compiling variant pages with AI",
  genes: "Compiling gene pages with AI",
  systems: "Synthesising body-system pages",
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function isStageKey(s: string | null | undefined): s is StageKey {
  return !!s && (STAGE_ORDER as readonly string[]).includes(s);
}

function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function statusPill(status: GenomeIngestJob["status"]) {
  const label =
    status === "running"
      ? "Running"
      : status === "queued"
      ? "Queued"
      : status === "succeeded"
      ? "Done"
      : status === "failed"
      ? "Failed"
      : "Cancelled";
  return <span className={`ingest-status ingest-status-${status}`}>{label}</span>;
}

function reachedStage(currentStage: string | null, target: StageKey): boolean {
  if (!currentStage) return false;
  const currentIdx = (STAGE_ORDER as readonly string[]).indexOf(currentStage);
  const targetIdx = (STAGE_ORDER as readonly string[]).indexOf(target);
  return currentIdx >= 0 && targetIdx >= 0 && currentIdx > targetIdx;
}

function stageStateFor(
  stage: StageKey,
  job: GenomeIngestJob,
): "pending" | "running" | "done" | "skipped" {
  const cur = job.current_stage;
  if (TERMINAL_STATUSES.has(job.status)) {
    if (job.status === "succeeded") {
      return cur === stage || reachedStage(cur, stage) || cur === null
        ? "done"
        : "done";
    }
    if (cur === stage) return job.status === "failed" ? "running" : "done";
    if (reachedStage(cur, stage)) return "done";
    return "skipped";
  }
  if (cur === stage) return "running";
  if (reachedStage(cur, stage)) return "done";
  return "pending";
}

function stageLastMessage(stage: StageKey, events: GenomeIngestEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "stage" && ev.stage === stage && ev.message) return ev.message;
  }
  return "";
}

function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="ingest-progress">
      <div className="ingest-progress-track">
        <div className="ingest-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="ingest-progress-label">
        {label}: {done} / {total}
      </div>
    </div>
  );
}

function liveCounters(stage: string | null, c: GenomeIngestCounters) {
  const items: { key: string; node: React.ReactNode }[] = [];
  if (stage === "variants" && (c.variants_total ?? 0) > 0) {
    items.push({
      key: "variants",
      node: (
        <ProgressBar
          done={c.variants_done ?? 0}
          total={c.variants_total ?? 0}
          label="Variants compiled"
        />
      ),
    });
  }
  if (stage === "genes" && (c.genes_total ?? 0) > 0) {
    items.push({
      key: "genes",
      node: (
        <ProgressBar
          done={c.genes_done ?? 0}
          total={c.genes_total ?? 0}
          label="Genes compiled"
        />
      ),
    });
  }
  return items;
}

function lastPageLabel(events: GenomeIngestEvent[], stage: string | null): string {
  if (!stage) return "";
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "page_ok" && ev.stage === stage && ev.label) return ev.label;
  }
  return "";
}

function failureEvents(events: GenomeIngestEvent[]): GenomeIngestEvent[] {
  return events.filter((ev) => ev.kind === "page_fail");
}

export function GenomeIngestModal({ jobId, initial, onClose }: Props) {
  const [job, setJob] = useState<GenomeIngestJob | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const sinceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const next = await fetchGenomeIngestJob(jobId, sinceRef.current);
        if (cancelled) return;
        setJob((prev) => {
          const merged: GenomeIngestJob = prev
            ? {
                ...next,
                events: [...prev.events, ...(next.events ?? [])],
              }
            : next;
          sinceRef.current = next.events_total;
          return merged;
        });
        setError(null);
        if (!TERMINAL_STATUSES.has(next.status)) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (cancelled) return;
        setError(String((e as Error)?.message ?? e));
        timer = setTimeout(tick, POLL_INTERVAL_MS * 2);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="ingest-modal-overlay"
      onClick={onClose}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div
        className="ingest-modal"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="ingest-modal-header">
          <div>
            <h3 className="ingest-modal-title">Compiling your genome wiki</h3>
            {job && (
              <div className="ingest-modal-sub">
                {statusPill(job.status)}
                <span className="ingest-modal-elapsed">
                  {formatDuration(job.started_at, job.completed_at)}
                </span>
                {job.counters.errors ? (
                  <span className="ingest-modal-errors-pill">
                    {job.counters.errors} error{job.counters.errors === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            className="ingest-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!job ? (
          <p className="journal-hint">Loading job…</p>
        ) : (
          <>
            <ol className="ingest-stage-list" data-testid="ingest-stage-list">
              {STAGE_ORDER.map((stage) => {
                const state = stageStateFor(stage, job);
                const msg = stageLastMessage(stage, job.events);
                return (
                  <li
                    key={stage}
                    className={`ingest-stage ingest-stage-${state}`}
                    data-stage={stage}
                  >
                    <span className="ingest-stage-glyph" aria-hidden="true">
                      {state === "done"
                        ? "✓"
                        : state === "running"
                        ? "◌"
                        : state === "skipped"
                        ? "—"
                        : "·"}
                    </span>
                    <span className="ingest-stage-label">{STAGE_LABELS[stage]}</span>
                    {msg ? <span className="ingest-stage-msg">{msg}</span> : null}
                  </li>
                );
              })}
            </ol>

            {liveCounters(job.current_stage, job.counters).map((item) => (
              <div key={item.key}>{item.node}</div>
            ))}

            {isStageKey(job.current_stage) && lastPageLabel(job.events, job.current_stage) ? (
              <p className="journal-hint ingest-current-label">
                Latest: {lastPageLabel(job.events, job.current_stage)}
              </p>
            ) : null}

            {job.status === "succeeded" && job.summary ? (
              <div className="ingest-summary" data-testid="ingest-summary">
                <h4>Summary</h4>
                <ul className="ingest-summary-list">
                  {job.summary.considered != null ? (
                    <li>{job.summary.considered} variants considered</li>
                  ) : null}
                  {job.summary.written != null ? (
                    <li>{job.summary.written} pages written</li>
                  ) : null}
                  {job.summary.skipped_for_cap ? (
                    <li>{job.summary.skipped_for_cap} skipped (page cap)</li>
                  ) : null}
                  {job.summary.errors && job.summary.errors.length ? (
                    <li>{job.summary.errors.length} errors</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {job.status === "failed" ? (
              <p className="ingest-fail" data-testid="ingest-fail">
                {job.error_text ?? "Ingest failed."}
              </p>
            ) : null}

            {failureEvents(job.events).length > 0 ? (
              <div className="ingest-errors-block">
                <button
                  type="button"
                  className="ingest-errors-toggle"
                  onClick={() => setShowErrors((v) => !v)}
                >
                  {showErrors ? "Hide" : "Show"} {failureEvents(job.events).length} per-page errors
                </button>
                {showErrors ? (
                  <ul className="ingest-errors-list">
                    {failureEvents(job.events).map((ev, i) => (
                      <li key={i}>
                        <code>{ev.label}</code> — {ev.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="journal-hint ingest-poll-error">Polling error: {error}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
