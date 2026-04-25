import { useCallback, useEffect, useState } from "react";
import {
  createCaffeineIntake,
  fetchJournalEntry,
  listCaffeineIntake,
  submitProcessingSpeedSession,
  submitJournalEntry,
} from "../api";
import type {
  CaffeineIntake,
  JournalEntry,
  MoodTag,
  MorningFeeling,
  ProcessingSpeedSessionResult,
} from "../types";
import { ProcessingSpeedTask } from "./ProcessingSpeedTask";

interface Props {
  date: string;
}

const FEELINGS: MorningFeeling[] = ["sleepy", "energetic", "normal", "sick"];
const CAFFEINE_QUICK_MG = [80, 100, 150, 200];
const MOOD_TAGS: MoodTag[] = ["great", "good", "flat", "low", "irritable", "anxious"];

export function TodayJournal({ date }: Props) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [isWorkDay, setIsWorkDay] = useState<boolean | null>(null);
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [focus, setFocus] = useState<number | null>(null);
  const [moodTag, setMoodTag] = useState<MoodTag | null>(null);
  const [cognitiveLoad, setCognitiveLoad] = useState<number | null>(null);
  const [subjectiveEnergy, setSubjectiveEnergy] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [caffeineIntakes, setCaffeineIntakes] = useState<CaffeineIntake[]>([]);
  const [caffeineSaving, setCaffeineSaving] = useState(false);

  const reloadCaffeine = useCallback(async () => {
    setCaffeineIntakes(await listCaffeineIntake(date, date));
  }, [date]);

  const [processingResult, setProcessingResult] = useState<ProcessingSpeedSessionResult | null>(null);

  useEffect(() => {
    fetchJournalEntry(date)
      .then((e) => {
        setEntry(e);
        setIsWorkDay(e?.is_work_day ?? null);
        setMorningFeeling(e?.morning_feeling ?? "normal");
        setFocus(e?.focus ?? null);
        setMoodTag(e?.mood_tag ?? null);
        setCognitiveLoad(e?.cognitive_load ?? null);
        setSubjectiveEnergy(e?.subjective_energy ?? null);
        setProcessingResult(null);
      })
      .catch(() => {
        setEntry(null);
        setIsWorkDay(null);
        setMorningFeeling("normal");
        setFocus(null);
        setMoodTag(null);
        setCognitiveLoad(null);
        setSubjectiveEnergy(null);
      });
    reloadCaffeine().catch(() => {});
    return () => {};
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
      focus: null,
      mood_tag: null,
      cognitive_load: null,
      subjective_energy: null,
      avg_rt_ms: null,
      rt_trials: null,
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

  async function setMood(next: MoodTag) {
    setMoodTag(next);
    await save({ mood_tag: next });
  }

  const savedAvgRt = entry?.avg_rt_ms ? Math.round(entry.avg_rt_ms) : null;

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

      <fieldset className="journal-field">
        <legend className="stat-label">Mood</legend>
        <div className="workday-buttons">
          {MOOD_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip ${moodTag === t ? "chip-active" : ""}`}
              onClick={() => setMood(t)}
              disabled={saving}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="cognition-sliders">
        <div className="cognition-slider-row">
          <span className="stat-label">Focus</span>
          <input
            type="range" min="0" max="10" step="1"
            value={focus ?? 5}
            onChange={(e) => setFocus(Number(e.target.value))}
            onMouseUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setFocus(v);
              save({ focus: v });
            }}
            onTouchEnd={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              setFocus(v);
              save({ focus: v });
            }}
            disabled={saving}
          />
          <span className="cognition-slider-val">{focus ?? "—"}/10</span>
        </div>
        <div className="cognition-slider-row">
          <span className="stat-label">Cognitive load</span>
          <input
            type="range" min="0" max="10" step="1"
            value={cognitiveLoad ?? 5}
            onChange={(e) => setCognitiveLoad(Number(e.target.value))}
            onMouseUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setCognitiveLoad(v);
              save({ cognitive_load: v });
            }}
            onTouchEnd={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              setCognitiveLoad(v);
              save({ cognitive_load: v });
            }}
            disabled={saving}
          />
          <span className="cognition-slider-val">{cognitiveLoad ?? "—"}/10</span>
        </div>
        <div className="cognition-slider-row">
          <span className="stat-label">Subjective energy</span>
          <input
            type="range" min="0" max="10" step="1"
            value={subjectiveEnergy ?? 5}
            onChange={(e) => setSubjectiveEnergy(Number(e.target.value))}
            onMouseUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setSubjectiveEnergy(v);
              save({ subjective_energy: v });
            }}
            onTouchEnd={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              setSubjectiveEnergy(v);
              save({ subjective_energy: v });
            }}
            disabled={saving}
          />
          <span className="cognition-slider-val">{subjectiveEnergy ?? "—"}/10</span>
        </div>
      </div>

      <ProcessingSpeedTask
        date={date}
        onComplete={async (payload) => {
          const result = await submitProcessingSpeedSession(payload);
          setProcessingResult(result);
          await save({
            avg_rt_ms: result.summary.median_rt_ms,
            rt_trials: result.summary.attempted,
          });
        }}
      />
      {(processingResult || savedAvgRt !== null) && (
        <fieldset className="journal-field">
          <legend className="stat-label">Processing-speed result</legend>
          <div className="rt-widget">
            <p className="rt-feedback">
              Median RT: {processingResult?.summary.median_rt_ms != null
                ? `${Math.round(processingResult.summary.median_rt_ms)} ms`
                : savedAvgRt != null ? `${savedAvgRt} ms` : "—"}
            </p>
            {processingResult && (
              <p className="rt-feedback">
                Accuracy: {Math.round(processingResult.summary.accuracy * 100)}% · Throughput: {processingResult.summary.throughput_pm.toFixed(1)}/min · Quality: {processingResult.summary.quality_flag}
              </p>
            )}
          </div>
        </fieldset>
      )}
    </>
  );
}
