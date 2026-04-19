import { useState } from "react";
import { createBloodworkPanel } from "../api";
import type {
  BloodworkAnalysisResult,
  BloodworkFlag,
  BloodworkPanelInput,
  BloodworkResult,
} from "../types";

interface Props {
  result: BloodworkAnalysisResult;
  uploadId: number;
  /** Fallback date used when the AI couldn't extract collection_date. */
  fallbackDate: string;
  onSaved: () => void;
  onCancel: () => void;
}

const FLAG_OPTIONS: { value: BloodworkFlag | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numStr(v: number | null): string {
  return v === null || v === undefined ? "" : String(v);
}

export function BloodworkAnalysisDraft({
  result,
  uploadId,
  fallbackDate,
  onSaved,
  onCancel,
}: Props) {
  const [date, setDate] = useState<string>(result.collection_date || fallbackDate);
  const [labName, setLabName] = useState<string>(result.lab_name || "");
  const [notes, setNotes] = useState<string>(result.notes || "");
  const [rows, setRows] = useState<BloodworkResult[]>(
    result.results.length > 0
      ? result.results
      : [
          {
            analyte: "",
            value: null,
            value_text: null,
            unit: null,
            reference_low: null,
            reference_high: null,
            reference_text: null,
            flag: null,
          },
        ],
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function updateRow(idx: number, patch: Partial<BloodworkResult>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        analyte: "",
        value: null,
        value_text: null,
        unit: null,
        reference_low: null,
        reference_high: null,
        reference_text: null,
        flag: null,
      },
    ]);
  }

  async function onSave() {
    setErr(null);
    const cleaned = rows
      .map((r) => ({
        ...r,
        analyte: r.analyte.trim(),
      }))
      .filter((r) => r.analyte.length > 0);
    if (cleaned.length === 0) {
      setErr("Add at least one analyte before saving.");
      return;
    }
    const body: BloodworkPanelInput = {
      date,
      source: "bloodwork-ai",
      source_upload_id: uploadId,
      lab_name: labName.trim() || null,
      notes: notes.trim() || null,
      confidence: result.confidence,
      results: cleaned,
    };
    setSaving(true);
    try {
      await createBloodworkPanel(body);
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
        <span className={`confidence-badge confidence-${result.confidence}`}>
          {result.confidence} confidence
        </span>
        <span className="journal-hint">Model: {result.model}</span>
      </div>

      <label className="journal-field">
        <span className="stat-label">Collection date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <label className="journal-field">
        <span className="stat-label">Lab</span>
        <input
          type="text"
          value={labName}
          onChange={(e) => setLabName(e.target.value)}
          placeholder="e.g. Synlab, Quest Diagnostics"
        />
      </label>

      <div className="bloodwork-draft-table-wrap">
        <table className="bloodwork-draft-table">
          <thead>
            <tr>
              <th>Analyte</th>
              <th>Value</th>
              <th>Unit</th>
              <th>Ref low</th>
              <th>Ref high</th>
              <th>Flag</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className={r.flag ? `bloodwork-flag-${r.flag}` : undefined}>
                <td>
                  <input
                    type="text"
                    value={r.analyte}
                    onChange={(e) => updateRow(idx, { analyte: e.target.value })}
                    placeholder="e.g. HDL Cholesterol"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={r.value !== null ? numStr(r.value) : r.value_text || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const n = numOrNull(v);
                      if (n !== null) {
                        updateRow(idx, { value: n, value_text: null });
                      } else if (v.trim() === "") {
                        updateRow(idx, { value: null, value_text: null });
                      } else {
                        updateRow(idx, { value: null, value_text: v });
                      }
                    }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={r.unit || ""}
                    onChange={(e) => updateRow(idx, { unit: e.target.value || null })}
                    placeholder="mg/dL"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={numStr(r.reference_low)}
                    onChange={(e) =>
                      updateRow(idx, { reference_low: numOrNull(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={numStr(r.reference_high)}
                    onChange={(e) =>
                      updateRow(idx, { reference_high: numOrNull(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <select
                    value={r.flag || ""}
                    onChange={(e) =>
                      updateRow(idx, {
                        flag: (e.target.value || null) as BloodworkFlag | null,
                      })
                    }
                  >
                    {FLAG_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="supplement-delete"
                    aria-label="Remove row"
                    onClick={() => removeRow(idx)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="chip" onClick={addRow}>
          + Add analyte
        </button>
      </div>

      <label className="journal-field">
        <span className="stat-label">Notes</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {err && <p className="journal-err">{err}</p>}

      <div className="journal-actions">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save panel"}
        </button>
        <button type="button" className="chip" onClick={onCancel} disabled={saving}>
          Discard
        </button>
      </div>
    </div>
  );
}
