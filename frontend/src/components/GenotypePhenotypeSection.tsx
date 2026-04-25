import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchGenotypePhenotype } from "../api";
import type { ConvergencePanel, GenotypePhenotypeData } from "../types";

const RISK_COLOR: Record<string, string> = {
  high: "#ef4444",
  elevated: "#f97316",
  low: "#22c55e",
};

const RISK_LABEL: Record<string, string> = {
  high: "High risk",
  elevated: "Elevated",
  low: "Standard",
};

const LINE_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f97316"];

function RiskBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const color = RISK_COLOR[level] ?? "#64748b";
  return (
    <span
      className="conv-risk-badge"
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
    >
      {RISK_LABEL[level] ?? level}
    </span>
  );
}

function BloodworkChart({ panel }: { panel: ConvergencePanel }) {
  const { bloodwork } = panel;
  if (bloodwork.length === 0) {
    const analyte_hint =
      panel.id === "apoe"
        ? "LDL-C / ApoB / Lp(a)"
        : panel.id === "mthfr"
          ? "Homocysteine / B12 / Folate"
          : panel.id === "vdr"
            ? "25(OH)D"
            : panel.id === "fads"
              ? "Omega-3 / EPA / DHA"
              : "relevant analytes";
    return (
      <p className="conv-empty-state">
        No bloodwork data for {analyte_hint} yet.
      </p>
    );
  }

  const analytes = [...new Set(bloodwork.map((b) => b.analyte))];
  const byDate = new Map<string, Record<string, unknown>>();
  for (const b of bloodwork) {
    if (!byDate.has(b.date)) byDate.set(b.date, { date: b.date });
    byDate.get(b.date)![b.analyte] = b.value;
  }
  const chartData = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );

  return (
    <div className="conv-chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {analytes.map((analyte, i) => (
            <Line
              key={analyte}
              type="monotone"
              dataKey={analyte}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              dot={{ r: 4 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrainingWidget({ panel }: { panel: ConvergencePanel }) {
  const wearable = panel.wearable;
  if (!wearable || wearable.type !== "weekly_volume" || !wearable.data || !wearable.data.length) {
    return <p className="conv-empty-state">No workout data available.</p>;
  }
  const data = wearable.data.slice(-12);
  return (
    <div className="conv-chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="week_start" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="volume_kg"
            name="Volume (kg)"
            stroke="#8b5cf6"
            dot={{ r: 3 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PanelPhenotype({ panel }: { panel: ConvergencePanel }) {
  if (panel.id === "actn3") return <TrainingWidget panel={panel} />;
  if (panel.id === "cyp1a2") {
    return (
      <p className="conv-empty-state">
        Caffeine intake logging is not yet available. The genotype context above applies when
        logging is active.
      </p>
    );
  }
  if (panel.id === "fads" && panel.bloodwork.length === 0) {
    const names = panel.wearable?.names ?? [];
    if (names.length === 0) {
      return (
        <p className="conv-empty-state">
          No omega-3 analytes in bloodwork and no omega-3 supplements logged. Consider
          pre-formed EPA/DHA (fish oil, algal oil) given this genotype.
        </p>
      );
    }
    return (
      <p className="conv-supp-note">
        Omega-3 supplements logged: {names.join(", ")}
      </p>
    );
  }
  return <BloodworkChart panel={panel} />;
}

function GenotypeBadge({ panel }: { panel: ConvergencePanel }) {
  const { variants_found, rs_ids, interpretation, risk_level } = panel;
  if (variants_found.length === 0) {
    return (
      <p className="conv-genotype-missing">
        Variants not detected in genome file ({rs_ids.join(", ")})
      </p>
    );
  }
  return (
    <div className="conv-genotype-row">
      {interpretation && (
        <span className="conv-genotype-label">{interpretation}</span>
      )}
      <RiskBadge level={risk_level} />
      <div className="conv-rs-tags">
        {variants_found.map((v) => (
          <span key={v.rs_id} className="conv-rs-tag">
            {v.rs_id}
            {v.genotype ? ` (${v.genotype})` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function PanelCard({ panel }: { panel: ConvergencePanel }) {
  const [open, setOpen] = useState(true);
  const accent =
    panel.interpretation
      ? (RISK_COLOR[panel.risk_level ?? ""] ?? "#64748b")
      : "#475569";
  return (
    <div className="conv-panel" style={{ borderLeftColor: accent }}>
      <button
        type="button"
        className="conv-panel-header"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="conv-panel-label">{panel.label}</span>
        <span className="conv-panel-toggle">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="conv-panel-body">
          <p className="conv-description">{panel.description}</p>
          <GenotypeBadge panel={panel} />
          {panel.risk_note && <p className="conv-risk-note">{panel.risk_note}</p>}
          <PanelPhenotype panel={panel} />
        </div>
      )}
    </div>
  );
}

export function GenotypePhenotypeSection() {
  const [data, setData] = useState<GenotypePhenotypeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGenotypePhenotype()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="chart-loading">Loading genotype × phenotype…</div>;

  if (error) {
    return (
      <div className="orient-ai-error">
        <span>{error}</span>
      </div>
    );
  }

  if (!data || !data.has_genome) {
    return (
      <div className="overview-card">
        <p className="journal-hint">
          No genome file uploaded yet. Upload an annotated VCF with RS IDs in the Observe →
          Genome section to unlock genotype × phenotype convergence panels.
        </p>
      </div>
    );
  }

  return (
    <div className="conv-panels">
      {data.panels.map((panel) => (
        <PanelCard key={panel.id} panel={panel} />
      ))}
    </div>
  );
}
