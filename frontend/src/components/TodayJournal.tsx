import { useEffect, useState } from "react";
import { fetchJournalEntry, submitJournalEntry } from "../api";
import type { JournalEntry, MorningFeeling } from "../types";

interface Props {
  date: string;
}

const FEELINGS: MorningFeeling[] = ["sleepy", "energetic", "normal", "sick"];

// Today-only journal: work/off chip toggle + "how did you feel after
// waking up?" radios. Both fields auto-save; the full journal entry is
// round-tripped on each save so preserved-through fields (supplements,
// alcohol, notes) stay intact.
export function TodayJournal({ date }: Props) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [isWorkDay, setIsWorkDay] = useState<boolean | null>(null);
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJournalEntry(date)
      .then((e) => {
        setEntry(e);
        setIsWorkDay(e?.is_work_day ?? null);
        setMorningFeeling(e?.morning_feeling ?? "normal");
      })
      .catch(() => {
        setEntry(null);
        setIsWorkDay(null);
        setMorningFeeling("normal");
      });
  }, [date]);

  async function save(patch: Partial<JournalEntry>) {
    if (saving) return;
    setSaving(true);
    const base: JournalEntry = entry ?? {
      date,
      followed_supplements: true,
      drank_alcohol: false,
      alcohol_amount: null,
      morning_feeling: "normal",
      notes: null,
      is_work_day: null,
    };
    const next: JournalEntry = { ...base, date, ...patch };
    try {
      await submitJournalEntry(next);
      setEntry(next);
    } finally {
      setSaving(false);
    }
  }

  async function setWork(next: boolean) {
    setIsWorkDay(next);
    await save({ is_work_day: next });
  }

  async function setFeeling(next: MorningFeeling) {
    setMorningFeeling(next);
    await save({ morning_feeling: next });
  }

  return (
    <div className="today-journal">
      <fieldset className="journal-field">
        <legend className="stat-label">Today</legend>
        <div className="workday-buttons">
          <button
            type="button"
            className={`chip ${isWorkDay === true ? "chip-active" : ""}`}
            onClick={() => setWork(true)}
            disabled={saving}
          >
            Work day
          </button>
          <button
            type="button"
            className={`chip ${isWorkDay === false ? "chip-active" : ""}`}
            onClick={() => setWork(false)}
            disabled={saving}
          >
            Off day
          </button>
        </div>
      </fieldset>

      <fieldset className="journal-field">
        <legend className="stat-label">How did you feel after waking up?</legend>
        {FEELINGS.map((f) => (
          <label key={f} className="journal-radio">
            <input
              type="radio"
              name="today-feeling"
              checked={morningFeeling === f}
              onChange={() => setFeeling(f)}
              disabled={saving}
            />
            {f}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
