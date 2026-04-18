import { useEffect, useState } from "react";
import { fetchJournalEntry, submitJournalEntry } from "../api";
import type { JournalEntry } from "../types";

interface Props {
  date: string;
}

// Quick work/off toggle for a single date. Round-trips the full journal
// entry so the other owned fields (morning_feeling, notes, supplements,
// alcohol) are preserved when saving.
export function WorkDayToggle({ date }: Props) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [value, setValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJournalEntry(date)
      .then((e) => {
        setEntry(e);
        setValue(e?.is_work_day ?? null);
      })
      .catch(() => {
        setEntry(null);
        setValue(null);
      });
  }, [date]);

  async function set(next: boolean) {
    if (saving) return;
    setSaving(true);
    setValue(next);
    const base: JournalEntry = entry ?? {
      date,
      followed_supplements: true,
      drank_alcohol: false,
      alcohol_amount: null,
      morning_feeling: "normal",
      notes: null,
      is_work_day: null,
    };
    try {
      await submitJournalEntry({ ...base, date, is_work_day: next });
      setEntry({ ...base, date, is_work_day: next });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workday-toggle">
      <span className="stat-label">Today</span>
      <div className="workday-buttons">
        <button
          type="button"
          className={`chip ${value === true ? "chip-active" : ""}`}
          onClick={() => set(true)}
          disabled={saving}
        >
          Work day
        </button>
        <button
          type="button"
          className={`chip ${value === false ? "chip-active" : ""}`}
          onClick={() => set(false)}
          disabled={saving}
        >
          Off day
        </button>
      </div>
    </div>
  );
}
