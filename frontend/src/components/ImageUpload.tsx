import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeBloodworkUpload,
  analyzeFormCheckImage,
  analyzeMealImage,
  deleteUpload,
  fetchUploads,
  listNutrientDefs,
  parseGenomeUpload,
  uploadImage,
  uploadImageUrl,
} from "../api";
import type {
  BloodworkAnalysisResult,
  FormCheckAnalysisResult,
  GenomeParseResult,
  MealAnalysisResult,
  NutrientCategory,
  NutrientDef,
  Upload,
  UploadKind,
} from "../types";
import { useRuntime } from "../hooks/useRuntime";
import { BloodworkAnalysisDraft } from "./BloodworkAnalysisDraft";
import { FormCheckAnalysisDraft } from "./FormCheckAnalysisDraft";
import { GenomeParseDraft } from "./GenomeParseDraft";
import { MealAnalysisDraft } from "./MealAnalysisDraft";

interface Props {
  kind: UploadKind;
  date: string;
  label: string;
  hint?: string;
  onSaved?: () => void;
}

type Draft =
  | { kind: "meal"; result: MealAnalysisResult; uploadId: number }
  | { kind: "form"; result: FormCheckAnalysisResult; uploadId: number }
  | { kind: "bloodwork"; result: BloodworkAnalysisResult; uploadId: number }
  | { kind: "genome"; result: GenomeParseResult; uploadId: number };

const SIZE_LIMITS: Record<UploadKind, number> = {
  meal: 5 * 1024 * 1024,
  form: 5 * 1024 * 1024,
  bloodwork: 10 * 1024 * 1024,
  genome: 50 * 1024 * 1024,
  snpedia: 50 * 1024 * 1024,
};

function isAcceptedFile(kind: UploadKind, mime: string): boolean {
  if (mime.startsWith("image/")) return true;
  if (kind === "bloodwork" && mime === "application/pdf") return true;
  if (kind === "genome" && (
    mime.startsWith("text/") ||
    mime === "application/octet-stream" ||
    mime === "application/gzip" ||
    mime === "application/x-gzip"
  )) return true;
  return false;
}

