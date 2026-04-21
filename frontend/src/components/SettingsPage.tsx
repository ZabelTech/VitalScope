import { useEffect, useRef, useState } from "react";
import {
  createJournalQuestion,
  deleteJournalQuestion,
  getAiSettings,
  listJournalQuestions,
  listPlugins,
  listPluginRuns,
  runPluginNow,
  updateAiSettings,
  updateJournalQuestion,
  updatePlugin,
  type PluginConfig,
  type PluginParamSpec,
  type PluginRun,
} from "../api";
import { refreshRuntime, useRuntime } from "../hooks/useRuntime";
import type { AiEffort, AiProvider, AiSettings, JournalQuestion } from "../types";

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

  return (
    <div className="journal-page">
      <div className="trends-header">
        <h2>Settings</h2>
      </div>
      <AiConfigCard demo={runtime?.demo ?? false} />
      <JournalConfigCard />
      <ExportCard />
      {status === "loading" && <p>Loading…</p>}
      {status === "error" && <p className="journal-err">Failed to load plugins</p>}
      {plugins.map((p) => (
        <PluginCard key={p.name} plugin={p} demo={runtime?.demo ?? false} onChanged={reload} />
      ))}
    </div>
  );
}

const EXPORT_DOMAINS = [
  "heart-rate", "hrv", "sleep", "stress", "body-battery",
  "steps", "weight", "workouts", "activities", "meals",
  "water", "supplements", "journal", "bloodwork", "genome-variants",
] as const;

