import { format, subYears } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "./Card";
import {
  createBiologicalAge,
  createGripStrength,
  deleteBiologicalAge,
  deleteGripStrength,
  fetchLongevityAnalytes,
  fetchVo2Max,
  listBiologicalAge,
  listGripStrength,
} from "../api";
import type {
  BiologicalAgeEntry,
  GripStrengthEntry,
  LongevityAnalyte,
  Vo2MaxEntry,
} from "../types";

const today = format(new Date(), "yyyy-MM-dd");
const tenYearsAgo = format(subYears(new Date(), 10), "yyyy-MM-dd");
const twoYearsAgo = format(subYears(new Date(), 2), "yyyy-MM-dd");

const CLOCK_NAMES = ["GrimAge", "Horvath", "PhenoAge", "DunedinPACE", "TelomereLength"];

const CLOCK_COLORS: Record<string, string> = {
  GrimAge: "#ef4444",
  Horvath: "#f97316",
  PhenoAge: "#eab308",
  DunedinPACE: "#8b5cf6",
  TelomereLength: "#22c55e",
};

const CATEGORY_LABELS: Record<string, string> = {
  cardiovascular: "Cardiovascular",
  inflammation: "Inflammation",
  metabolic: "Metabolic",
  hemostasis: "Hemostasis",
};

const FLAG_COLORS: Record<string, string> = {
  low: "#3b82f6",
  normal: "#22c55e",
  high: "#f97316",
  critical: "#ef4444",
};

const TOOLTIP_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 8,
};

