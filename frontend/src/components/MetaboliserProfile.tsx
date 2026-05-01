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
import {
  createCaffeineIntake,
  deleteCaffeineIntake,
  deleteCypPhenotype,
  fetchConcentrationCurve,
  fetchPharmacogenomicsProfile,
  setCypPhenotype,
} from "../api";
import type {
  CaffeineIntake,
  ConcentrationCurve,
  CypProfileEntry,
  PharmacogenomicsProfile,
} from "../types";
import { Card, CardHeader } from "./Card";

interface Props {
  date: string;
}

const CAFFEINE_SOURCES = [
  "Coffee",
  "Espresso",
  "Tea",
  "Energy drink",
  "Pre-workout",
  "Supplement",
  "Other",
];

const PHENOTYPE_COLOR: Record<string, string> = {
  ultra_rapid: "#22c55e",
  extensive: "#3b82f6",
  intermediate: "#f97316",
  poor: "#ef4444",
};

function CypCard({
  entry,
  onSave,
}: {
  entry: CypProfileEntry;
  onSave: (cyp: string, phenotype: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(entry.phenotype);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(entry.cyp, selected);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(entry.cyp, null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const color = PHENOTYPE_COLOR[entry.phenotype] ?? "#94a3b8";

  return (
    <div className="cyp-card">
      <div className="cyp-card-header">
        <span className="cyp-card-name">{entry.cyp}</span>
        <span
          className="cyp-phenotype-badge"
          style={{
            color,
            borderColor: color + "40",
            background: color + "18",
          }}
        >
          {entry.phenotype_label}
        </span>
        {entry.is_default && <span className="cyp-default-badge">assumed</span>}
      </div>
      <p className="cyp-description">{entry.description}</p>
      <p className="cyp-substrates">
        <span className="stat-label">Substrates: </span>
        {entry.substrates.join(", ")}
      </p>
      {!editing ? (
        <button
          type="button"
          className="cyp-edit-btn"
          onClick={() => {
            setSelected(entry.phenotype);
            setEditing(true);
          }}
        >
          Set phenotype
        </button>
      ) : (
        <div className="cyp-edit-panel">
          <div className="cyp-phenotype-options">
            {entry.all_phenotypes.map((opt) => (
              <label key={opt.key} className="cyp-phenotype-option">
                <input
                  type="radio"
                  name={`cyp-${entry.cyp}`}
                  value={opt.key}
                  checked={selected === opt.key}
                  onChange={() => setSelected(opt.key)}
                />
                <span className="cyp-opt-label">{opt.label}</span>
                {opt.half_life_hours != null && (
                  <span className="cyp-opt-hl">t½ {opt.half_life_hours}h</span>
                )}
              </label>
            ))}
          </div>
          <div className="cyp-edit-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              Save
            </button>
            {!entry.is_default && (
              <button
                type="button"
                className="btn-ghost"
                onClick={reset}
                disabled={saving}
              >
                Reset to default
              </button>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CaffeineQuickAdd({
  date,
  onAdded,
}: {
  date: string;
  onAdded: (intake: CaffeineIntake) => void;
}) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [mg, setMg] = useState("100");
  const [source, setSource] = useState("Coffee");
  const [time, setTime] = useState(() => {
    if (date !== todayISO) return "08:00";
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });
  const [saving, setSaving] = useState(false);

  async function add() {
    const mgNum = parseFloat(mg);
    if (!mgNum || mgNum <= 0 || saving) return;
    setSaving(true);
    try {
      const intake = await createCaffeineIntake({ date, time, mg: mgNum, source });
      onAdded(intake);
      setMg("100");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="caffeine-quick-add">
      <input
        type="number"
        className="caffeine-mg-input"
        value={mg}
        onChange={(e) => setMg(e.target.value)}
        min="1"
        max="2000"
        placeholder="mg"
      />
      <select
        className="caffeine-source-select"
        value={source}
        onChange={(e) => setSource(e.target.value)}
      >
        {CAFFEINE_SOURCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        type="time"
        className="caffeine-time-input"
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary"
        onClick={add}
        disabled={saving || !parseFloat(mg)}
      >
        Log
      </button>
    </div>
  );
}

export function MetaboliserProfile({ date }: Props) {
  const [profile, setProfile] = useState<PharmacogenomicsProfile | null>(null);
  const [curve, setCurve] = useState<ConcentrationCurve | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, c] = await Promise.all([
        fetchPharmacogenomicsProfile(),
        fetchConcentrationCurve(date),
      ]);
      setProfile(p);
      setCurve(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handlePhenotypeChange(cyp: string, phenotype: string | null) {
    if (phenotype === null) {
      await deleteCypPhenotype(cyp);
    } else {
      await setCypPhenotype({ cyp, phenotype });
    }
    await load();
  }

  function refreshCurve() {
    fetchConcentrationCurve(date).then(setCurve).catch(() => {});
  }

  function handleIntakeAdded(_intake: CaffeineIntake) {
    refreshCurve();
  }

  async function handleDeleteIntake(id: number) {
    await deleteCaffeineIntake(id);
    refreshCurve();
  }

  if (loading) return <div className="chart-loading">Loading metaboliser profile…</div>;
  if (error) return <p className="journal-err">{error}</p>;
  if (!profile || !curve) return null;

  const cyp1a2 = profile.cyps.find((c) => c.cyp === "CYP1A2");
  const warningCyps = profile.cyps.filter(
    (c) => !c.is_default && c.phenotype !== "extensive"
  );

  const todayISO = new Date().toISOString().slice(0, 10);
  const nowHour = date === todayISO ? new Date().getHours() : null;
  const totalMg = curve.intakes.reduce((s, i) => s + i.mg, 0);
  const currentMg =
    nowHour != null
      ? (curve.curve.find((p) => p.hours_since_midnight === nowHour)?.concentration_mg ?? 0)
      : null;

  const chartData = curve.curve.map((pt) => {
    const base = curve.baseline_curve?.find(
      (b) => b.hours_since_midnight === pt.hours_since_midnight
    );
    return { ...pt, baseline_mg: base?.concentration_mg };
  });

  const hasAnyData = curve.curve.some((p) => p.concentration_mg > 0);

  return (
    <div className="metaboliser-profile">
      {!profile.has_genome && (
        <div className="pharma-genome-nudge">
          <strong>No genome file uploaded.</strong> Phenotypes below are assumed defaults (extensive metaboliser). Upload a VCF in the Genome section to enable auto-detection in a future update.
        </div>
      )}

      {warningCyps.map((c) => (
        <div key={c.cyp} className="pharma-warning-chip">
          <strong>
            {c.cyp} · {c.phenotype_label}
          </strong>{" "}
          — substrates include {c.substrates.slice(0, 3).join(", ")} and others. Space doses and consider lower starting amounts.
          <span className="pharma-disclaimer-inline">Context only — not medical advice.</span>
        </div>
      ))}

      <div className="pharma-section-title">Caffeine clearance · {date}</div>

      <div className="metric-cards">
        <Card id="observe.caffeine-total">
          <CardHeader id="observe.caffeine-total" />
          <div className="stat-label">Total logged</div>
          <div className="stat-value">
            {totalMg} <span className="stat-unit">mg</span>
          </div>
        </Card>
        {currentMg != null && (
          <Card id="observe.caffeine-current">
            <CardHeader id="observe.caffeine-current" />
            <div className="stat-label">Est. in system now</div>
            <div className="stat-value">
              {currentMg.toFixed(0)} <span className="stat-unit">mg</span>
            </div>
          </Card>
        )}
        {cyp1a2 && (
          <Card id="observe.caffeine-cyp1a2">
            <CardHeader id="observe.caffeine-cyp1a2" />
            <div className="stat-label">CYP1A2 phenotype</div>
            <div
              className="stat-value"
              style={{
                color: PHENOTYPE_COLOR[cyp1a2.phenotype] ?? "#94a3b8",
                fontSize: "0.95rem",
                lineHeight: 1.3,
              }}
            >
              {cyp1a2.is_default ? "Assumed extensive" : cyp1a2.phenotype_label}
            </div>
            {cyp1a2.half_life_hours != null && (
              <div className="stat-label">t½ {cyp1a2.half_life_hours}h</div>
            )}
          </Card>
        )}
      </div>

      {hasAnyData ? (
        <div className="caffeine-chart">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={{ stroke: "#334155" }}
                interval={3}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={{ stroke: "#334155" }}
                tickFormatter={(v) => `${v}mg`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  fontSize: 12,
                }}
                formatter={(v, name) => [
                  `${Number(v).toFixed(1)} mg`,
                  name === "concentration_mg" ? "Your clearance" : "Extensive baseline",
                ]}
              />
              {nowHour != null && (
                <ReferenceLine
                  x={`${String(nowHour).padStart(2, "0")}:00`}
                  stroke="#94a3b8"
                  strokeDasharray="4 2"
                  label={{ value: "now", fontSize: 10, fill: "#94a3b8", position: "top" }}
                />
              )}
              <Line
                type="monotone"
                dataKey="concentration_mg"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="concentration_mg"
              />
              {curve.baseline_curve && (
                <Line
                  type="monotone"
                  dataKey="baseline_mg"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls
                  name="baseline_mg"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
          <div className="caffeine-chart-legend">
            <span style={{ color: "#f97316" }}>— Your clearance rate</span>
            {curve.baseline_curve && (
              <span style={{ color: "#3b82f6" }}>--- Extensive metaboliser baseline</span>
            )}
          </div>
        </div>
      ) : (
        <p className="pharma-empty-hint">Log caffeine below to see the clearance curve.</p>
      )}

      <div className="pharma-section-title">Log caffeine</div>
      <CaffeineQuickAdd date={date} onAdded={handleIntakeAdded} />

      {curve.intakes.length > 0 && (
        <div className="caffeine-log">
          {curve.intakes.map((intake) => (
            <div key={intake.id} className="caffeine-log-item">
              <span className="caffeine-log-time">{intake.time?.slice(0, 5) ?? "--:--"}</span>
              <span className="caffeine-log-mg">{intake.mg} mg</span>
              {intake.source && (
                <span className="caffeine-log-source">{intake.source}</span>
              )}
              <button
                type="button"
                className="caffeine-log-delete"
                onClick={() => handleDeleteIntake(intake.id)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="pharma-section-title">Metaboliser phenotypes</div>
      <div className="cyp-cards">
        {profile.cyps.map((entry) => (
          <CypCard key={entry.cyp} entry={entry} onSave={handlePhenotypeChange} />
        ))}
      </div>

      <p className="pharma-disclaimer">
        This section provides context on how your metabolism may affect clearance rates. It is not medical advice — consult a healthcare professional for clinical decisions.
      </p>
    </div>
  );
}