export function ImageUpload({ kind, date, label, hint, onSaved }: Props) {
  const runtime = useRuntime();
  const [items, setItems] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  const [analysingId, setAnalysingId] = useState<number | null>(null);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<{ uploadId: number; note: string } | null>(null);

  const [nutrientDefs, setNutrientDefs] = useState<NutrientDef[]>([]);
  useEffect(() => {
    if (kind === "meal") {
      listNutrientDefs().then(setNutrientDefs).catch(() => setNutrientDefs([]));
    }
  }, [kind]);

  const defsByCategory = useMemo(() => {
    const groups: Record<NutrientCategory, NutrientDef[]> = {
      macro: [],
      mineral: [],
      vitamin: [],
      bioactive: [],
    };
    for (const d of nutrientDefs) groups[d.category].push(d);
    return groups;
  }, [nutrientDefs]);

  const canAnalyse = kind === "genome" ? true : runtime?.ai_available === true;
  const acceptString =
    kind === "bloodwork" ? "image/*,application/pdf" :
    kind === "genome" ? ".vcf,.vcf.gz,text/plain,application/gzip,application/x-gzip,application/octet-stream" :
    "image/*";
  const sizeLimit = SIZE_LIMITS[kind];
  const sizeLimitMb = Math.round(sizeLimit / (1024 * 1024));

  const reload = useCallback(async () => {
    try {
      setItems(await fetchUploads(kind, date));
    } catch {
      setItems([]);
    }
  }, [kind, date]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (!isAcceptedFile(kind, f.type)) {
          setError(`${f.name} is not an accepted file type`);
          continue;
        }
        if (f.size > sizeLimit) {
          setError(`${f.name} exceeds ${sizeLimitMb} MB`);
          continue;
        }
        await uploadImage(kind, date, f);
      }
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (libraryInputRef.current) libraryInputRef.current.value = "";
    }
  }

  async function onDelete(id: number) {
    await deleteUpload(id);
    if (draft?.uploadId === id) setDraft(null);
    if (pending?.uploadId === id) setPending(null);
    await reload();
  }

  function openPreflight(id: number) {
    setAnalyseError(null);
    setDraft(null);
    setPending({ uploadId: id, note: "" });
  }

  async function startGenomeParse(uploadId: number) {
    setAnalyseError(null);
    setDraft(null);
    setAnalysingId(uploadId);
    try {
      const result = await parseGenomeUpload(uploadId);
      setDraft({ kind: "genome", result, uploadId });
    } catch (e) {
      setAnalyseError(String(e instanceof Error ? e.message : e));
    } finally {
      setAnalysingId(null);
    }
  }

  async function runAnalyse() {
    if (!pending) return;
    const { uploadId, note } = pending;
    setAnalyseError(null);
    setAnalysingId(uploadId);
    try {
      if (kind === "meal") {
        const result = await analyzeMealImage(uploadId, note);
        setDraft({ kind: "meal", result, uploadId });
      } else if (kind === "form") {
        const result = await analyzeFormCheckImage(uploadId, note);
        setDraft({ kind: "form", result, uploadId });
      } else if (kind === "genome") {
        const result = await parseGenomeUpload(uploadId);
        setDraft({ kind: "genome", result, uploadId });
      } else {
        const result = await analyzeBloodworkUpload(uploadId, note);
        setDraft({ kind: "bloodwork", result, uploadId });
      }
      setPending(null);
    } catch (e) {
      setAnalyseError(String(e instanceof Error ? e.message : e));
    } finally {
      setAnalysingId(null);
    }
  }

  async function onDraftSaved() {
    setDraft(null);
    await reload();
    onSaved?.();
  }

  const preflightPlaceholder =
    kind === "meal"
      ? "e.g. ~200g salmon, 150g jasmine rice, olive oil, no sauce"
      : kind === "form"
      ? "e.g. morning, fasted, post-12-week cut, harsh overhead light"
      : kind === "genome"
      ? ""
      : "e.g. fasting 14h, morning draw, on medication X";

  const emptyHint =
    kind === "meal"
      ? "No meal photos yet."
      : kind === "form"
      ? "No form photos yet."
      : kind === "genome"
      ? "No genome files uploaded yet."
      : "No bloodwork uploads yet.";

  function getLinkedId(u: Upload): number | null {
    if (kind === "meal") return u.meal_id;
    if (kind === "form") return u.body_composition_estimate_id;
    if (kind === "genome") return u.genome_upload_id;
    return u.bloodwork_panel_id;
  }

  function renderThumb(u: Upload) {
    if (u.mime === "application/pdf") {
      return (
        <a
          className="image-upload-pdf-tile"
          href={uploadImageUrl(u.id)}
          target="_blank"
          rel="noreferrer"
          title={u.filename}
        >
          <span className="image-upload-pdf-icon">PDF</span>
        </a>
      );
    }
    if (u.kind === "genome") {
      return (
        <span className="image-upload-pdf-tile" title={u.filename}>
          <span className="image-upload-pdf-icon">VCF</span>
        </span>
      );
    }
    return <img src={uploadImageUrl(u.id)} alt="" loading="lazy" />;
  }

  function renderPreflightPreview(uploadId: number) {
    const u = items.find((i) => i.id === uploadId);
    if (u?.mime === "application/pdf") {
      return (
        <a
          className="meal-analysis-preflight-pdf"
          href={uploadImageUrl(uploadId)}
          target="_blank"
          rel="noreferrer"
        >
          Open PDF ↗
        </a>
      );
    }
    return (
      <img
        className="meal-analysis-preflight-img"
        src={uploadImageUrl(uploadId)}
        alt=""
      />
    );
  }

  const takeLabel = kind === "bloodwork" ? "Scan document" : kind === "genome" ? "Upload VCF" : "Take photo";
  const libraryLabel = kind === "bloodwork" || kind === "genome" ? "Pick file" : "From library";

  return (
    <div className="image-upload">
      <div className="image-upload-header">
        <span className="stat-label">{label}</span>
      </div>
      <div className="image-upload-actions">
        <label className="image-upload-button">
          {takeLabel}
          <input
            ref={cameraInputRef}
            type="file"
            accept={acceptString}
            multiple
            capture="environment"
            onChange={(e) => onFiles(e.target.files)}
            className="visually-hidden"
          />
        </label>
        <label className="image-upload-button image-upload-button--secondary">
          {libraryLabel}
          <input
            ref={libraryInputRef}
            type="file"
            accept={acceptString}
            multiple
            onChange={(e) => onFiles(e.target.files)}
            className="visually-hidden"
          />
        </label>
      </div>
      {hint && <p className="journal-hint">{hint}</p>}
      {uploading && <p className="journal-hint">Uploading…</p>}
      {error && <p className="journal-err">{error}</p>}
      {analyseError && <p className="journal-err">{analyseError}</p>}
      {items.length === 0 ? (
        <p className="journal-hint">{emptyHint}</p>
      ) : (
        <ul className="image-upload-list">
          {items.map((u) => {
            const linked = getLinkedId(u) != null;
            const showAnalyse = canAnalyse && !linked;
            const busy = analysingId === u.id;
            return (
              <li key={u.id}>
                {renderThumb(u)}
                <button
                  type="button"
                  className="supplement-delete"
                  aria-label="Delete upload"
                  onClick={() => onDelete(u.id)}
                >
                  ×
                </button>
                {showAnalyse && (
                  <button
                    type="button"
                    className="image-analyse-pill"
                    onClick={() => kind === "genome" ? startGenomeParse(u.id) : openPreflight(u.id)}
                    disabled={busy || draft !== null || pending !== null}
                  >
                    {busy ? (kind === "genome" ? "Parsing…" : "Analysing…") : (kind === "genome" ? "Parse" : "Analyse")}
                  </button>
                )}
                {linked && <span className="image-linked-badge">Logged</span>}
              </li>
            );
          })}
        </ul>
      )}
      {pending && (
        <div className="meal-analysis-preflight">
          {renderPreflightPreview(pending.uploadId)}
          <label className="journal-field">
            <span className="stat-label">Context for the AI (optional)</span>
            <textarea
              rows={3}
              value={pending.note}
              onChange={(e) =>
                setPending({ ...pending, note: e.target.value })
              }
              placeholder={preflightPlaceholder}
              disabled={analysingId !== null}
            />
          </label>
          <div className="journal-actions">
            <button
              type="button"
              onClick={runAnalyse}
              disabled={analysingId !== null}
            >
              {analysingId !== null ? "Analysing… (~10s)" : "Analyse"}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setPending(null)}
              disabled={analysingId !== null}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {draft?.kind === "meal" && (
        <MealAnalysisDraft
          result={draft.result}
          uploadId={draft.uploadId}
          date={date}
          defsByCategory={defsByCategory}
          onSaved={onDraftSaved}
          onCancel={() => setDraft(null)}
        />
      )}
      {draft?.kind === "form" && (
        <FormCheckAnalysisDraft
          result={draft.result}
          uploadId={draft.uploadId}
          date={date}
          onSaved={onDraftSaved}
          onCancel={() => setDraft(null)}
        />
      )}
      {draft?.kind === "bloodwork" && (
        <BloodworkAnalysisDraft
          result={draft.result}
          uploadId={draft.uploadId}
          fallbackDate={date}
          onSaved={onDraftSaved}
          onCancel={() => setDraft(null)}
        />
      )}
      {draft?.kind === "genome" && (
        <GenomeParseDraft
          result={draft.result}
          uploadId={draft.uploadId}
          fallbackDate={date}
          onSaved={onDraftSaved}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}
