import { useEffect, useState } from "react";
import { fetchJournalEntry, submitJournalEntry } from "../api";
import type { JournalEntry, MorningFeeling } from "../types";

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const FEELINGS: MorningFeeling[] = ["sleepy", "energetic", "normal", "sick"];

export function JournalPage() {
  const [date, setDate] = useState<string>(yesterdayISO());
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [notes, setNotes] = useState("");
  // Preserved-through fields owned by the Intake section in Act — loaded from
  // the server so saving here doesn't clobber them.
  const [followedSupplements, setFollowedSupplements] = useState(true);
  const [drankAlcohol, setDrankAlcohol] = useState(false);
  const [alcoholAmount, setAlcoholAmount] = useState<string | null>(null);
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
          setMorningFeeling(entry.morning_feeling);
          setNotes(entry.notes ?? "");
          setFollowedSupplements(entry.followed_supplements);
          setDrankAlcohol(entry.drank_alcohol);
          setAlcoholAmount(entry.alcohol_amount);
          setLoadedExisting(true);
        } else {
          setMorningFeeling("normal");
          setNotes("");
          setFollowedSupplements(true);
          setDrankAlcohol(false);
          setAlcoholAmount(null);
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
    const entry: JournalEntry = {
      date,
      followed_supplements: followedSupplements,
      drank_alcohol: drankAlcohol,
      alcohol_amount: alcoholAmount,
      morning_feeling: morningFeeling,
      notes: notes.trim() || null,
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

        <fieldset className="journal-field">
          <legend className="stat-label">How did you feel after waking up?</legend>
          {FEELINGS.map((f) => (
            <label key={f} className="journal-radio">
              <input
                type="radio"
                name="feeling"
                checked={morningFeeling === f}
                onChange={() => setMorningFeeling(f)}
              />
              {f}
            </label>
          ))}
        </fieldset>

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
