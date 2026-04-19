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

function PluginCard({
  plugin,
  onChanged,
}: {
  plugin: PluginConfig;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(plugin.enabled);
  const [intervalMin, setIntervalMin] = useState(plugin.interval_minutes);
  const [params, setParams] = useState<Record<string, unknown>>(plugin.params);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [runs, setRuns] = useState<PluginRun[]>([]);

  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [capturedAvg, setCapturedAvg] = useState<number | null>(null);
  const [runFlash, setRunFlash] = useState<"ok" | "error" | null>(null);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  function stopTracking() {
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current !== null) { clearInterval(tickRef.current); tickRef.current = null; }
    setActiveRunId(null);
    setElapsed(0);
  }

  function startTracking(runId: number, avg: number | null) {
    const startedAt = Date.now();
    setActiveRunId(runId);
    setElapsed(0);
    setCapturedAvg(avg);

    tickRef.current = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);

    pollRef.current = window.setInterval(async () => {
      try {
        const recent = await listPluginRuns(plugin.name, 5);
        const ourRun = recent.find((r) => r.id === runId);
        if (ourRun && ourRun.finished_at !== null) {
          stopTracking();
          setRunFlash(ourRun.status === "ok" ? "ok" : "error");
          setTimeout(() => {
            setRunFlash(null);
            onChanged();
            loadRuns();
          }, 1500);
        }
      } catch {
        // ignore transient errors
      }
    }, 2000);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
      if (tickRef.current !== null) clearInterval(tickRef.current);
    };
  }, []);

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

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updatePlugin(plugin.name, {
        enabled,
        interval_minutes: intervalMin,
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
      const result = await runPluginNow(plugin.name);
      startTracking(result.run_id, plugin.avg_duration_seconds);
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    }
  }

  function updateParam(key: string, value: unknown) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  function etaText(): string {
    if (capturedAvg === null) {
      return `Running for ${elapsed}s`;
    }
    const remaining = Math.round(capturedAvg - elapsed);
    if (remaining <= 0) return "Almost done…";
    return `~${remaining}s remaining`;
  }

  const cardClass =
    "card" +
    (runFlash === "ok" ? " plugin-flash-ok" : runFlash === "error" ? " plugin-flash-error" : "");

  return (
    <section className={cardClass} style={{ padding: "1rem", margin: "1rem 0" }}>
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

      {activeRunId !== null && (
        <div className="plugin-progress-bar">
          <div className="plugin-progress-bar-inner" />
        </div>
      )}

      <div style={{ display: "grid", gap: "0.75rem", margin: "1rem 0" }}>
        <label style={{ display: "flex", flexDirection: "column" }}>
          <span>Interval (minutes)</span>
          <input
            type="number"
            min={1}
            value={intervalMin}
            onChange={(e) => setIntervalMin(parseInt(e.target.value || "0", 10))}
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
        <button onClick={handleSave} disabled={saving || activeRunId !== null}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={handleRun} disabled={saving || activeRunId !== null}>
          {activeRunId !== null ? "Running…" : "Run now"}
        </button>
        {activeRunId !== null && (
          <span className="plugin-eta">{etaText()}</span>
        )}
        {saveMsg && activeRunId === null && (
          <span style={{ opacity: 0.8 }}>{saveMsg}</span>
        )}
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
