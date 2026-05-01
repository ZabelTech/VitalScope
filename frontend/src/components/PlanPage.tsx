import { useEffect, useMemo, useState } from "react";
import { format, startOfWeek, addDays } from "date-fns";
import { apiFetch } from "../api";
import {
  createMealTemplate,
  deleteMealTemplate,
  listMealTemplates,
  listNutrientDefs,
  logMealTemplate,
  fetchNutritionGoals,
  createPlannedSession,
  deletePlannedSession,
  listPlannedSessions,
  type MealTemplateInput,
  type PlannedSessionInput,
} from "../api";
import { Card, CardHeader } from "./Card";
import type {
  GarminActivity,
  MealTemplate,
  NutrientCategory,
  NutrientDef,
  NutrientGoals,
  PlannedSession,
  PlannedSessionKind,
  Workout,
} from "../types";
import { MealFormFields, type MealFormOutput } from "./MealFormFields";
import { SupplementsPage } from "./SupplementsPage";

type Tab = "supplements" | "food" | "activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "supplements", label: "Supplements" },
  { key: "food", label: "Food" },
  { key: "activity", label: "Activity" },
];

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function PlanPage() {
  const [tab, setTab] = useState<Tab>("supplements");

  return (
    <div className="journal-page">
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: "0.5rem",
          borderBottom: "1px solid #334155",
          margin: "1rem 0",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              borderBottom:
                tab === t.key ? "2px solid #60a5fa" : "2px solid transparent",
              padding: "0.5rem 1rem",
              color: tab === t.key ? "#e2e8f0" : "#94a3b8",
              cursor: "pointer",
              fontSize: "0.95em",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "supplements" && <SupplementsPage />}
      {tab === "food" && <FoodPlanTab />}
      {tab === "activity" && <ActivityPlanTab />}
    </div>
  );
}

// --- Food Plan Tab ---

const MACRO_KEYS = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"];

