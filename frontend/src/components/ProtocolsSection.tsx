import { useEffect, useState } from "react";
import {
  createProtocol,
  createProtocolEvent,
  deleteProtocol,
  deleteProtocolEvent,
  listProtocolEvents,
  listProtocols,
} from "../api";
import type { Protocol, ProtocolCategory, ProtocolEvent, ProtocolEventInput, ProtocolInput } from "../types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateStr: string): number {
  const start = new Date(dateStr + "T00:00:00");
  const now = new Date(todayISO() + "T00:00:00");
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
}

const CATEGORY_LABELS: Record<ProtocolCategory, string> = {
  drug: "Drug",
  peptide: "Peptide",
  ped: "PED",
  supplement_stack: "Stack",
  hormesis: "Hormesis",
  fasting: "Fasting",
  training_block: "Training",
};

const CATEGORY_COLORS: Record<ProtocolCategory, string> = {
  drug: "#8b5cf6",
  peptide: "#3b82f6",
  ped: "#f97316",
  supplement_stack: "#22c55e",
  hormesis: "#f59e0b",
  fasting: "#06b6d4",
  training_block: "#ec4899",
};

const ALL_CATEGORIES: ProtocolCategory[] = [
  "drug", "peptide", "ped", "supplement_stack", "hormesis", "fasting", "training_block",
];

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface QuickEntry {
  duration: string;
  temp: string;
  start: string;
  end: string;
  status: SaveStatus;
}

const BLANK_QUICK: QuickEntry = { duration: "", temp: "", start: "", end: "", status: "idle" };

// Finds an existing system protocol or creates one on first use.
async function findOrCreateQuick(
  protocols: Protocol[],
  name: string,
  category: ProtocolCategory,
  today: string
): Promise<{ proto: Protocol; isNew: boolean }> {
  const existing = protocols.find((p) => p.name === name && p.category === category);
  if (existing) return { proto: existing, isNew: false };
  const proto = await createProtocol({ name, category, start_date: today });
  return { proto, isNew: true };
}

