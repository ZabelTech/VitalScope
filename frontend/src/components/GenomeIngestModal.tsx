import { useEffect, useRef, useState } from "react";
import {
  fetchGenomeIngestHighlight,
  fetchGenomeIngestJob,
  fetchGenomeIngestRanking,
} from "../api";
import type {
  GenomeIngestCounters,
  GenomeIngestEvent,
  GenomeIngestHighlight,
  GenomeIngestJob,
  GenomeIngestRanking,
} from "../types";

type VcfDetail = {
  variant_count: number;
  rs_count: number;
  chromosomes: string[];
};

export type LocalIngestStage =
  | "uploading"
  | "parsing"
  | "saving"
  | "done"
  | "error";

type Props = {
  jobId: number | null;
  initial?: GenomeIngestJob | null;
  vcfDetail?: VcfDetail | null;
  localStage?: LocalIngestStage;
  localError?: string | null;
  uploadProgress?: { loaded: number; total: number } | null;
  onClose: () => void;
};

const POLL_INTERVAL_MS = 1500;

const PRE_STAGE_ORDER = ["uploading", "parsing", "saving"] as const;
type PreStageKey = (typeof PRE_STAGE_ORDER)[number];

const PRE_STAGE_LABELS: Record<PreStageKey, string> = {
  uploading: "Uploading VCF",
  parsing: "Parsing variants",
  saving: "Saving genome record",
};

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
  setup: "Loading VCF into the database",
  positions: "Mapping rsids to genome positions",
  "gene-resolver": "Building gene-interval index",
  "dbsnp-lookup": "Cross-referencing dbSNP gene assignments",
  ensembl: "Resolving remaining genes via Ensembl REST",
  rank: "Ranking your variants by SNPedia magnitude",
  variants: "Compiling variant pages with AI",
  genes: "Compiling gene pages with AI",
  systems: "Synthesising body-system pages",
};

const AI_COMPILE_STAGES = new Set(["variants", "genes", "systems"]);

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

type StageState = "pending" | "running" | "done" | "skipped";

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

function preStageStatePill(localStage: LocalIngestStage | undefined) {
  if (!localStage || localStage === "done") {
    return <span className="ingest-status ingest-status-running">Preparing</span>;
  }
  if (localStage === "error") {
    return <span className="ingest-status ingest-status-failed">Failed</span>;
  }
  return <span className="ingest-status ingest-status-running">Preparing</span>;
}

function reachedStage(currentStage: string | null, target: StageKey): boolean {
  if (!currentStage) return false;
  const currentIdx = (STAGE_ORDER as readonly string[]).indexOf(currentStage);
  const targetIdx = (STAGE_ORDER as readonly string[]).indexOf(target);
  return currentIdx >= 0 && targetIdx >= 0 && currentIdx > targetIdx;
}

function preStageState(
  stage: PreStageKey,
  localStage: LocalIngestStage | undefined,
  jobId: number | null,
): StageState {
  if (jobId !== null) return "done";
  if (!localStage) return "pending";
  if (localStage === "done") return "done";
  if (localStage === "error") {
    // Pipeline aborted — all incomplete pre-stages stay pending, the failing
    // one shows running so the user sees where it died.
    return "pending";
  }
  if (localStage === stage) return "running";
  const curIdx = PRE_STAGE_ORDER.indexOf(localStage as PreStageKey);
  const tgtIdx = PRE_STAGE_ORDER.indexOf(stage);
  if (curIdx > tgtIdx) return "done";
  return "pending";
}

function ingestStageState(stage: StageKey, job: GenomeIngestJob | null): StageState {
  if (!job) return "pending";
  const cur = job.current_stage;
  if (TERMINAL_STATUSES.has(job.status)) {
    if (job.status === "succeeded") return "done";
    if (cur === stage) return "skipped";
    if (reachedStage(cur, stage)) return "done";
    return "skipped";
  }
  if (cur === stage) return "running";
  if (reachedStage(cur, stage)) return "done";
  return "pending";
}

