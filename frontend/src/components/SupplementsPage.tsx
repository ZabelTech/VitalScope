import { useEffect, useState } from "react";
import {
  createSupplement,
  deleteSupplement,
  listNutrientDefs,
  listSupplements,
  updateSupplement,
} from "../api";
import type { NutrientDef, Supplement, SupplementNutrient, TimeOfDay } from "../types";
import type { CardId } from "../cardInfo";
import { Card, CardHeader } from "./Card";

const TIME_TO_CARD_ID: Record<TimeOfDay, CardId> = {
  morning: "supplements.morning",
  noon: "supplements.noon",
  evening: "supplements.evening",
};

const SECTIONS: { key: TimeOfDay; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "noon", label: "Noon" },
  { key: "evening", label: "Evening" },
];

export function SupplementsPage() {
  const [items, setItems] = useState<Supplement[]>([]);
  const [defs, setDefs] = useState<NutrientDef[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function reload() {
    setStatus("loading");
    try {
      const [supps, nutrientDefs] = await Promise.all([listSupplements(), listNutrientDefs()]);
      setItems(supps);
      setDefs(nutrientDefs);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleDelete(id: number) {
    await deleteSupplement(id);
    await reload();
  }

  return (
    <div className="journal-page">
      <div className="trends-header">
        <h2>Supplements</h2>
      </div>
      {status === "error" && <p className="journal-err">Failed to load supplements</p>}
      {SECTIONS.map((section) => (
        <SupplementSection
          key={section.key}
          label={section.label}
          time={section.key}
          items={items.filter((i) => i.time_of_day === section.key)}
          defs={defs}
          onDelete={handleDelete}
          onAdded={reload}
          onUpdated={reload}
        />
      ))}
    </div>
  );
}

function SupplementSection({
  label,
  time,
  items,
  defs,
  onDelete,
  onAdded,
  onUpdated,
}: {
  label: string;
  time: TimeOfDay;
  items: Supplement[];
  defs: NutrientDef[];
  onDelete: (id: number) => void;
  onAdded: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !dosage.trim()) return;
    setSaving(true);
    try {
      await createSupplement({ name, dosage, time_of_day: time });
      setName("");
      setDosage("");
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  const cardId = TIME_TO_CARD_ID[time];
  return (
    <Card id={cardId} as="section" className="overview-card journal-form">
      <CardHeader id={cardId}>{label}</CardHeader>
      {items.length === 0 && <p className="journal-hint">No supplements yet.</p>}
      {items.map((item) => (
        <SupplementRow
          key={item.id}
          item={item}
          defs={defs}
          onDelete={onDelete}
          onUpdated={onUpdated}
        />
      ))}
      <form className="supplement-add" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Dosage"
          value={dosage}
          onChange={(e) => setDosage(e.target.value)}
        />
        <button type="submit" disabled={saving || !name.trim() || !dosage.trim()}>
          Add
        </button>
      </form>
    </Card>
  );
}

function SupplementRow({
  item,
  defs,
  onDelete,
  onUpdated,
}: {
  item: Supplement;
  defs: NutrientDef[];
  onDelete: (id: number) => void;
  onUpdated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [nutrients, setNutrients] = useState<SupplementNutrient[]>(item.nutrients ?? []);
  const [addKey, setAddKey] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [saving, setSaving] = useState(false);

  function handleRemoveNutrient(key: string) {
    setNutrients((prev) => prev.filter((n) => n.key !== key));
  }

  async function handleAddNutrient(e: React.FormEvent) {
    e.preventDefault();
    if (!addKey || !addAmount) return;
    const amount = parseFloat(addAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setNutrients((prev) => {
      const existing = prev.find((n) => n.key === addKey);
      if (existing) {
        return prev.map((n) => (n.key === addKey ? { ...n, amount } : n));
      }
      return [...prev, { key: addKey, amount }];
    });
    setAddKey("");
    setAddAmount("");
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateSupplement(item.id, {
        name: item.name,
        dosage: item.dosage,
        time_of_day: item.time_of_day,
        sort_order: item.sort_order,
        nutrients: nutrients.length > 0 ? nutrients : null,
      });
      onUpdated();
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  }

  const defsMap = Object.fromEntries(defs.map((d) => [d.key, d]));
  const usedKeys = new Set(nutrients.map((n) => n.key));
  const availableDefs = defs.filter((d) => !usedKeys.has(d.key));

  return (
    <div className="supplement-row-wrap">
      <div className="supplement-row">
        <span className="supplement-name">{item.name}</span>
        <span className="supplement-dosage">{item.dosage}</span>
        <button
          type="button"
          className="supplement-nutrients-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-label="Edit nutrient content"
          title="Nutrient content"
        >
          {nutrients.length > 0 ? `${nutrients.length} nutrients` : "nutrients"}
        </button>
        <button
          type="button"
          className="supplement-delete"
          onClick={() => onDelete(item.id)}
          aria-label={`Delete ${item.name}`}
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="supplement-nutrients-panel">
          {nutrients.length === 0 && (
            <p className="journal-hint">No nutrient content defined.</p>
          )}
          {nutrients.map((n) => {
            const def = defsMap[n.key];
            return (
              <div key={n.key} className="supp-nutrient-row">
                <span className="supp-nutrient-label">{def?.label ?? n.key}</span>
                <span className="supp-nutrient-val">
                  {n.amount} {def?.unit ?? ""}
                </span>
                <button
                  type="button"
                  className="supplement-delete"
                  onClick={() => handleRemoveNutrient(n.key)}
                  aria-label={`Remove ${def?.label ?? n.key}`}
                >
                  ×
                </button>
              </div>
            );
          })}

          {availableDefs.length > 0 && (
            <form className="supp-nutrient-add" onSubmit={handleAddNutrient}>
              <select
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
              >
                <option value="">Nutrient…</option>
                {availableDefs.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label} ({d.unit})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Amount"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
              />
              <button type="submit" disabled={!addKey || !addAmount}>
                Add
              </button>
            </form>
          )}

          <div className="supp-nutrient-actions">
            <button
              type="button"
              className="supp-nutrient-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="supp-nutrient-cancel"
              onClick={() => {
                setNutrients(item.nutrients ?? []);
                setExpanded(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