function ClockChart({
  clockName,
  entries,
  onDelete,
}: {
  clockName: string;
  entries: BiologicalAgeEntry[];
  onDelete: (id: number) => void;
}) {
  const color = CLOCK_COLORS[clockName] ?? "#64748b";
  const isDunedinPace = clockName === "DunedinPACE";
  const isTelomere = clockName === "TelomereLength";

  const chartData = entries.map((e) => ({
    date: e.date,
    value: e.value,
    chronological_age: e.chronological_age,
  }));

  const formatValue = (v: number) => {
    if (isDunedinPace) return v.toFixed(3);
    if (isTelomere) return v.toFixed(2) + " kb";
    return v.toFixed(1) + " yrs";
  };

  return (
    <div className="longevity-clock-chart">
      <div className="longevity-clock-header">
        <h3 style={{ color }}>{clockName}</h3>
        {isDunedinPace && (
          <span className="longevity-dunedin-note">
            1.0 = aging at chronological rate · below 1.0 = deceleration
          </span>
        )}
        {isTelomere && (
          <span className="longevity-dunedin-note">kilobases (kb)</span>
        )}
      </div>

      <div className="chart-wrap" style={{ "--chart-h": "220px" } as React.CSSProperties}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "#e2e8f0" }}
              itemStyle={{ color: "#cbd5e1" }}
            />
            {isDunedinPace && (
              <ReferenceLine
                y={1}
                stroke="#64748b"
                strokeDasharray="6 3"
                label={{ value: "1.0 baseline", fill: "#94a3b8", fontSize: 10, position: "insideTopRight" }}
              />
            )}
            {entries.some((e) => e.chronological_age != null) && (
              <Line
                type="monotone"
                dataKey="chronological_age"
                name="Chronological age"
                stroke="#475569"
                dot={false}
                strokeDasharray="4 2"
                connectNulls
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              name={isDunedinPace ? "Pace" : "Biological age"}
              stroke={color}
              dot={{ r: 4, fill: color }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {entries.length > 0 && (
        <div className="longevity-entry-list">
          {[...entries].reverse().map((e) => (
            <div key={e.id} className="longevity-entry-row">
              <span className="longevity-entry-date">{e.date}</span>
              <span className="longevity-entry-value" style={{ color }}>
                {formatValue(e.value)}
              </span>
              {e.chronological_age != null && (
                <span className="longevity-entry-meta">
                  chron: {e.chronological_age.toFixed(1)}
                </span>
              )}
              {e.notes && (
                <span className="longevity-entry-meta">{e.notes}</span>
              )}
              <button
                className="longevity-delete-btn"
                onClick={() => onDelete(e.id)}
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

function AnalyteCard({ analyte }: { analyte: LongevityAnalyte }) {
  const flagColor =
    analyte.last_flag ? (FLAG_COLORS[analyte.last_flag] ?? "#e2e8f0") : "#e2e8f0";
  const hasTrend = analyte.history.length > 1;
  const deltaSign =
    analyte.delta != null && analyte.delta > 0 ? "+" : "";

  return (
    <div className="longevity-analyte-card">
      <div className="longevity-analyte-header">
        <span className="longevity-analyte-name">{analyte.analyte}</span>
        <span className="longevity-analyte-category">
          {CATEGORY_LABELS[analyte.category] ?? analyte.category}
        </span>
      </div>

      <div className="longevity-analyte-value" style={{ color: flagColor }}>
        {analyte.last_value < 10
          ? analyte.last_value.toFixed(3)
          : analyte.last_value.toFixed(1)}
        {analyte.unit && (
          <span className="longevity-analyte-unit"> {analyte.unit}</span>
        )}
      </div>

      {analyte.delta != null && (
        <div
          className={`longevity-analyte-delta ${analyte.delta > 0 ? "delta-up" : "delta-down"}`}
        >
          {deltaSign}
          {Math.abs(analyte.delta) < 1
            ? analyte.delta.toFixed(3)
            : analyte.delta.toFixed(1)}{" "}
          vs baseline
        </div>
      )}

      <div className="longevity-analyte-date">{analyte.last_date}</div>

      {hasTrend && (
        <div className="longevity-sparkline">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={analyte.history}
              margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
            >
              <Line
                type="monotone"
                dataKey="value"
                stroke={flagColor}
                dot={false}
                strokeWidth={1.5}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface ClockFormState {
  date: string;
  clock_name: string;
  value: string;
  chronological_age: string;
  notes: string;
}

interface GripFormState {
  date: string;
  hand: "left" | "right" | "both";
  strength_kg: string;
  notes: string;
}

export function LongevitySection() {
  const [entries, setEntries] = useState<BiologicalAgeEntry[]>([]);
  const [analytes, setAnalytes] = useState<LongevityAnalyte[]>([]);
  const [gripEntries, setGripEntries] = useState<GripStrengthEntry[]>([]);
  const [vo2maxData, setVo2MaxData] = useState<Vo2MaxEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<ClockFormState>({
    date: today,
    clock_name: "DunedinPACE",
    value: "",
    chronological_age: "",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const [gripForm, setGripForm] = useState<GripFormState>({
    date: today,
    hand: "both",
    strength_kg: "",
    notes: "",
  });
  const [gripError, setGripError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bioAge, lAnalytes, grip, vo2] = await Promise.all([
        listBiologicalAge(tenYearsAgo, today),
        fetchLongevityAnalytes(),
        listGripStrength(twoYearsAgo, today),
        fetchVo2Max(twoYearsAgo, today),
      ]);
      setEntries(bioAge);
      setAnalytes(lAnalytes);
      setGripEntries(grip);
      setVo2MaxData(vo2);
    } catch {
      // silently degrade
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byClockName: Record<string, BiologicalAgeEntry[]> = {};
  for (const e of entries) {
    if (!byClockName[e.clock_name]) byClockName[e.clock_name] = [];
    byClockName[e.clock_name].push(e);
  }

  async function submitClockEntry(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const value = parseFloat(form.value);
    if (isNaN(value)) {
      setFormError("Value must be a number");
      return;
    }
    try {
      await createBiologicalAge({
        date: form.date,
        clock_name: form.clock_name,
        value,
        chronological_age: form.chronological_age
          ? parseFloat(form.chronological_age)
          : null,
        notes: form.notes || null,
      });
      setForm((f) => ({
        ...f,
        value: "",
        chronological_age: "",
        notes: "",
      }));
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function deleteEntry(id: number) {
    await deleteBiologicalAge(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function submitGripEntry(ev: React.FormEvent) {
    ev.preventDefault();
    setGripError(null);
    const kg = parseFloat(gripForm.strength_kg);
    if (isNaN(kg) || kg <= 0) {
      setGripError("Strength must be a positive number");
      return;
    }
    try {
      await createGripStrength({
        date: gripForm.date,
        hand: gripForm.hand,
        strength_kg: kg,
        notes: gripForm.notes || null,
      });
      setGripForm((f) => ({ ...f, strength_kg: "", notes: "" }));
      await load();
    } catch (e) {
      setGripError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function deleteGripEntry(id: number) {
    await deleteGripStrength(id);
    setGripEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div>
      <p className="longevity-disclaimer">
        Not a medical device. For self-tracking and trend awareness only.
        Consult a qualified clinician before making health decisions.
      </p>

      {/* Epigenetic Clocks */}
      <Card id="orient.longevity-clocks" className="chart-section">
        <CardHeader id="orient.longevity-clocks" level="h2">Epigenetic Clocks</CardHeader>

        <form className="longevity-form" onSubmit={submitClockEntry}>
          <div className="longevity-form-row">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              required
            />
            <select
              value={form.clock_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, clock_name: e.target.value }))
              }
            >
              {CLOCK_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              placeholder={
                form.clock_name === "DunedinPACE"
                  ? "Pace (e.g. 0.82)"
                  : form.clock_name === "TelomereLength"
                  ? "Length (kb)"
                  : "Biological age (yrs)"
              }
              value={form.value}
              onChange={(e) =>
                setForm((f) => ({ ...f, value: e.target.value }))
              }
              required
            />
            <input
              type="number"
              step="any"
              placeholder="Chronological age"
              value={form.chronological_age}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  chronological_age: e.target.value,
                }))
              }
            />
            <input
              type="text"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
            <button type="submit" className="longevity-add-btn">
              Add
            </button>
          </div>
          {formError && (
            <div className="longevity-form-error">{formError}</div>
          )}
        </form>

        {loading && <div className="chart-loading">Loading…</div>}

        {!loading && Object.keys(byClockName).length === 0 && (
          <p className="longevity-empty">
            No clock readings yet. Enter your first result above.
          </p>
        )}

        {Object.entries(byClockName).map(([clock, clockEntries]) => (
          <ClockChart
            key={clock}
            clockName={clock}
            entries={clockEntries}
            onDelete={deleteEntry}
          />
        ))}
      </Card>

      {/* Longevity analytes from bloodwork */}
      <Card id="orient.longevity-analytes" className="chart-section">
        <CardHeader id="orient.longevity-analytes" level="h2">Longevity Analytes</CardHeader>
        <p className="longevity-section-note">
          Auto-populated from bloodwork panels. Upload a panel containing ApoB,
          Lp(a), hs-CRP, homocysteine, fibrinogen, or other longevity markers to
          see them here.
        </p>

        {analytes.length === 0 ? (
          <p className="longevity-empty">
            No longevity analytes found in bloodwork panels yet.
          </p>
        ) : (
          <div className="longevity-analytes-grid">
            {analytes.map((a) => (
              <AnalyteCard key={a.analyte} analyte={a} />
            ))}
          </div>
        )}
      </Card>

      {/* VO₂ max from Garmin */}
      {vo2maxData.length > 0 && (
        <Card id="orient.longevity-vo2max" className="chart-section">
          <CardHeader id="orient.longevity-vo2max" level="h2">VO₂ Max (Garmin)</CardHeader>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vo2maxData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
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
                  dataKey="value"
                  name="VO₂ max (ml/kg/min)"
                  stroke="#22c55e"
                  dot={{ r: 4, fill: "#22c55e" }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Grip strength */}
      <Card id="orient.longevity-grip" className="chart-section">
        <CardHeader id="orient.longevity-grip" level="h2">Grip Strength</CardHeader>

        <form className="longevity-form" onSubmit={submitGripEntry}>
          <div className="longevity-form-row">
            <input
              type="date"
              value={gripForm.date}
              onChange={(e) =>
                setGripForm((f) => ({ ...f, date: e.target.value }))
              }
              required
            />
            <select
              value={gripForm.hand}
              onChange={(e) =>
                setGripForm((f) => ({
                  ...f,
                  hand: e.target.value as "left" | "right" | "both",
                }))
              }
            >
              <option value="both">Both hands</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
            <input
              type="number"
              step="any"
              min="0"
              placeholder="Strength (kg)"
              value={gripForm.strength_kg}
              onChange={(e) =>
                setGripForm((f) => ({ ...f, strength_kg: e.target.value }))
              }
              required
            />
            <input
              type="text"
              placeholder="Notes (optional)"
              value={gripForm.notes}
              onChange={(e) =>
                setGripForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
            <button type="submit" className="longevity-add-btn">
              Add
            </button>
          </div>
          {gripError && (
            <div className="longevity-form-error">{gripError}</div>
          )}
        </form>

        {gripEntries.length > 0 && (
          <>
            <div
              className="chart-wrap"
              style={{ "--chart-h": "200px" } as React.CSSProperties}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={gripEntries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="date"
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
                    dataKey="strength_kg"
                    name="Grip (kg)"
                    stroke="#8b5cf6"
                    dot={{ r: 4, fill: "#8b5cf6" }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="longevity-entry-list">
              {[...gripEntries].reverse().map((e) => (
                <div key={e.id} className="longevity-entry-row">
                  <span className="longevity-entry-date">{e.date}</span>
                  <span
                    className="longevity-entry-value"
                    style={{ color: "#8b5cf6" }}
                  >
                    {e.strength_kg} kg
                  </span>
                  <span className="longevity-entry-meta">{e.hand}</span>
                  {e.notes && (
                    <span className="longevity-entry-meta">{e.notes}</span>
                  )}
                  <button
                    className="longevity-delete-btn"
                    onClick={() => deleteGripEntry(e.id)}
                    aria-label="Delete entry"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {gripEntries.length === 0 && !loading && (
          <p className="longevity-empty">No grip strength entries yet.</p>
        )}
      </Card>
    </div>
  );
}
