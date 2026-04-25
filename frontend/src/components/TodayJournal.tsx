import { useCallback, useEffect, useState } from "react";
import { createCaffeineIntake, fetchJournalEntry, listCaffeineIntake, submitJournalEntry } from "../api";
import type { CaffeineIntake, JournalEntry, MorningFeeling } from "../types";

interface Props {
  date: string;
}

const FEELINGS: MorningFeeling[] = ["sleepy", "energetic", "normal", "sick"];
const CAFFEINE_QUICK_MG = [80, 100, 150, 200];

// Today-only journal: work/off chip toggle + "how did you feel after
// waking up?" radios. Both fields auto-save; the full journal entry is
// round-tripped on each save so preserved-through fields (supplements,
// alcohol, notes) stay intact.
export function TodayJournal({ date }: Props) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [isWorkDay, setIsWorkDay] = useState<boolean | null>(null);
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [saving, setSaving] = useState(false);
  const [caffeineIntakes, setCaffeineIntakes] = useState<CaffeineIntake[]>([]);
  const [caffeineSaving, setCaffeineSaving] = useState(false);

  const reloadCaffeine = useCallback(async () => {
    setCaffeineIntakes(await listCaffeineIntake(date, date));
  }, [date]);

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
    reloadCaffeine().catch(() => {});
  }, [date, reloadCaffeine]);

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

  async function logCaffeine(mg: number) {
    if (caffeineSaving) return;
    setCaffeineSaving(true);
    try {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      await createCaffeineIntake({ date, time, mg, source: null });
      await reloadCaffeine();
    } finally {
      setCaffeineSaving(false);
    }
  }

  const caffeineTotal = caffeineIntakes.reduce((s, i) => s + i.mg, 0);

  return (
    <>
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

      <fieldset className="journal-field">
        <legend className="stat-label">
          Caffeine{caffeineTotal > 0 ? ` — ${caffeineTotal} mg today` : ""}
        </legend>
        <div className="caffeine-journal-adds">
          {CAFFEINE_QUICK_MG.map((mg) => (
            <button
              key={mg}
              type="button"
              className="quick-action"
              onClick={() => logCaffeine(mg)}
              disabled={caffeineSaving}
            >
              +{mg} mg
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