function stageGlyph(state: StageState): string {
  if (state === "done") return "✓";
  if (state === "running") return "◌";
  if (state === "skipped") return "—";
  return "·";
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function GenomeIngestModal({
  jobId,
  initial,
  vcfDetail,
  localStage,
  localError,
  uploadProgress,
  onClose,
}: Props) {
  const [job, setJob] = useState<GenomeIngestJob | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [ranking, setRanking] = useState<GenomeIngestRanking | null>(null);
  const [highlight, setHighlight] = useState<GenomeIngestHighlight | null>(null);
  const [highlightTick, setHighlightTick] = useState(0);
  const sinceRef = useRef(0);

  useEffect(() => {
    if (jobId === null) {
      setJob(null);
      sinceRef.current = 0;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const next = await fetchGenomeIngestJob(jobId!, sinceRef.current);
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

  // Fetch the rank file (top-10 + tier counts + total) once we know the
  // ranking has been written — triggered by the rank-summary counters or by
  // the timeline advancing past the rank stage.
  useEffect(() => {
    if (jobId === null || ranking !== null) return;
    if (!job) return;
    const c = job.counters;
    const rankStarted =
      reachedStage(job.current_stage, "rank") ||
      job.current_stage === "rank" ||
      (c.ranked_total ?? 0) > 0 ||
      (c.tier1_count ?? 0) > 0 ||
      AI_COMPILE_STAGES.has(job.current_stage ?? "");
    if (!rankStarted) return;
    let cancelled = false;
    fetchGenomeIngestRanking(jobId)
      .then((r) => {
        if (!cancelled) setRanking(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId, job, ranking]);

  // Rotate the highlight every 20s while we're in an AI-compile stage.
  useEffect(() => {
    if (jobId === null || !job) return;
    if (!AI_COMPILE_STAGES.has(job.current_stage ?? "")) return;
    if (TERMINAL_STATUSES.has(job.status)) return;
    let cancelled = false;
    const seed = Math.floor(Math.random() * 100000) + highlightTick;
    fetchGenomeIngestHighlight(jobId, seed)
      .then((h) => {
        if (!cancelled) setHighlight(h);
      })
      .catch(() => {});
    const t = setTimeout(() => {
      if (!cancelled) setHighlightTick((n) => n + 1);
    }, 20_000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [jobId, job, highlightTick]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  const failures = job ? failureEvents(job.events) : [];
  const counters: GenomeIngestCounters = job ? job.counters : {};
  const showRankSummary =
    (counters.snpedia_matches ?? 0) > 0 ||
    (counters.ranked_total ?? 0) > 0 ||
    (counters.tier1_count ?? 0) > 0;
  const totalGeneSources =
    (counters.gene_source_snpedia ?? 0) +
    (counters.gene_source_dbsnp ?? 0) +
    (counters.gene_source_ensembl ?? 0);
  const inAiCompile = AI_COMPILE_STAGES.has(job?.current_stage ?? "");

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
            <div className="ingest-modal-sub">
              {job ? (
                <>
                  {statusPill(job.status)}
                  <span className="ingest-modal-elapsed">
                    {formatDuration(job.started_at, job.completed_at)}
                  </span>
                  {job.counters.errors ? (
                    <span className="ingest-modal-errors-pill">
                      {job.counters.errors} error{job.counters.errors === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </>
              ) : (
                preStageStatePill(localStage)
              )}
            </div>
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

        {showRankSummary ? (
          <div className="ingest-vcf-detail" data-testid="ingest-rank-summary">
            <h4 className="ingest-section-title">Match against SNPedia</h4>
            <div className="genome-parse-stats">
              {counters.snpedia_matches != null ? (
                <div className="genome-parse-stat">
                  <span className="genome-parse-stat-value">
                    {counters.snpedia_matches.toLocaleString()}
                  </span>
                  <span className="genome-parse-stat-label">rsids matched</span>
                </div>
              ) : null}
              {counters.ranked_total != null ? (
                <div className="genome-parse-stat">
                  <span className="genome-parse-stat-value">
                    {counters.ranked_total.toLocaleString()}
                  </span>
                  <span className="genome-parse-stat-label">ranked</span>
                </div>
              ) : null}
              {totalGeneSources > 0 ? (
                <div className="genome-parse-stat">
                  <span className="genome-parse-stat-value">
                    {totalGeneSources.toLocaleString()}
                  </span>
                  <span className="genome-parse-stat-label">genes mapped</span>
                </div>
              ) : null}
            </div>
            {totalGeneSources > 0 ? (
              <p className="journal-hint ingest-gene-sources">
                Gene resolution sources:{" "}
                {[
                  counters.gene_source_snpedia
                    ? `SNPedia ${counters.gene_source_snpedia.toLocaleString()}`
                    : null,
                  counters.gene_source_dbsnp
                    ? `dbSNP ${counters.gene_source_dbsnp.toLocaleString()}`
                    : null,
                  counters.gene_source_ensembl
                    ? `Ensembl REST ${counters.gene_source_ensembl.toLocaleString()}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {(counters.tier1_count ?? 0) +
          (counters.tier2_count ?? 0) +
          (counters.tier3_count ?? 0) >
        0 ? (
          <div className="ingest-vcf-detail" data-testid="ingest-tiers">
            <h4 className="ingest-section-title">Tier breakdown</h4>
            <ul className="ingest-tier-list">
              <li>
                <strong>T1 — {(counters.tier1_count ?? 0).toLocaleString()}</strong>
                <span>
                  Genotype subpage hit (gold): SNPedia has a curated allele-effect
                  page for the user's exact diploid.
                </span>
              </li>
              <li>
                <strong>T2 — {(counters.tier2_count ?? 0).toLocaleString()}</strong>
                <span>
                  Fallback hit with a resolvable gene (PMID / ClinVar prose →
                  variant + gene-page candidate).
                </span>
              </li>
              <li>
                <strong>T3 — {(counters.tier3_count ?? 0).toLocaleString()}</strong>
                <span>
                  Fallback hit, gene unresolvable across all four resolver tiers
                  → minimal stub only.
                </span>
              </li>
            </ul>
          </div>
        ) : null}

        {ranking && ranking.rows.length > 0 ? (
          <div className="ingest-vcf-detail" data-testid="ingest-top-rank">
            <h4 className="ingest-section-title">
              Top {ranking.rows.length} variants
            </h4>
            <ol className="ingest-top-rank-list">
              {ranking.rows.map((r) => (
                <li key={r.rsid}>
                  <div className="ingest-top-rank-head">
                    <code>{r.rsid}</code>
                    {r.gene ? <span className="ingest-top-rank-gene">{r.gene}</span> : null}
                    {r.user_genotype ? (
                      <span className="ingest-top-rank-gt">{r.user_genotype}</span>
                    ) : null}
                    {r.magnitude != null ? (
                      <span className="ingest-top-rank-mag">mag {r.magnitude.toFixed(1)}</span>
                    ) : null}
                    {r.tier != null ? (
                      <span className={`ingest-top-rank-tier tier-${r.tier}`}>T{r.tier}</span>
                    ) : null}
                  </div>
                  {r.summary ? (
                    <span className="ingest-top-rank-summary">{r.summary}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {inAiCompile && highlight && highlight.available ? (
          <div className="ingest-highlight" data-testid="ingest-highlight">
            <h4 className="ingest-section-title">
              Compiled now — {highlight.type === "gene" ? "gene" : "variant"}
            </h4>
            <p className="ingest-highlight-title">
              <code>{highlight.title}</code>
              {highlight.gene && highlight.type !== "gene" ? (
                <span className="ingest-highlight-gene"> · {highlight.gene}</span>
              ) : null}
            </p>
            {highlight.summary ? (
              <p className="ingest-highlight-summary">{highlight.summary}</p>
            ) : null}
          </div>
        ) : null}

        {vcfDetail ? (
          <div className="ingest-vcf-detail" data-testid="ingest-vcf-detail">
            <h4 className="ingest-section-title">Source VCF</h4>
            <div className="genome-parse-stats">
              <div className="genome-parse-stat">
                <span className="genome-parse-stat-value">
                  {vcfDetail.variant_count.toLocaleString()}
                </span>
                <span className="genome-parse-stat-label">variants</span>
              </div>
              <div className="genome-parse-stat">
                <span className="genome-parse-stat-value">
                  {vcfDetail.rs_count.toLocaleString()}
                </span>
                <span className="genome-parse-stat-label">with RS ID</span>
              </div>
              <div className="genome-parse-stat">
                <span className="genome-parse-stat-value">
                  {vcfDetail.chromosomes.length}
                </span>
                <span className="genome-parse-stat-label">chromosomes</span>
              </div>
            </div>
            {vcfDetail.chromosomes.length > 0 ? (
              <p className="journal-hint genome-chrom-list">
                {vcfDetail.chromosomes.slice(0, 30).join(", ")}
                {vcfDetail.chromosomes.length > 30
                  ? ` +${vcfDetail.chromosomes.length - 30} more`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <ol className="ingest-stage-list" data-testid="ingest-stage-list">
          {PRE_STAGE_ORDER.map((stage) => {
            const state = preStageState(stage, localStage, jobId);
            const showUploadBar =
              stage === "uploading" && state === "running" && uploadProgress;
            const uploadPct =
              showUploadBar && uploadProgress && uploadProgress.total > 0
                ? Math.min(
                    100,
                    Math.round((uploadProgress.loaded / uploadProgress.total) * 100),
                  )
                : 0;
            const showParseBar = stage === "parsing" && state === "running";
            return (
              <li
                key={stage}
                className={`ingest-stage ingest-stage-${state}`}
                data-stage={stage}
              >
                <span className="ingest-stage-glyph" aria-hidden="true">
                  {stageGlyph(state)}
                </span>
                <span className="ingest-stage-label">{PRE_STAGE_LABELS[stage]}</span>
                {showUploadBar ? (
                  <div className="ingest-stage-progress">
                    <div className="ingest-progress-track">
                      <div
                        className="ingest-progress-bar"
                        style={{ width: `${uploadPct}%` }}
                      />
                    </div>
                    <div className="ingest-progress-label">
                      {uploadPct}% — {formatBytes(uploadProgress!.loaded)} /{" "}
                      {formatBytes(uploadProgress!.total)}
                    </div>
                  </div>
                ) : null}
                {showParseBar ? (
                  <div className="ingest-stage-progress">
                    <div className="ingest-progress-track ingest-progress-indeterminate">
                      <div className="ingest-progress-bar-indeterminate" />
                    </div>
                  </div>
                ) : null}
                {stage === "saving" && state === "running" ? (
                  <div className="ingest-stage-progress">
                    <div className="ingest-progress-track ingest-progress-indeterminate">
                      <div className="ingest-progress-bar-indeterminate" />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
          {STAGE_ORDER.map((stage) => {
            const state = ingestStageState(stage, job);
            const msg = job ? stageLastMessage(stage, job.events) : "";
            return (
              <li
                key={stage}
                className={`ingest-stage ingest-stage-${state}`}
                data-stage={stage}
              >
                <span className="ingest-stage-glyph" aria-hidden="true">
                  {stageGlyph(state)}
                </span>
                <span className="ingest-stage-label">{STAGE_LABELS[stage]}</span>
                {msg ? <span className="ingest-stage-msg">{msg}</span> : null}
              </li>
            );
          })}
        </ol>

        {job ? (
          <>
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

            {failures.length > 0 ? (
              <div className="ingest-errors-block">
                <button
                  type="button"
                  className="ingest-errors-toggle"
                  onClick={() => setShowErrors((v) => !v)}
                >
                  {showErrors ? "Hide" : "Show"} {failures.length} per-page errors
                </button>
                {showErrors ? (
                  <ul className="ingest-errors-list">
                    {failures.map((ev, i) => (
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
        ) : null}

        {localStage === "error" && localError ? (
          <p className="ingest-fail" data-testid="ingest-prejob-fail">
            {localError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
