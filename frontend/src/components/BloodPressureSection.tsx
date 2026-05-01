import { format, subYears } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  createBloodPressure,
  deleteBloodPressure,
  listBloodPressure,
} from "../api";
import type { BloodPressureEntry } from "../types";

const today = format(new Date(), "yyyy-MM-dd");
const twoYearsAgo = format(subYears(new Date(), 2), "yyyy-MM-dd");

const TOOLTIP_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 8,
};

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

export function BloodPressureSection() {
  const [entries, setEntries] = useState<BloodPressureEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listBloodPressure(twoYearsAgo, today);
      setEntries(rows);
    } catch {
      // silently degrade
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitEntry(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function deleteEntry(id: number) {
    await deleteBloodPressure(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const hasPulse = entries.some((e) => e.pulse_bpm != null);

  const chartData = entries.map((e) => ({
    label: e.time ? `${e.date} ${e.time}` : e.date,
    systolic_mmhg: e.systolic_mmhg,
    diastolic_mmhg: e.diastolic_mmhg,
    pulse_bpm: e.pulse_bpm,
  }));

  return (
    <div>
      <p className="longevity-disclaimer">
        Not a medical device. For self-tracking and trend awareness only.
        Consult a qualified clinician before making health decisions.
      </p>

      <div className="chart-section">
        <h2>Blood Pressure</h2>

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
        </form>

        {entries.length > 0 && (
          <>
            <div
              className="chart-wrap"
              style={{ "--chart-h": "240px" } as React.CSSProperties}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="systolic_mmhg"
                    name="Systolic (mmHg)"
                    stroke="#ef4444"
                    dot={{ r: 4, fill: "#ef4444" }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="diastolic_mmhg"
                    name="Diastolic (mmHg)"
                    stroke="#3b82f6"
                    dot={{ r: 4, fill: "#3b82f6" }}
                    connectNulls
                  />
                  {hasPulse && (
                    <Line
                      type="monotone"
                      dataKey="pulse_bpm"
                      name="Pulse (bpm)"
                      stroke="#22c55e"
                      dot={{ r: 3, fill: "#22c55e" }}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="longevity-entry-list">
              {[...entries].reverse().map((e) => (
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
          </>
        )}

        {entries.length === 0 && !loading && (
          <p className="longevity-empty">No blood pressure entries yet.</p>
        )}
      </div>
    </div>
  );
}