function ExportCard() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="card" style={{ padding: "1rem", margin: "1rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
        <div>
          <h3 style={{ margin: "0 0 0.2rem" }}>Export Your Data</h3>
          <p style={{ margin: 0, opacity: 0.7, fontSize: "0.9em" }}>
            Download your health data in standard formats. No account deletion required.
          </p>
        </div>
        <a href="/api/export/archive.zip" download style={{ flexShrink: 0 }}>
          <button type="button">Download everything</button>
        </a>
      </div>

      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: "0.85em", opacity: 0.7, display: "flex", alignItems: "center", gap: "0.3rem" }}
        >
          <span>{expanded ? "▾" : "▸"}</span>
          <span>Individual domains</span>
        </button>

        {expanded && (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {EXPORT_DOMAINS.map((domain) => (
              <div key={domain} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ flex: 1, fontSize: "0.9em", fontFamily: "monospace" }}>{domain}</span>
                <a href={`/api/export/${domain}.csv`} download style={{ fontSize: "0.8em" }}>
                  <button type="button" style={{ padding: "0.2rem 0.5rem", fontSize: "0.8em" }}>CSV</button>
                </a>
                <a href={`/api/export/${domain}.json`} download style={{ fontSize: "0.8em" }}>
                  <button type="button" style={{ padding: "0.2rem 0.5rem", fontSize: "0.8em" }}>JSON</button>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function JournalConfigCard() {
  const [collapsed, setCollapsed] = useState(true);
  const [questions, setQuestions] = useState<JournalQuestion[]>([]);
  const [editTexts, setEditTexts] = useState<Record<number, string>>({});
  const [newQuestion, setNewQuestion] = useState("");
  const [adding, setAdding] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  async function reload() {
    try {
      const qs = await listJournalQuestions();
      setQuestions(qs);
      const texts: Record<number, string> = {};
      qs.forEach((q) => { texts[q.id] = q.question; });
      setEditTexts(texts);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newQuestion.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await createJournalQuestion(trimmed, questions.length);
      setNewQuestion("");
      await reload();
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(q: JournalQuestion) {
    const text = editTexts[q.id]?.trim();
    if (!text || text === q.question) return;
    setSavingId(q.id);
    try {
      await updateJournalQuestion(q.id, text, q.sort_order);
      await reload();
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: number) {
    await deleteJournalQuestion(id);
    await reload();
  }

  return (
    <section className="card" style={{ padding: "1rem", margin: "1rem 0" }}>
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.8em", opacity: 0.6, lineHeight: 1 }}>{collapsed ? "▸" : "▾"}</span>
          <div>
            <h3 style={{ margin: 0 }}>Journal Configuration</h3>
            <p style={{ margin: "0.1rem 0 0", opacity: 0.7, fontSize: "0.9em" }}>
              Custom questions shown in the daily journal
            </p>
          </div>
        </div>
      </header>

      {!collapsed && (
        <div style={{ marginTop: "1rem" }}>
          {questions.length === 0 && (
            <p style={{ opacity: 0.6, fontSize: "0.9em", margin: "0 0 0.75rem" }}>No custom questions yet.</p>
          )}
          {questions.map((q) => (
            <div key={q.id} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                value={editTexts[q.id] ?? q.question}
                onChange={(e) => setEditTexts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                onBlur={() => handleSave(q)}
                disabled={savingId === q.id}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => handleDelete(q.id)}
                disabled={savingId === q.id}
                style={{ whiteSpace: "nowrap", flexShrink: 0 }}
              >
                ×
              </button>
            </div>
          ))}
          <form onSubmit={handleAdd} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <input
              type="text"
              placeholder="New question…"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={adding || !newQuestion.trim()}>
              Add
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

const PROVIDER_DEFAULTS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  openrouter: "anthropic/claude-sonnet-4.6",
};

const PROVIDER_MODELS: Record<AiProvider, string[]> = {
  anthropic: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-20241022",
    "claude-3-haiku-20240307",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "o1-preview",
    "o1-mini",
    "gpt-4-turbo",
  ],
  openrouter: [
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.7",
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "meta-llama/llama-3.1-70b-instruct",
    "google/gemini-pro-1.5",
  ],
};

function activeKeyHint(settings: AiSettings | null, provider: AiProvider): string | null {
  if (!settings) return null;
  if (provider === "anthropic") return settings.anthropic_key_hint;
  if (provider === "openai") return settings.openai_key_hint;
  return settings.openrouter_key_hint;
}

function AiConfigCard({ demo }: { demo: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<AiEffort>("medium");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyClear, setApiKeyClear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    getAiSettings().then((s) => {
      setSettings(s);
      setProvider(s.provider);
      setModel(s.model);
      setEffort(s.effort ?? "medium");
    }).catch(() => {});
  }, []);

  function handleProviderChange(p: AiProvider) {
    setProvider(p);
    setApiKey("");
    setApiKeyClear(false);
    if (!model || model === PROVIDER_DEFAULTS[provider]) {
      setModel(PROVIDER_DEFAULTS[p]);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const keyVal = apiKeyClear ? "" : (apiKey || null);
      const updated = await updateAiSettings({
        provider,
        model,
        effort,
        anthropic_api_key: provider === "anthropic" ? keyVal : undefined,
        openai_api_key: provider === "openai" ? keyVal : undefined,
        openrouter_api_key: provider === "openrouter" ? keyVal : undefined,
      });
      setSettings(updated);
      setApiKey("");
      setApiKeyClear(false);
      setSaveMsg("Saved");
      refreshRuntime();
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  const keyHint = activeKeyHint(settings, provider);
  const modelListId = `model-list-${provider}`;

  return (
    <section className="card" style={{ padding: "1rem", margin: "1rem 0" }}>
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.8em", opacity: 0.6, lineHeight: 1 }}>{collapsed ? "▸" : "▾"}</span>
          <div>
            <h3 style={{ margin: 0 }}>AI Configuration</h3>
            <p style={{ margin: "0.1rem 0 0", opacity: 0.7, fontSize: "0.9em" }}>
              Provider, model, and API keys for AI analysis features
            </p>
          </div>
        </div>
      </header>

      {!collapsed && (
        <div style={{ marginTop: "1rem" }}>
          {demo && (
            <p style={{ fontSize: "0.85em", color: "#94a3b8", background: "#0f172a", borderRadius: "6px", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
              AI configuration is locked in demo mode.
            </p>
          )}
          <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column" }}>
              <span>Provider</span>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                disabled={demo}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column" }}>
              <span>Model</span>
              <input
                type="text"
                list={modelListId}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={demo}
                placeholder={PROVIDER_DEFAULTS[provider]}
              />
              <datalist id={modelListId}>
                {PROVIDER_MODELS[provider].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <label style={{ display: "flex", flexDirection: "column" }}>
              <span>API Key</span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="password"
                  value={apiKey}
                  placeholder={keyHint ? "unchanged" : "not set"}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={demo}
                  style={{ flex: 1 }}
                />
                {keyHint && !apiKeyClear && (
                  <button
                    onClick={() => { setApiKey(""); setApiKeyClear(true); }}
                    disabled={demo}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {keyHint && (
                <span style={{ fontSize: "0.8em", opacity: 0.6, marginTop: "0.2rem" }}>
                  Current: {keyHint}
                </span>
              )}
            </label>

            <label style={{ display: "flex", flexDirection: "column" }}>
              <span>Effort</span>
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value as AiEffort)}
                disabled={demo}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button onClick={handleSave} disabled={demo || saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {saveMsg && <span style={{ opacity: 0.8 }}>{saveMsg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function PluginCard({
  plugin,
  demo,
  onChanged,
}: {
  plugin: PluginConfig;
  demo: boolean;
  onChanged: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
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

  async function handleFullResync() {
    setSaveMsg(null);
    try {
      const result = await runPluginNow(plugin.name, true);
      startTracking(result.run_id, null);
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
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.8em", opacity: 0.6, lineHeight: 1 }}>{collapsed ? "▸" : "▾"}</span>
          <div>
            <h3 style={{ margin: 0 }}>{plugin.label}</h3>
            {plugin.description && (
              <p style={{ margin: "0.1rem 0 0", opacity: 0.7, fontSize: "0.9em" }}>
                {plugin.description}
              </p>
            )}
          </div>
        </div>
        <label
          style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </header>

      {!collapsed && (
        <>
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

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={handleSave} disabled={demo || saving || activeRunId !== null}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={handleRun} disabled={saving || activeRunId !== null}>
              {activeRunId !== null ? "Running…" : "Run now"}
            </button>
            <button
              onClick={handleFullResync}
              disabled={saving || activeRunId !== null}
              style={{ background: "#7c3aed" }}
            >
              {activeRunId !== null ? "Running…" : "Full resync"}
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
        </>
      )}
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
