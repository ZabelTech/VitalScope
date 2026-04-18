import { useEffect, useRef, useState } from "react";
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

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function IntakeLog() {
  const [date, setDate] = useState<string>(todayISO());
  const [supplements, setSupplements] = useState<SupplementIntake[]>([]);
  const [alcoholAmount, setAlcoholAmount] = useState("");
  // Preserved-through fields owned by the Journal section in Observe.
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [notes, setNotes] = useState("");
  const [isWorkDay, setIsWorkDay] = useState<boolean | null>(null);
  const [suppStatus, setSuppStatus] = useState<SaveStatus>("idle");
  const [alcoholStatus, setAlcoholStatus] = useState<SaveStatus>("idle");

  const savedAlcoholRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    setSuppStatus("idle");
    setAlcoholStatus("idle");
    Promise.all([fetchJournalEntry(date), fetchJournalSupplements(date)])
      .then(([entry, supps]) => {
        if (cancelled) return;
        setSupplements(supps);
        if (entry) {
          setAlcoholAmount(entry.alcohol_amount ?? "");
          savedAlcoholRef.current = entry.alcohol_amount ?? "";
          setMorningFeeling(entry.morning_feeling);
          setNotes(entry.notes ?? "");
          setIsWorkDay(entry.is_work_day);
        } else {
          setAlcoholAmount("");
          savedAlcoholRef.current = "";
          setMorningFeeling("normal");
          setNotes("");
          setIsWorkDay(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Auto-clear transient "Saved ✓" indicator after 1.5s.
  useEffect(() => {
    if (suppStatus !== "saved") return;
    const t = setTimeout(() => setSuppStatus("idle"), 1500);
    return () => clearTimeout(t);
  }, [suppStatus]);
  useEffect(() => {
    if (alcoholStatus !== "saved") return;
    const t = setTimeout(() => setAlcoholStatus("idle"), 1500);
    return () => clearTimeout(t);
  }, [alcoholStatus]);

  function journalEntryFor(nextSupplements: SupplementIntake[], alcoholText: string): JournalEntry {
    const followedSupplements =
      nextSupplements.length === 0 ? true : nextSupplements.every((s) => s.taken);
    const trimmed = alcoholText.trim();
    return {
      date,
      followed_supplements: followedSupplements,
      drank_alcohol: trimmed.length > 0,
      alcohol_amount: trimmed || null,
      morning_feeling: morningFeeling,
      notes: notes.trim() || null,
      is_work_day: isWorkDay,
    };
  }

  async function toggleSupplement(id: number) {
    const next = supplements.map((s) =>
      s.id === id ? { ...s, taken: !s.taken } : s
    );
    setSupplements(next);
    setSuppStatus("saving");
    try {
      await submitJournalSupplements(
        date,
        next.map((s) => ({ supplement_id: s.id, taken: s.taken }))
      );
      // Keep the journal's derived followed_supplements in sync.
      await submitJournalEntry(journalEntryFor(next, savedAlcoholRef.current));
      setSuppStatus("saved");
    } catch {
      setSuppStatus("error");
    }
  }

  async function handleSaveAlcohol(e: React.FormEvent) {
    e.preventDefault();
    setAlcoholStatus("saving");
    try {
      await submitJournalEntry(journalEntryFor(supplements, alcoholAmount));
      savedAlcoholRef.current = alcoholAmount.trim();
      setAlcoholStatus("saved");
    } catch {
      setAlcoholStatus("error");
    }
  }

  const alcoholDirty = alcoholAmount.trim() !== savedAlcoholRef.current;

  return (
    <div className="journal-page">
      <div className="journal-form overview-card">
        <label className="journal-field">
          <span className="stat-label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <fieldset className="journal-field">
          <legend className="stat-label">
            Supplements taken
            {suppStatus === "saving" && <span className="journal-hint"> · saving…</span>}
            {suppStatus === "saved" && <span className="journal-ok"> · saved ✓</span>}
            {suppStatus === "error" && <span className="journal-err"> · save failed</span>}
          </legend>
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
                      disabled={suppStatus === "saving"}
                    />
                    {s.name} <span className="supplement-dosage">({s.dosage})</span>
                  </label>
                ))}
              </div>
            );
          })}
        </fieldset>

        <form className="journal-field" onSubmit={handleSaveAlcohol}>
          <span className="stat-label">Alcohol</span>
          <input
            type="text"
            placeholder="e.g. 2 beers, 1 glass of wine — leave empty for none"
            value={alcoholAmount}
            onChange={(e) => setAlcoholAmount(e.target.value)}
          />
          <div className="journal-actions">
            <button
              type="submit"
              disabled={!alcoholDirty || alcoholStatus === "saving"}
            >
              {alcoholStatus === "saving" ? "Saving…" : "Save alcohol"}
            </button>
            {alcoholStatus === "saved" && <span className="journal-ok">Saved ✓</span>}
            {alcoholStatus === "error" && <span className="journal-err">Failed to save</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
