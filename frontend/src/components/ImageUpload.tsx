import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeMealImage,
  deleteUpload,
  fetchUploads,
  listNutrientDefs,
  uploadImage,
  uploadImageUrl,
} from "../api";
import type {
  MealAnalysisResult,
  NutrientCategory,
  NutrientDef,
  Upload,
  UploadKind,
} from "../types";
import { useRuntime } from "../hooks/useRuntime";
import { MealAnalysisDraft } from "./MealAnalysisDraft";

interface Props {
  kind: UploadKind;
  date: string;
  label: string;
  hint?: string;
}

export function ImageUpload({ kind, date, label, hint }: Props) {
  const runtime = useRuntime();
  const [items, setItems] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [analysingId, setAnalysingId] = useState<number | null>(null);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ result: MealAnalysisResult; uploadId: number } | null>(null);
  /** Preflight state — user clicked Analyse on a thumbnail and is about to
   *  add optional context before firing the Claude call. */
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

  const canAnalyse = kind === "meal" && runtime?.ai_available === true;

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
        if (!f.type.startsWith("image/")) {
          setError(`${f.name} is not an image`);
          continue;
        }
        if (f.size > 5 * 1024 * 1024) {
          setError(`${f.name} exceeds 5 MB`);
          continue;
        }
        await uploadImage(kind, date, f);
      }
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
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

  async function runAnalyse() {
    if (!pending) return;
    const { uploadId, note } = pending;
    setAnalyseError(null);
    setAnalysingId(uploadId);
    try {
      const result = await analyzeMealImage(uploadId, note);
      setDraft({ result, uploadId });
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
  }

  return (
    <div className="image-upload">
      <div className="image-upload-header">
        <span className="stat-label">{label}</span>
      </div>
      <label className="image-upload-button">
        Take photo
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={(e) => onFiles(e.target.files)}
          className="visually-hidden"
        />
      </label>
      {hint && <p className="journal-hint">{hint}</p>}
      {uploading && <p className="journal-hint">Uploading…</p>}
      {error && <p className="journal-err">{error}</p>}
      {analyseError && <p className="journal-err">{analyseError}</p>}
      {items.length === 0 ? (
        <p className="journal-hint">No {kind === "meal" ? "meal" : "form"} photos yet.</p>
      ) : (
        <ul className="image-upload-list">
          {items.map((u) => {
            const linked = u.meal_id != null;
            const showAnalyse = canAnalyse && !linked;
            const busy = analysingId === u.id;
            return (
              <li key={u.id}>
                <img src={uploadImageUrl(u.id)} alt="" loading="lazy" />
                <button
                  type="button"
                  className="supplement-delete"
                  aria-label="Delete image"
                  onClick={() => onDelete(u.id)}
                >
                  ×
                </button>
                {showAnalyse && (
                  <button
                    type="button"
                    className="image-analyse-pill"
                    onClick={() => openPreflight(u.id)}
                    disabled={busy || draft !== null || pending !== null}
                  >
                    {busy ? "Analysing…" : "Analyse"}
                  </button>
                )}
                {linked && <span className="image-linked-badge">Logged</span>}
              </li>
            );
          })}
        </ul>
      )}
      {pending && kind === "meal" && (
        <div className="meal-analysis-preflight">
          <img
            className="meal-analysis-preflight-img"
            src={uploadImageUrl(pending.uploadId)}
            alt=""
          />
          <label className="journal-field">
            <span className="stat-label">Context for the AI (optional)</span>
            <textarea
              rows={3}
              value={pending.note}
              onChange={(e) =>
                setPending({ ...pending, note: e.target.value })
              }
              placeholder="e.g. ~200g salmon, 150g jasmine rice, olive oil, no sauce"
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
      {draft && kind === "meal" && (
        <MealAnalysisDraft
          result={draft.result}
          uploadId={draft.uploadId}
          date={date}
          defsByCategory={defsByCategory}
          onSaved={onDraftSaved}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}
