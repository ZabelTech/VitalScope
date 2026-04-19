import { useState } from "react";
import { createGenomeUpload } from "../api";
import type { GenomeParseResult, GenomeUploadInput } from "../types";

interface Props {
  result: GenomeParseResult;
  uploadId: number;
  fallbackDate: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function GenomeParseDraft({ result, uploadId, fallbackDate, onSaved, onCancel }: Props) {
  const [date, setDate] = useState<string>(fallbackDate);
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    setErr(null);
    const body: GenomeUploadInput = {
      date,
      source_upload_id: uploadId,
      variant_count: result.variant_count,
      rs_count: result.rs_count,
      chromosomes: result.chromosomes,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      await createGenomeUpload(body);
      onSaved();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="meal-analysis-draft">
      <div className="meal-analysis-draft-header">
        <span className="stat-label">VCF parsed successfully</span>
      </div>

      <div className="genome-parse-stats">
        <div className="genome-parse-stat">
          <span className="genome-parse-stat-value">{result.variant_count.toLocaleString()}</span>
          <span className="genome-parse-stat-label">variants</span>
        </div>
        <div className="genome-parse-stat">
          <span className="genome-parse-stat-value">{result.rs_count.toLocaleString()}</span>
          <span className="genome-parse-stat-label">with RS ID</span>
        </div>
        <div className="genome-parse-stat">
          <span className="genome-parse-stat-value">{result.chromosomes.length}</span>
          <span className="genome-parse-stat-label">chromosomes</span>
        </div>
      </div>

      {result.chromosomes.length > 0 && (
        <p className="journal-hint genome-chrom-list">
          {result.chromosomes.slice(0, 30).join(", ")}
          {result.chromosomes.length > 30 ? ` +${result.chromosomes.length - 30} more` : ""}
        </p>
      )}

      <label className="journal-field">
        <span className="stat-label">Sample date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <label className="journal-field">
        <span className="stat-label">Notes (optional)</span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. 23andMe v5 chip, whole exome sequencing"
        />
      </label>

      {err && <p className="journal-err">{err}</p>}

      <div className="journal-actions">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save genome"}
        </button>
        <button type="button" className="chip" onClick={onCancel} disabled={saving}>
          Discard
        </button>
      </div>
    </div>
  );
}