function FoodPlanTab() {
  const [defs, setDefs] = useState<NutrientDef[]>([]);
  const [goals, setGoals] = useState<NutrientGoals>({});
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [logDate, setLogDate] = useState<string>(todayISO());
  const [logStatus, setLogStatus] = useState<Record<number, "idle" | "logging" | "done">>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listNutrientDefs(),
      fetchNutritionGoals(),
      listMealTemplates(),
    ])
      .then(([d, g, t]) => {
        setDefs(d);
        setGoals(g);
        setTemplates(t);
      })
      .catch(() => setError("Failed to load food plan data"));
  }, []);

  const defsByCategory = useMemo(() => {
    const groups: Record<NutrientCategory, NutrientDef[]> = {
      macro: [],
      mineral: [],
      vitamin: [],
      bioactive: [],
    };
    for (const d of defs) groups[d.category].push(d);
    return groups;
  }, [defs]);

  const defsByKey = useMemo(() => {
    const map: Record<string, NutrientDef> = {};
    for (const d of defs) map[d.key] = d;
    return map;
  }, [defs]);

  const macroGoals = useMemo(
    () => MACRO_KEYS.filter((k) => goals[k] != null).map((k) => ({ key: k, amount: goals[k], def: defsByKey[k] })),
    [goals, defsByKey]
  );

  async function handleAddTemplate(out: MealFormOutput) {
    const body: MealTemplateInput = {
      name: out.name,
      notes: out.notes,
      nutrients: out.nutrients.map((n) => ({ nutrient_key: n.nutrient_key, amount: n.amount })),
    };
    await createMealTemplate(body);
    setShowAddForm(false);
    setTemplates(await listMealTemplates());
  }

  async function handleDeleteTemplate(id: number) {
    await deleteMealTemplate(id);
    setTemplates(await listMealTemplates());
  }

  async function handleLogTemplate(id: number) {
    setLogStatus((s) => ({ ...s, [id]: "logging" }));
    try {
      await logMealTemplate(id, logDate);
      setLogStatus((s) => ({ ...s, [id]: "done" }));
      setTimeout(() => setLogStatus((s) => ({ ...s, [id]: "idle" })), 2000);
    } catch {
      setLogStatus((s) => ({ ...s, [id]: "idle" }));
    }
  }

  return (
    <>
      {error && <p className="journal-err">{error}</p>}

      <Card id="plan.macro-targets" as="section" style={{ marginBottom: "1rem" }}>
        <CardHeader id="plan.macro-targets">Daily macro targets</CardHeader>
        <div className="overview-card-body" style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          {macroGoals.length === 0 ? (
            <p className="journal-hint" style={{ margin: 0 }}>No macro targets set. Configure them in Decide → Goals.</p>
          ) : (
            macroGoals.map(({ key, amount, def }) => (
              <div key={key} className="overview-stat">
                <span className="stat-label">{def?.label ?? key}</span>
                <span className="big-number" style={{ fontSize: "1.4rem" }}>
                  {amount}
                  <span style={{ fontSize: "0.75rem", color: "#94a3b8", marginLeft: 2 }}>{def?.unit ?? ""}</span>
                </span>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card id="plan.meal-templates" as="section">
        <CardHeader id="plan.meal-templates">Meal templates</CardHeader>
        <div className="overview-card-body">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <span className="stat-label" style={{ margin: 0 }}>Log to date</span>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "6px 10px", fontSize: "0.9rem" }}
            />
          </div>

          {templates.length === 0 && !showAddForm && (
            <p className="journal-hint">No templates yet. Add one below to one-click log recurring meals.</p>
          )}

          {templates.map((tmpl) => (
            <TemplateRow
              key={tmpl.id}
              template={tmpl}
              defsByKey={defsByKey}
              logStatus={logStatus[tmpl.id] ?? "idle"}
              onLog={() => handleLogTemplate(tmpl.id)}
              onDelete={() => handleDeleteTemplate(tmpl.id)}
            />
          ))}

          {showAddForm ? (
            <div style={{ marginTop: "1rem", borderTop: "1px solid #1e293b", paddingTop: "1rem" }}>
              <MealFormFields
                defsByCategory={defsByCategory}
                submitLabel="Save template"
                cancelLabel="Cancel"
                onSubmit={handleAddTemplate}
                onCancel={() => setShowAddForm(false)}
                header={<h4 className="stat-label">New template</h4>}
              />
            </div>
          ) : (
            <button
              className="chip"
              style={{ marginTop: "0.75rem" }}
              onClick={() => setShowAddForm(true)}
            >
              + Add template
            </button>
          )}
        </div>
      </Card>
    </>
  );
}

function TemplateRow({
  template,
  defsByKey,
  logStatus,
  onLog,
  onDelete,
}: {
  template: MealTemplate;
  defsByKey: Record<string, NutrientDef>;
  logStatus: "idle" | "logging" | "done";
  onLog: () => void;
  onDelete: () => void;
}) {
  const macros = template.nutrients.filter((n) => MACRO_KEYS.includes(n.key));
  const hasNutrients = template.nutrients.length > 0;

  return (
    <div className="meal-row">
      <div className="meal-header">
        <span className="supplement-name">{template.name}</span>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="chip"
            style={{ padding: "4px 12px", minHeight: 32, fontSize: "0.85rem" }}
            onClick={onLog}
            disabled={logStatus === "logging"}
          >
            {logStatus === "done" ? "Logged" : logStatus === "logging" ? "…" : "Log"}
          </button>
          <button type="button" className="supplement-delete" onClick={onDelete} aria-label={`Delete ${template.name}`}>
            ×
          </button>
        </div>
      </div>
      {template.notes && <div className="supplement-dosage">{template.notes}</div>}
      {hasNutrients && (
        <div className="meal-nutrients">
          {macros.map((n) => {
            const def = defsByKey[n.key];
            return (
              <span key={n.key} className="meal-nutrient-chip">
                {def?.label ?? n.key}: {n.amount}{def?.unit ?? ""}
              </span>
            );
          })}
          {macros.length === 0 && template.nutrients.length > 0 && (
            <span className="meal-nutrient-chip">{template.nutrients.length} nutrients</span>
          )}
        </div>
      )}
    </div>
  );
}

// --- Activity Plan Tab ---

const SESSION_KINDS: PlannedSessionKind[] = ["zone2", "strength", "hiit", "mobility", "rest", "sauna", "cold"];

const KIND_LABELS: Record<PlannedSessionKind, string> = {
  zone2: "Zone 2",
  strength: "Strength",
  hiit: "HIIT",
  mobility: "Mobility",
  rest: "Rest",
  sauna: "Sauna",
  cold: "Cold",
};

const KIND_COLORS: Record<PlannedSessionKind, string> = {
  zone2: "#3b82f6",
  strength: "#8b5cf6",
  hiit: "#ef4444",
  mobility: "#22c55e",
  rest: "#94a3b8",
  sauna: "#f97316",
  cold: "#60a5fa",
};

function getWeekDates(today: string): string[] {
  const d = new Date(today + "T12:00:00");
  const mon = startOfWeek(d, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => format(addDays(mon, i), "yyyy-MM-dd"));
}

function ActivityPlanTab() {
  const today = todayISO();
  const weekDates = useMemo(() => getWeekDates(today), [today]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [garminActivities, setGarminActivities] = useState<GarminActivity[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingForDate, setAddingForDate] = useState<string | null>(null);

  async function reload() {
    try {
      const [s, ga, wo] = await Promise.all([
        listPlannedSessions(weekStart, weekEnd),
        apiFetch(`/api/activities?start=${weekStart}&end=${weekEnd}`).then((r) => r.json() as Promise<GarminActivity[]>),
        apiFetch(`/api/workouts?start=${weekStart}&end=${weekEnd}`).then((r) => r.json() as Promise<Workout[]>),
      ]);
      setSessions(s);
      setGarminActivities(ga);
      setWorkouts(wo);
    } catch {
      setError("Failed to load activity plan data");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, weekEnd]);

  const sessionsByDate = useMemo(() => {
    const map: Record<string, PlannedSession[]> = {};
    for (const s of sessions) {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    }
    return map;
  }, [sessions]);

  const garminByDate = useMemo(() => {
    const map: Record<string, GarminActivity[]> = {};
    for (const a of garminActivities) {
      if (!map[a.date]) map[a.date] = [];
      map[a.date].push(a);
    }
    return map;
  }, [garminActivities]);

  const workoutsByDate = useMemo(() => {
    const map: Record<string, Workout[]> = {};
    for (const w of workouts) {
      if (!map[w.date]) map[w.date] = [];
      map[w.date].push(w);
    }
    return map;
  }, [workouts]);

  async function handleDelete(id: number) {
    await deletePlannedSession(id);
    await reload();
  }

  async function handleAdd(body: PlannedSessionInput) {
    await createPlannedSession(body);
    setAddingForDate(null);
    await reload();
  }

  return (
    <>
      {error && <p className="journal-err">{error}</p>}
      <Card id="plan.activities" as="section">
        <CardHeader id="plan.activities">Weekly training plan</CardHeader>
        <div className="overview-card-body" style={{ padding: 0 }}>
          {weekDates.map((date) => {
            const dayLabel = format(new Date(date + "T12:00:00"), "EEE d");
            const isToday = date === today;
            const planned = sessionsByDate[date] ?? [];
            const actual = [
              ...(garminByDate[date] ?? []).map((a) => ({ type: "garmin" as const, label: a.name ?? a.sport_type ?? "Activity", mins: a.duration_sec ? Math.round(a.duration_sec / 60) : null })),
              ...(workoutsByDate[date] ?? []).map((w) => ({ type: "strong" as const, label: w.name, mins: w.duration_sec ? Math.round(w.duration_sec / 60) : null })),
            ];

            return (
              <div
                key={date}
                style={{
                  borderBottom: "1px solid #1e293b",
                  padding: "0.75rem 1rem",
                  background: isToday ? "rgba(59,130,246,0.06)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                  <span
                    style={{
                      minWidth: 52,
                      fontWeight: isToday ? 700 : 400,
                      color: isToday ? "#60a5fa" : "#94a3b8",
                      fontSize: "0.9rem",
                      paddingTop: 2,
                    }}
                  >
                    {dayLabel}
                  </span>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {planned.length === 0 && actual.length === 0 && (
                      <span style={{ color: "#475569", fontSize: "0.85rem" }}>Rest</span>
                    )}
                    {planned.map((s) => (
                      <PlannedSessionChip key={s.id} session={s} onDelete={() => handleDelete(s.id)} />
                    ))}
                    {actual.map((a, i) => (
                      <ActualSessionChip key={i} label={a.label} mins={a.mins} type={a.type} />
                    ))}
                  </div>
                  <button
                    className="chip"
                    style={{ padding: "2px 10px", minHeight: 28, fontSize: "0.8rem", alignSelf: "flex-start" }}
                    onClick={() => setAddingForDate(addingForDate === date ? null : date)}
                  >
                    {addingForDate === date ? "Cancel" : "+ Plan"}
                  </button>
                </div>
                {addingForDate === date && (
                  <div style={{ marginTop: "0.75rem", paddingLeft: 60 }}>
                    <AddSessionForm date={date} onAdd={handleAdd} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function PlannedSessionChip({ session, onDelete }: { session: PlannedSession; onDelete: () => void }) {
  const color = KIND_COLORS[session.kind];
  const label = KIND_LABELS[session.kind];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
      <span
        style={{
          background: `${color}22`,
          border: `1px solid ${color}55`,
          color,
          borderRadius: 6,
          padding: "2px 8px",
          fontSize: "0.8rem",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {session.title && (
        <span style={{ color: "#e2e8f0", fontSize: "0.85rem" }}>{session.title}</span>
      )}
      {session.target_minutes != null && (
        <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{session.target_minutes} min</span>
      )}
      {session.target_load && (
        <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{session.target_load}</span>
      )}
      {session.notes && (
        <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{session.notes}</span>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Remove session"
        style={{
          background: "transparent",
          border: "none",
          color: "#475569",
          cursor: "pointer",
          fontSize: "0.9rem",
          padding: "0 2px",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

function ActualSessionChip({ label, mins, type }: { label: string; mins: number | null; type: "garmin" | "strong" }) {
  const color = type === "garmin" ? "#3b82f6" : "#8b5cf6";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
      <span
        style={{
          background: `${color}11`,
          border: `1px solid ${color}44`,
          color,
          borderRadius: 6,
          padding: "2px 8px",
          fontSize: "0.75rem",
          fontWeight: 500,
        }}
      >
        {type === "garmin" ? "Garmin" : "Strong"}
      </span>
      <span style={{ color: "#cbd5e1", fontSize: "0.85rem" }}>{label}</span>
      {mins != null && <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{mins} min</span>}
    </div>
  );
}

function AddSessionForm({ date, onAdd }: { date: string; onAdd: (body: PlannedSessionInput) => Promise<void> }) {
  const [kind, setKind] = useState<PlannedSessionKind>("zone2");
  const [title, setTitle] = useState("");
  const [targetMins, setTargetMins] = useState("");
  const [targetLoad, setTargetLoad] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onAdd({
        date,
        kind,
        title: title.trim() || null,
        target_minutes: targetMins ? parseInt(targetMins, 10) : null,
        target_load: targetLoad.trim() || null,
        notes: notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {SESSION_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              background: kind === k ? `${KIND_COLORS[k]}33` : "#1e293b",
              border: `1px solid ${kind === k ? KIND_COLORS[k] : "#334155"}`,
              color: kind === k ? KIND_COLORS[k] : "#94a3b8",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "6px 10px", fontSize: "0.85rem", flex: "1 1 120px" }}
        />
        <input
          type="number"
          placeholder="Minutes"
          value={targetMins}
          onChange={(e) => setTargetMins(e.target.value)}
          min={1}
          style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "6px 10px", fontSize: "0.85rem", width: 80 }}
        />
        <input
          type="text"
          placeholder="Load/intensity (e.g. 70% 1RM)"
          value={targetLoad}
          onChange={(e) => setTargetLoad(e.target.value)}
          style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "6px 10px", fontSize: "0.85rem", flex: "1 1 140px" }}
        />
      </div>
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "6px 10px", fontSize: "0.85rem" }}
      />
      <div className="journal-actions" style={{ justifyContent: "flex-start" }}>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Add session"}
        </button>
      </div>
    </form>
  );
}
