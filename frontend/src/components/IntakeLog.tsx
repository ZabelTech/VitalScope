import { useEffect, useState } from "react";
import {
  fetchJournalEntry,
  fetchJournalSupplements,
  submitJournalEntry,
  submitJournalSupplements,
} from "../api";
import type {
  JournalEntry,
  MorningFeeling,
  SupplementIntake,
  TimeOfDay,
} from "../types";

const SUPPLEMENT_SECTIONS: { key: TimeOfDay; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "noon", label: "Noon" },
  { key: "evening", label: "Evening" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function IntakeLog() {
  const [date, setDate] = useState<string>(todayISO());
  const [supplements, setSupplements] = useState<SupplementIntake[]>([]);
  const [drankAlcohol, setDrankAlcohol] = useState(false);
  const [alcoholAmount, setAlcoholAmount] = useState("");
  // Preserved-through fields owned by the Journal section in Observe.
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setStatus("idle");
    Promise.all([fetchJournalEntry(date), fetchJournalSupplements(date)])
      .then(([entry, supps]) => {
        if (cancelled) return;
        setSupplements(supps);
        if (entry) {
          setDrankAlcohol(entry.drank_alcohol);
          setAlcoholAmount(entry.alcohol_amount ?? "");
          setMorningFeeling(entry.morning_feeling);
          setNotes(entry.notes ?? "");
        } else {
          setDrankAlcohol(false);
          setAlcoholAmount("");
          setMorningFeeling("normal");
          setNotes("");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  function toggleSupplement(id: number) {
    setSupplements((prev) =>
      prev.map((s) => (s.id === id ? { ...s, taken: !s.taken } : s))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const followedSupplements =
      supplements.length === 0 ? true : supplements.every((s) => s.taken);
    const entry: JournalEntry = {
      date,
      followed_supplements: followedSupplements,
      drank_alcohol: drankAlcohol,
      alcohol_amount: drankAlcohol ? alcoholAmount.trim() || null : null,
      morning_feeling: morningFeeling,
      notes: notes.trim() || null,
    };
    try {
      await submitJournalSupplements(
        date,
        supplements.map((s) => ({ supplement_id: s.id, taken: s.taken }))
      );
      await submitJournalEntry(entry);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="journal-page">
      <form className="journal-form overview-card" onSubmit={handleSubmit}>
        <label className="journal-field">
          <span className="stat-label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <fieldset className="journal-field">
          <legend className="stat-label">Supplements taken</legend>
          {supplements.length === 0 && (
            <p className="journal-hint">
              No supplements defined yet. Add them under Decide → Plan → Supplements.
            </p>
          )}
          {SUPPLEMENT_SECTIONS.map((section) => {
            const sectionItems = supplements.filter(
              (s) => s.time_of_day === section.key
            );
            if (sectionItems.length === 0) return null;
            return (
              <div key={section.key} className="journal-supplement-group">
                <div className="stat-label">{section.label}</div>
                {sectionItems.map((s) => (
                  <label key={s.id} className="journal-radio">
                    <input
                      type="checkbox"
                      checked={s.taken}
                      onChange={() => toggleSupplement(s.id)}
                    />
                    {s.name} <span className="supplement-dosage">({s.dosage})</span>
                  </label>
                ))}
              </div>
            );
          })}
        </fieldset>

        <fieldset className="journal-field">
          <legend className="stat-label">Did you drink alcohol?</legend>
          <label className="journal-radio">
            <input
              type="radio"
              name="alcohol"
              checked={drankAlcohol}
              onChange={() => setDrankAlcohol(true)}
            />
            Yes
          </label>
          <label className="journal-radio">
            <input
              type="radio"
              name="alcohol"
              checked={!drankAlcohol}
              onChange={() => setDrankAlcohol(false)}
            />
            No
          </label>
          {drankAlcohol && (
            <input
              type="text"
              placeholder="How much? (e.g. 2 beers)"
              value={alcoholAmount}
              onChange={(e) => setAlcoholAmount(e.target.value)}
            />
          )}
        </fieldset>

        <div className="journal-actions">
          <button type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save intake"}
          </button>
          {status === "saved" && <span className="journal-ok">Saved ✓</span>}
          {status === "error" && <span className="journal-err">Failed to save</span>}
        </div>
      </form>
    </div>
  );
}
