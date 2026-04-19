import { useEffect, useRef, useState } from "react";
import {
  listPlugins,
  listPluginRuns,
  runPluginNow,
  updatePlugin,
  type PluginConfig,
  type PluginParamSpec,
  type PluginRun,
} from "../api";
import { useRuntime } from "../hooks/useRuntime";

export function SettingsPage() {
  const runtime = useRuntime();
  const [plugins, setPlugins] = useState<PluginConfig[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");

  async function reload() {
    try {
      setPlugins(await listPlugins());
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  if (runtime?.demo) {
    return (
      <div className="journal-page">
        <div className="trends-header">
          <h2>Settings — Sync Plugins</h2>
        </div>
        <section className="overview-card" style={{ margin: "1rem 0" }}>
          <h3>Demo preview</h3>
          <div className="overview-card-body">
            <p>
              Sync plugin configuration is disabled in demo mode — this environment
              runs against a synthetic database and cannot reach Garmin Connect,
              Strong, or EufyLife.
            </p>
            <p style={{ opacity: 0.7, fontSize: "0.9em", marginTop: "0.75rem" }}>
              Run locally to configure real sync credentials.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="journal-page">
      <div className="trends-header">
        <h2>Settings — Sync Plugins</h2>
      </div>
      {status === "loading" && <p>Loading…</p>}
      {status === "error" && <p className="journal-err">Failed to load plugins</p>}
      {plugins.map((p) => (
        <PluginCard key={p.name} plugin={p} onChanged={reload} />
      ))}
    </div>
  );
}

interface ActiveRun {
  runId: number;
  startedAt: Date;
  estimatedSeconds: number;
}

function formatEta(startedAt: Date, estimatedSeconds: number): string {
  const elapsed = (Date.now() - startedAt.getTime()) / 1000;
  const remaining = estimatedSeconds - elapsed;
  if (remaining <= 5) return "almost done…";
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  return mins > 0 ? `~${mins}m ${secs}s remaining` : `~${secs}s remaining`;
}

function PluginCard({
  plugin,
  onChanged,
}: {
  plugin: PluginConfig;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(plugin.enabled);
  const [interval, setInterval] = useState(plugin.interval_minutes);
  const [params, setParams] = useState<Record<string, unknown>>(plugin.params);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [runs, setRuns] = useState<PluginRun[]>([]);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [etaDisplay, setEtaDisplay] = useState<string>("");
  const [flashStatus, setFlashStatus] = useState<"ok" | "error" | null>(null);
  const stopRef = useRef(false);

  async function loadRuns() {
    try {
      setRuns(await listPluginRuns(plugin.name, 5));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadRuns();
  }, [plugin.name, plugin.last_run_at]);

  useEffect(() => {
    if (!activeRun) return;
    stopRef.current = false;

    setEtaDisplay(formatEta(activeRun.startedAt, activeRun.estimatedSeconds));

    const etaTimer = setInterval(() => {
      if (stopRef.current) return;
      setEtaDisplay(formatEta(activeRun.startedAt, activeRun.estimatedSeconds));
    }, 1000);

    const pollTimer = setInterval(async () => {
      if (stopRef.current) return;
      try {
        const recent = await listPluginRuns(plugin.name, 10);
        const run = recent.find((r) => r.id === activeRun.runId);
        if (run && run.finished_at !== null) {
          stopRef.current = true;
          clearInterval(etaTimer);
          clearInterval(pollTimer);
          setActiveRun(null);
          setFlashStatus(run.status === "ok" ? "ok" : "error");
          setTimeout(() => {
            setFlashStatus(null);
            onChanged();
            loadRuns();
          }, 1500);
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);

    return () => {
      stopRef.current = true;
      clearInterval(etaTimer);
      clearInterval(pollTimer);
    };
  }, [activeRun]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updatePlugin(plugin.name, {
        enabled,
        interval_minutes: interval,
        params,
      });
      setSaveMsg("Saved");
      onChanged();
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    setSaveMsg(null);
    try {
      const { run_id, started_at } = await runPluginNow(plugin.name);
      const estimatedSeconds = plugin.avg_duration_seconds ?? plugin.baseline_first_run_seconds;
      setActiveRun({
        runId: run_id,
        startedAt: new Date(started_at),
        estimatedSeconds,
      });
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    }
  }

  function updateParam(key: string, value: unknown) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  const busy = saving || activeRun !== null;

  return (
    <section
      className={`card${flashStatus ? ` card-flash-${flashStatus}` : ""}`}
      style={{ padding: "1rem", margin: "1rem 0" }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h3 style={{ margin: 0 }}>{plugin.label}</h3>
          {plugin.description && (
            <p style={{ margin: "0.25rem 0", opacity: 0.7, fontSize: "0.9em" }}>
              {plugin.description}
            </p>
          )}
        </div>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </header>

      {activeRun && (
        <div className="plugin-progress">
          <div className="plugin-progress-bar" />
          <span className="plugin-eta">{etaDisplay || "estimating…"}</span>
        </div>
      )}

      <div style={{ display: "grid", gap: "0.75rem", margin: "1rem 0" }}>
        <label style={{ display: "flex", flexDirection: "column" }}>
          <span>Interval (minutes)</span>
          <input
            type="number"
            min={1}
            value={interval}
            onChange={(e) => setInterval(parseInt(e.target.value || "0", 10))}
          />
        </label>
        {plugin.param_schema.map((spec) => (
          <ParamField
            key={spec.key}
            spec={spec}
            value={params[spec.key]}
            onChange={(v) => updateParam(spec.key, v)}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button onClick={handleSave} disabled={busy}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={handleRun} disabled={busy}>
          {activeRun ? "Running…" : "Run now"}
        </button>
        {saveMsg && <span style={{ opacity: 0.8 }}>{saveMsg}</span>}
      </div>

      <div style={{ marginTop: "0.75rem", fontSize: "0.85em", opacity: 0.8 }}>
        <div>
          Last run:{" "}
          {plugin.last_run_at ? (
            <>
              {plugin.last_run_at} — <b>{plugin.last_status}</b>
              {plugin.last_message ? ` — ${plugin.last_message}` : ""}
            </>
          ) : (
            "never"
          )}
          {plugin.avg_duration_seconds !== null && (
            <span style={{ marginLeft: "0.75rem", opacity: 0.6 }}>
              (avg {plugin.avg_duration_seconds}s)
            </span>
          )}
        </div>
        {runs.length > 0 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary>Recent runs ({runs.length})</summary>
            <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
              {runs.map((r) => (
                <li key={r.id}>
                  {r.started_at} → {r.status}
                  {r.message ? ` — ${r.message}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function ParamField({
  spec,
  value,
  onChange,
}: {
  spec: PluginParamSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (spec.type === "bool") {
    return (
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {spec.label}
      </label>
    );
  }
  const inputType =
    spec.type === "secret" ? "password" : spec.type === "int" ? "number" : "text";
  return (
    <label style={{ display: "flex", flexDirection: "column" }}>
      <span>
        {spec.label}
        {spec.required && " *"}
      </span>
      <input
        type={inputType}
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const v = e.target.value;
          onChange(spec.type === "int" ? (v === "" ? "" : parseInt(v, 10)) : v);
        }}
      />
    </label>
  );
}