export function ProtocolsSection() {
  const today = todayISO();
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [todayEvents, setTodayEvents] = useState<ProtocolEvent[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "idle" | "error">("loading");

  const [zone2, setZone2] = useState<QuickEntry>({ ...BLANK_QUICK });
  const [sauna, setSauna] = useState<QuickEntry>({ ...BLANK_QUICK });
  const [cold, setCold] = useState<QuickEntry>({ ...BLANK_QUICK });
  const [tre, setTre] = useState<QuickEntry>({ ...BLANK_QUICK });

  // Log-event inline form: keyed by protocol id
  const [logOpen, setLogOpen] = useState<number | null>(null);
  const [logDate, setLogDate] = useState(today);
  const [logDose, setLogDose] = useState("");
  const [logDur, setLogDur] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logSaving, setLogSaving] = useState(false);

  // Add-protocol form
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState<ProtocolCategory>("drug");
  const [addDose, setAddDose] = useState("");
  const [addUnit, setAddUnit] = useState("");
  const [addCadence, setAddCadence] = useState("");
  const [addStart, setAddStart] = useState(today);
  const [addNotes, setAddNotes] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  async function reload() {
    try {
      const [ps, evts] = await Promise.all([
        listProtocols(),
        listProtocolEvents({ start: today, end: today }),
      ]);
      setProtocols(ps);
      setTodayEvents(evts);
      setLoadStatus("idle");
    } catch {
      setLoadStatus("error");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  // --- Quick-log handlers ---

  async function logZone2() {
    const mins = parseInt(zone2.duration, 10);
    if (!mins || mins <= 0) return;
    setZone2((s) => ({ ...s, status: "saving" }));
    try {
      const { proto, isNew } = await findOrCreateQuick(protocols, "Zone 2", "hormesis", today);
      if (isNew) setProtocols((ps) => [...ps, proto]);
      await createProtocolEvent({ protocol_id: proto.id, date: today, duration_minutes: mins });
      setZone2({ ...BLANK_QUICK, status: "saved" });
      await reload();
      setTimeout(() => setZone2(BLANK_QUICK), 2000);
    } catch {
      setZone2((s) => ({ ...s, status: "error" }));
    }
  }

  async function logSauna() {
    const mins = parseInt(sauna.duration, 10);
    if (!mins || mins <= 0) return;
    setSauna((s) => ({ ...s, status: "saving" }));
    try {
      const { proto, isNew } = await findOrCreateQuick(protocols, "Sauna", "hormesis", today);
      if (isNew) setProtocols((ps) => [...ps, proto]);
      const dose = sauna.temp ? `${sauna.temp}°C` : undefined;
      await createProtocolEvent({ protocol_id: proto.id, date: today, dose, duration_minutes: mins });
      setSauna({ ...BLANK_QUICK, status: "saved" });
      await reload();
      setTimeout(() => setSauna(BLANK_QUICK), 2000);
    } catch {
      setSauna((s) => ({ ...s, status: "error" }));
    }
  }

  async function logCold() {
    const mins = parseInt(cold.duration, 10);
    if (!mins || mins <= 0) return;
    setCold((s) => ({ ...s, status: "saving" }));
    try {
      const { proto, isNew } = await findOrCreateQuick(protocols, "Cold Plunge", "hormesis", today);
      if (isNew) setProtocols((ps) => [...ps, proto]);
      const dose = cold.temp ? `${cold.temp}°C` : undefined;
      await createProtocolEvent({ protocol_id: proto.id, date: today, dose, duration_minutes: mins });
      setCold({ ...BLANK_QUICK, status: "saved" });
      await reload();
      setTimeout(() => setCold(BLANK_QUICK), 2000);
    } catch {
      setCold((s) => ({ ...s, status: "error" }));
    }
  }

  async function logTre() {
    if (!tre.start) return;
    setTre((s) => ({ ...s, status: "saving" }));
    try {
      const { proto, isNew } = await findOrCreateQuick(protocols, "TRE", "fasting", today);
      if (isNew) setProtocols((ps) => [...ps, proto]);
      let durationMins: number | undefined;
      if (tre.start && tre.end) {
        const [sh, sm] = tre.start.split(":").map(Number);
        const [eh, em] = tre.end.split(":").map(Number);
        const startMins = sh * 60 + sm;
        let endMins = eh * 60 + em;
        if (endMins < startMins) endMins += 24 * 60;
        durationMins = endMins - startMins;
      }
      const notes = tre.end ? `end: ${tre.end}` : undefined;
      await createProtocolEvent({
        protocol_id: proto.id,
        date: today,
        time: tre.start,
        duration_minutes: durationMins,
        notes,
      });
      setTre({ ...BLANK_QUICK, status: "saved" });
      await reload();
      setTimeout(() => setTre(BLANK_QUICK), 2000);
    } catch {
      setTre((s) => ({ ...s, status: "error" }));
    }
  }

  // --- Protocol log form ---

  function openLog(p: Protocol) {
    setLogOpen(p.id);
    setLogDate(today);
    setLogDose(p.dose ?? "");
    setLogDur("");
    setLogNotes("");
  }

  async function submitLog() {
    if (logOpen == null) return;
    setLogSaving(true);
    try {
      const event: ProtocolEventInput = {
        protocol_id: logOpen,
        date: logDate,
        dose: logDose.trim() || undefined,
        duration_minutes: logDur ? parseInt(logDur, 10) : undefined,
        notes: logNotes.trim() || undefined,
      };
      await createProtocolEvent(event);
      setLogOpen(null);
      await reload();
    } finally {
      setLogSaving(false);
    }
  }

  // --- Add protocol form ---

  async function submitAddProtocol(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAddSaving(true);
    try {
      const body: ProtocolInput = {
        name: addName.trim(),
        category: addCategory,
        dose: addDose.trim() || undefined,
        unit: addUnit.trim() || undefined,
        cadence: addCadence.trim() || undefined,
        start_date: addStart,
        notes: addNotes.trim() || undefined,
      };
      await createProtocol(body);
      setAddName("");
      setAddDose("");
      setAddUnit("");
      setAddCadence("");
      setAddStart(today);
      setAddNotes("");
      setAddOpen(false);
      await reload();
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDeleteProtocol(id: number) {
    await deleteProtocol(id);
    await reload();
  }

  async function handleDeleteEvent(id: number) {
    await deleteProtocolEvent(id);
    await reload();
  }

  const activeProtocols = protocols.filter((p) => !p.end_date || p.end_date >= today);
  const archivedProtocols = protocols.filter((p) => p.end_date && p.end_date < today);

  if (loadStatus === "error") {
    return <div className="journal-err">Failed to load protocols.</div>;
  }

  return (
    <div className="journal-page">
      {/* Quick-log hormesis */}
      <div className="overview-card journal-form">
        <h3 className="stat-label">Quick Log</h3>
        <div className="protocol-quick-grid">
          {/* Zone 2 */}
          <div className="protocol-quick-card">
            <span className="protocol-quick-label">Zone 2</span>
            <div className="protocol-quick-inputs">
              <div className="protocol-quick-field">
                <input
                  type="number"
                  min="1"
                  placeholder="min"
                  value={zone2.duration}
                  onChange={(e) => setZone2((s) => ({ ...s, duration: e.target.value }))}
                />
                <span className="protocol-quick-unit">min</span>
              </div>
            </div>
            <button
              className="protocol-quick-btn"
              disabled={!zone2.duration || zone2.status === "saving"}
              onClick={logZone2}
            >
              {zone2.status === "saving" ? "…" : zone2.status === "saved" ? "Logged" : "Log"}
            </button>
            {zone2.status === "error" && <span className="journal-err">Error</span>}
          </div>

          {/* Sauna */}
          <div className="protocol-quick-card">
            <span className="protocol-quick-label">Sauna</span>
            <div className="protocol-quick-inputs">
              <div className="protocol-quick-field">
                <input
                  type="number"
                  min="1"
                  placeholder="°C"
                  value={sauna.temp}
                  onChange={(e) => setSauna((s) => ({ ...s, temp: e.target.value }))}
                />
                <span className="protocol-quick-unit">°C</span>
              </div>
              <div className="protocol-quick-field">
                <input
                  type="number"
                  min="1"
                  placeholder="min"
                  value={sauna.duration}
                  onChange={(e) => setSauna((s) => ({ ...s, duration: e.target.value }))}
                />
                <span className="protocol-quick-unit">min</span>
              </div>
            </div>
            <button
              className="protocol-quick-btn"
              disabled={!sauna.duration || sauna.status === "saving"}
              onClick={logSauna}
            >
              {sauna.status === "saving" ? "…" : sauna.status === "saved" ? "Logged" : "Log"}
            </button>
            {sauna.status === "error" && <span className="journal-err">Error</span>}
          </div>

          {/* Cold Plunge */}
          <div className="protocol-quick-card">
            <span className="protocol-quick-label">Cold Plunge</span>
            <div className="protocol-quick-inputs">
              <div className="protocol-quick-field">
                <input
                  type="number"
                  min="1"
                  placeholder="°C"
                  value={cold.temp}
                  onChange={(e) => setCold((s) => ({ ...s, temp: e.target.value }))}
                />
                <span className="protocol-quick-unit">°C</span>
              </div>
              <div className="protocol-quick-field">
                <input
                  type="number"
                  min="1"
                  placeholder="min"
                  value={cold.duration}
                  onChange={(e) => setCold((s) => ({ ...s, duration: e.target.value }))}
                />
                <span className="protocol-quick-unit">min</span>
              </div>
            </div>
            <button
              className="protocol-quick-btn"
              disabled={!cold.duration || cold.status === "saving"}
              onClick={logCold}
            >
              {cold.status === "saving" ? "…" : cold.status === "saved" ? "Logged" : "Log"}
            </button>
            {cold.status === "error" && <span className="journal-err">Error</span>}
          </div>

          {/* TRE window */}
          <div className="protocol-quick-card">
            <span className="protocol-quick-label">TRE window</span>
            <div className="protocol-quick-inputs">
              <div className="protocol-quick-field">
                <input
                  type="time"
                  value={tre.start}
                  onChange={(e) => setTre((s) => ({ ...s, start: e.target.value }))}
                />
                <span className="protocol-quick-unit">start</span>
              </div>
              <div className="protocol-quick-field">
                <input
                  type="time"
                  value={tre.end}
                  onChange={(e) => setTre((s) => ({ ...s, end: e.target.value }))}
                />
                <span className="protocol-quick-unit">end</span>
              </div>
            </div>
            <button
              className="protocol-quick-btn"
              disabled={!tre.start || tre.status === "saving"}
              onClick={logTre}
            >
              {tre.status === "saving" ? "…" : tre.status === "saved" ? "Logged" : "Log"}
            </button>
            {tre.status === "error" && <span className="journal-err">Error</span>}
          </div>
        </div>
      </div>

      {/* Active protocols */}
      <div className="overview-card journal-form">
        <h3 className="stat-label">Active Protocols</h3>
        {activeProtocols.length === 0 && loadStatus === "idle" && (
          <p className="journal-hint">No active protocols. Add one below.</p>
        )}
        {activeProtocols.map((p) => {
          const loggedToday = todayEvents.some((e) => e.protocol_id === p.id);
          const days = daysSince(p.start_date);
          return (
            <div key={p.id} className="protocol-row">
              <div className="protocol-row-main">
                <span
                  className="protocol-badge"
                  style={{ background: CATEGORY_COLORS[p.category] + "26", color: CATEGORY_COLORS[p.category] }}
                >
                  {CATEGORY_LABELS[p.category]}
                </span>
                <span className="protocol-name">{p.name}</span>
                {(p.dose || p.unit) && (
                  <span className="protocol-meta">
                    {[p.dose, p.unit].filter(Boolean).join(" ")}
                  </span>
                )}
                {p.cadence && <span className="protocol-meta">{p.cadence}</span>}
                <span className="protocol-day-count">day {days}</span>
                <div className="protocol-row-actions">
                  <button
                    className={`chip${loggedToday ? " chip-active" : ""}`}
                    onClick={() => logOpen === p.id ? setLogOpen(null) : openLog(p)}
                  >
                    {loggedToday ? "Logged" : "Log"}
                  </button>
                  <button className="supplement-delete" onClick={() => handleDeleteProtocol(p.id)}>×</button>
                </div>
              </div>

              {logOpen === p.id && (
                <div className="protocol-log-form">
                  <div className="protocol-log-fields">
                    <div className="protocol-log-field">
                      <label className="stat-label">Date</label>
                      <input
                        type="date"
                        value={logDate}
                        onChange={(e) => setLogDate(e.target.value)}
                        className="protocol-log-input"
                      />
                    </div>
                    <div className="protocol-log-field">
                      <label className="stat-label">Dose</label>
                      <input
                        type="text"
                        placeholder={p.dose ? `${p.dose}${p.unit ? " " + p.unit : ""}` : "dose"}
                        value={logDose}
                        onChange={(e) => setLogDose(e.target.value)}
                        className="protocol-log-input"
                      />
                    </div>
                    <div className="protocol-log-field">
                      <label className="stat-label">Duration (min)</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="—"
                        value={logDur}
                        onChange={(e) => setLogDur(e.target.value)}
                        className="protocol-log-input"
                      />
                    </div>
                  </div>
                  <textarea
                    placeholder="Notes (optional)"
                    value={logNotes}
                    onChange={(e) => setLogNotes(e.target.value)}
                    className="protocol-log-notes"
                    rows={2}
                  />
                  <div className="journal-actions">
                    <button
                      onClick={submitLog}
                      disabled={logSaving}
                    >
                      {logSaving ? "Saving…" : "Log event"}
                    </button>
                    <button
                      className="chip"
                      type="button"
                      onClick={() => setLogOpen(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button
          className="chip"
          style={{ marginTop: 12, alignSelf: "flex-start" }}
          onClick={() => setAddOpen((v) => !v)}
        >
          {addOpen ? "Cancel" : "+ Add protocol"}
        </button>

        {addOpen && (
          <form className="protocol-add-form" onSubmit={submitAddProtocol}>
            <div className="protocol-add-fields">
              <input
                type="text"
                placeholder="Name (e.g. Rapamycin)"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                required
              />
              <select
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value as ProtocolCategory)}
              >
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Dose (e.g. 6 mg)"
                value={addDose}
                onChange={(e) => setAddDose(e.target.value)}
              />
              <input
                type="text"
                placeholder="Unit (optional)"
                value={addUnit}
                onChange={(e) => setAddUnit(e.target.value)}
              />
              <input
                type="text"
                placeholder="Cadence (e.g. weekly)"
                value={addCadence}
                onChange={(e) => setAddCadence(e.target.value)}
              />
              <div className="protocol-add-date-row">
                <label className="stat-label">Start</label>
                <input
                  type="date"
                  value={addStart}
                  onChange={(e) => setAddStart(e.target.value)}
                />
              </div>
            </div>
            <textarea
              placeholder="Notes (optional)"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              rows={2}
              className="protocol-log-notes"
            />
            <div className="journal-actions">
              <button
                type="submit"
                disabled={addSaving || !addName.trim()}
              >
                {addSaving ? "Adding…" : "Add protocol"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Today's events */}
      {todayEvents.length > 0 && (
        <div className="overview-card journal-form">
          <h3 className="stat-label">Today's events</h3>
          {todayEvents.map((evt) => {
            const proto = protocols.find((p) => p.id === evt.protocol_id);
            return (
              <div key={evt.id} className="protocol-event-row">
                <span className="protocol-name">{proto?.name ?? "Protocol"}</span>
                <span className="protocol-meta">
                  {[evt.dose, evt.duration_minutes != null ? `${evt.duration_minutes} min` : null, evt.time, evt.notes]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <button className="supplement-delete" onClick={() => handleDeleteEvent(evt.id)}>×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Archived protocols */}
      {archivedProtocols.length > 0 && (
        <details className="overview-card">
          <summary className="stat-label" style={{ cursor: "pointer", padding: "4px 0" }}>
            Archived ({archivedProtocols.length})
          </summary>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            {archivedProtocols.map((p) => (
              <div key={p.id} className="protocol-row">
                <div className="protocol-row-main">
                  <span
                    className="protocol-badge"
                    style={{
                      background: CATEGORY_COLORS[p.category] + "1a",
                      color: CATEGORY_COLORS[p.category] + "99",
                    }}
                  >
                    {CATEGORY_LABELS[p.category]}
                  </span>
                  <span className="protocol-name" style={{ color: "#64748b" }}>{p.name}</span>
                  <span className="protocol-meta">{p.start_date} → {p.end_date}</span>
                  <button className="supplement-delete" onClick={() => handleDeleteProtocol(p.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
