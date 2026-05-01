import { format, subYears } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import {
  createBloodPressure,
  deleteBloodPressure,
  listBloodPressure,
} from "../api";
import type { BloodPressureEntry } from "../types";

const today = format(new Date(), "yyyy-MM-dd");
const twoYearsAgo = format(subYears(new Date(), 2), "yyyy-MM-dd");

interface FormState {
  date: string;
  time: string;
  systolic: string;
  diastolic: string;
  pulse: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  date: today,
  time: "",
  systolic: "",
  diastolic: "",
  pulse: "",
  notes: "",
};

export function BloodPressureForm() {
  const [recent, setRecent] = useState<BloodPressureEntry[]>([]);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await listBloodPressure(twoYearsAgo, today);
      setRecent(rows.slice(-5).reverse());
    } catch {
      // silently degrade
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitEntry(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setSaved(false);
    const systolic = parseInt(form.systolic, 10);
    const diastolic = parseInt(form.diastolic, 10);
    if (isNaN(systolic) || systolic <= 0) {
      setError("Systolic must be a positive number");
      return;
    }
    if (isNaN(diastolic) || diastolic <= 0) {
      setError("Diastolic must be a positive number");
      return;
    }
    if (systolic <= diastolic) {
      setError("Systolic must exceed diastolic");
      return;
    }
    let pulse: number | null = null;
    if (form.pulse.trim() !== "") {
      const p = parseInt(form.pulse, 10);
      if (isNaN(p) || p <= 0) {
        setError("Pulse must be a positive number");
        return;
      }
      pulse = p;
    }
    try {
      await createBloodPressure({
        date: form.date,
        time: form.time || null,
        systolic_mmhg: systolic,
        diastolic_mmhg: diastolic,
        pulse_bpm: pulse,
        notes: form.notes || null,
      });
      setForm((f) => ({
        ...f,
        time: "",
        systolic: "",
        diastolic: "",
        pulse: "",
        notes: "",
      }));
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function deleteEntry(id: number) {
    await deleteBloodPressure(id);
    await load();
  }

  return (
    <div>
      <p className="longevity-disclaimer">
        Not a medical device. For self-tracking and trend awareness only.
        Consult a qualified clinician before making health decisions.
      </p>

      <form className="longevity-form" onSubmit={submitEntry}>
        <div className="longevity-form-row">
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            required
          />
          <input
            type="time"
            value={form.time}
            onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
            aria-label="Time (optional)"
          />
          <input
            type="number"
            step="1"
            min="50"
            max="260"
            placeholder="Systolic (mmHg)"
            value={form.systolic}
            onChange={(e) => setForm((f) => ({ ...f, systolic: e.target.value }))}
            required
          />
          <input
            type="number"
            step="1"
            min="30"
            max="180"
            placeholder="Diastolic (mmHg)"
            value={form.diastolic}
            onChange={(e) => setForm((f) => ({ ...f, diastolic: e.target.value }))}
            required
          />
          <input
            type="number"
            step="1"
            min="20"
            max="220"
            placeholder="Pulse (bpm, optional)"
            value={form.pulse}
            onChange={(e) => setForm((f) => ({ ...f, pulse: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <button type="submit" className="longevity-add-btn">
            Add
          </button>
        </div>
        {error && <div className="longevity-form-error">{error}</div>}
        {saved && !error && (
          <div className="longevity-form-success">Reading saved.</div>
        )}
      </form>

      {recent.length > 0 && (
        <div className="longevity-entry-list">
          <div className="longevity-entry-list-title">Recent readings</div>
          {recent.map((e) => (
            <div key={e.id} className="longevity-entry-row">
              <span className="longevity-entry-date">
                {e.date}
                {e.time ? ` ${e.time}` : ""}
              </span>
              <span
                className="longevity-entry-value"
                style={{ color: "#ef4444" }}
              >
                {e.systolic_mmhg}/{e.diastolic_mmhg} mmHg
              </span>
              {e.pulse_bpm != null && (
                <span className="longevity-entry-meta">
                  pulse {e.pulse_bpm} bpm
                </span>
              )}
              {e.notes && (
                <span className="longevity-entry-meta">{e.notes}</span>
              )}
              <button
                className="longevity-delete-btn"
                onClick={() => deleteEntry(e.id)}
                aria-label="Delete entry"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
