import { useEffect, useState } from "react";
import {
  createSupplement,
  deleteSupplement,
  listSupplements,
} from "../api";
import type { Supplement, TimeOfDay } from "../types";

const SECTIONS: { key: TimeOfDay; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "noon", label: "Noon" },
  { key: "evening", label: "Evening" },
];

export function SupplementsPage() {
  const [items, setItems] = useState<Supplement[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function reload() {
    setStatus("loading");
    try {
      setItems(await listSupplements());
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
          onDelete={handleDelete}
          onAdded={reload}
        />
      ))}
    </div>
  );
}

function SupplementSection({
  label,
  time,
  items,
  onDelete,
  onAdded,
}: {
  label: string;
  time: TimeOfDay;
  items: Supplement[];
  onDelete: (id: number) => void;
  onAdded: () => void;
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

  return (
    <section className="overview-card journal-form">
      <h3 className="stat-label">{label}</h3>
      {items.length === 0 && <p className="journal-hint">No supplements yet.</p>}
      {items.map((item) => (
        <div key={item.id} className="supplement-row">
          <span className="supplement-name">{item.name}</span>
          <span className="supplement-dosage">{item.dosage}</span>
          <button
            type="button"
            className="supplement-delete"
            onClick={() => onDelete(item.id)}
            aria-label={`Delete ${item.name}`}
          >
            ×
          </button>
        </div>
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
    </section>
  );
}
