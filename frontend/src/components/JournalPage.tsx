import { useEffect, useState } from "react";
import { fetchJournalEntry, submitJournalEntry } from "../api";
import type { JournalEntry, MorningFeeling } from "../types";

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface Props {
  initialDate?: string;
}

export function JournalPage({ initialDate }: Props = {}) {
  const [date, setDate] = useState<string>(initialDate ?? yesterdayISO());
  // Primary fields owned here — yesterday's reflections.
  const [alcoholAmount, setAlcoholAmount] = useState("");
  const [notes, setNotes] = useState("");
  // Preserved-through fields owned by other sections of the daily landing:
  //   morning_feeling, is_work_day → TodayJournal (today only)
  //   followed_supplements         → IntakeLog (derived from tick state)
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [isWorkDay, setIsWorkDay] = useState<boolean | null>(null);
  const [followedSupplements, setFollowedSupplements] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loadedExisting, setLoadedExisting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("idle");
    setLoadedExisting(false);
    fetchJournalEntry(date)
      .then((entry) => {
        if (cancelled) return;
        if (entry) {
          setAlcoholAmount(entry.alcohol_amount ?? "");
          setNotes(entry.notes ?? "");
          setMorningFeeling(entry.morning_feeling);
          setIsWorkDay(entry.is_work_day);
          setFollowedSupplements(entry.followed_supplements);
          setLoadedExisting(true);
        } else {
          setAlcoholAmount("");
          setNotes("");
          setMorningFeeling("normal");
          setIsWorkDay(null);
          setFollowedSupplements(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const alcoholTrimmed = alcoholAmount.trim();
    const entry: JournalEntry = {
      date,
      followed_supplements: followedSupplements,
      drank_alcohol: alcoholTrimmed.length > 0,
      alcohol_amount: alcoholTrimmed || null,
      morning_feeling: morningFeeling,
      notes: notes.trim() || null,
      is_work_day: isWorkDay,
    };
    try {
      await submitJournalEntry(entry);
      setStatus("saved");
      setLoadedExisting(true);
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

        {loadedExisting && (
          <p className="journal-hint">An entry for {date} already exists — editing it.</p>
        )}

        <label className="journal-field">
          <span className="stat-label">Alcohol</span>
          <input
            type="text"
            placeholder="e.g. 2 beers, 1 glass of wine — leave empty for none"
            value={alcoholAmount}
            onChange={(e) => setAlcoholAmount(e.target.value)}
          />
        </label>

        <label className="journal-field">
          <span className="stat-label">Anything special</span>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
          />
        </label>

        <div className="journal-actions">
          <button type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save entry"}
          </button>
          {status === "saved" && <span className="journal-ok">Saved ✓</span>}
          {status === "error" && <span className="journal-err">Failed to save</span>}
        </div>
      </form>
    </div>
  );
}
