import { useEffect, useState } from "react";
import {
  fetchJournalEntry,
  fetchJournalResponses,
  fetchWaterLoggingStatus,
  setWaterLoggingStatus,
  submitJournalEntry,
  submitJournalResponses,
} from "../api";
import type { JournalEntry, JournalQuestionResponse, MoodTag, MorningFeeling } from "../types";
import { MealTextDescribe } from "./MealTextDescribe";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const MOOD_TAGS: MoodTag[] = ["great", "good", "flat", "low", "irritable", "anxious"];

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface Props {
  initialDate?: string;
  showDate?: boolean;
}

export function JournalPage({ initialDate, showDate = true }: Props = {}) {
  const [date, setDate] = useState<string>(initialDate ?? yesterdayISO());
  const [showMealDescribe, setShowMealDescribe] = useState(false);
  const [alcoholAmount, setAlcoholAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [isWorkDay, setIsWorkDay] = useState<boolean | null>(null);
  const [followedSupplements, setFollowedSupplements] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  const [moodTag, setMoodTag] = useState<MoodTag | null>(null);
  const [cognitiveLoad, setCognitiveLoad] = useState<number | null>(null);
  const [subjectiveEnergy, setSubjectiveEnergy] = useState<number | null>(null);
  const [existingAvgRtMs, setExistingAvgRtMs] = useState<number | null>(null);
  const [existingRtTrials, setExistingRtTrials] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loadedExisting, setLoadedExisting] = useState(false);
  const [customResponses, setCustomResponses] = useState<JournalQuestionResponse[]>([]);
  const [waterNotLogged, setWaterNotLogged] = useState(false);

  const isPastDate = date < todayISO();

  useEffect(() => {
    setShowMealDescribe(false);
  }, [date]);

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
          setFocus(entry.focus ?? null);
          setMoodTag(entry.mood_tag ?? null);
          setCognitiveLoad(entry.cognitive_load ?? null);
          setSubjectiveEnergy(entry.subjective_energy ?? null);
          setExistingAvgRtMs(entry.avg_rt_ms ?? null);
          setExistingRtTrials(entry.rt_trials ?? null);
          setLoadedExisting(true);
        } else {
          setAlcoholAmount("");
          setNotes("");
          setMorningFeeling("normal");
          setIsWorkDay(null);
          setFollowedSupplements(true);
          setFocus(null);
          setMoodTag(null);
          setCognitiveLoad(null);
          setSubjectiveEnergy(null);
          setExistingAvgRtMs(null);
          setExistingRtTrials(null);
        }
      })
      .catch(() => {});
    fetchJournalResponses(date)
      .then((responses) => {
        if (cancelled) return;
        setCustomResponses(responses);
      })
      .catch(() => {});
    fetchWaterLoggingStatus(date)
      .then((s) => {
        if (cancelled) return;
        setWaterNotLogged(s.not_logged);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function handleToggleWaterNotLogged(next: boolean) {
    setWaterNotLogged(next);
    try {
      await setWaterLoggingStatus(date, next);
    } catch {
      setWaterNotLogged(!next);
    }
  }

  function updateCustomResponse(questionId: number, response: string) {
    setCustomResponses((prev) =>
      prev.map((r) => r.question_id === questionId ? { ...r, response } : r)
    );
  }

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
      focus,
      mood_tag: moodTag,
      cognitive_load: cognitiveLoad,
      subjective_energy: subjectiveEnergy,
      avg_rt_ms: existingAvgRtMs,
      rt_trials: existingRtTrials,
    };
    try {
      await submitJournalEntry(entry);
      if (customResponses.length > 0) {
        await submitJournalResponses(
          date,
          customResponses.map((r) => ({ question_id: r.question_id, response: r.response }))
        );
      }
      setStatus("saved");
      setLoadedExisting(true);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="journal-page">
      <form className="journal-form overview-card" onSubmit={handleSubmit}>
        {showDate && (
          <label className="journal-field">
            <span className="stat-label">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}

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

        {isPastDate && (
          <label className="journal-field journal-checkbox">
            <input
              type="checkbox"
              checked={waterNotLogged}
              onChange={(e) => handleToggleWaterNotLogged(e.target.checked)}
            />
            <span>
              <span className="stat-label">Water not logged</span>
              <span className="journal-hint">
                When checked, this day's water is excluded from AI briefings and from weekly aggregates.
              </span>
            </span>
          </label>
        )}

        <fieldset className="journal-field">
          <legend className="stat-label">Mood</legend>
          <div className="workday-buttons">
            {MOOD_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip ${moodTag === t ? "chip-active" : ""}`}
                onClick={() => setMoodTag(moodTag === t ? null : t)}
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
            />
            <span className="cognition-slider-val">{focus ?? "—"}/10</span>
          </div>
          <div className="cognition-slider-row">
            <span className="stat-label">Cognitive load</span>
            <input
              type="range" min="0" max="10" step="1"
              value={cognitiveLoad ?? 5}
              onChange={(e) => setCognitiveLoad(Number(e.target.value))}
            />
            <span className="cognition-slider-val">{cognitiveLoad ?? "—"}/10</span>
          </div>
          <div className="cognition-slider-row">
            <span className="stat-label">Subjective energy</span>
            <input
              type="range" min="0" max="10" step="1"
              value={subjectiveEnergy ?? 5}
              onChange={(e) => setSubjectiveEnergy(Number(e.target.value))}
            />
            <span className="cognition-slider-val">{subjectiveEnergy ?? "—"}/10</span>
          </div>
        </div>

        {customResponses.map((r) => (
          <label key={r.question_id} className="journal-field">
            <span className="stat-label">{r.question}</span>
            <textarea
              rows={3}
              value={r.response}
              onChange={(e) => updateCustomResponse(r.question_id, e.target.value)}
              placeholder="Your response…"
            />
          </label>
        ))}

        <div className="journal-actions">
          <button type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save entry"}
          </button>
          {status === "saved" && <span className="journal-ok">Saved ✓</span>}
          {status === "error" && <span className="journal-err">Failed to save</span>}
        </div>
      </form>

      {date < todayISO() && (
        <div className="overview-card journal-form">
          {!showMealDescribe ? (
            <div className="journal-actions">
              <button
                type="button"
                className="chip"
                onClick={() => setShowMealDescribe(true)}
              >
                Log a missed meal for {date}
              </button>
            </div>
          ) : (
            <MealTextDescribe
              date={date}
              label={`Log a missed meal for ${date}`}
              hint="Type what you ate — the AI fills in nutrients, then save it against this date."
              onSaved={() => setShowMealDescribe(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
