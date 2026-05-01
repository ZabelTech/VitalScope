import { useEffect, useState } from "react";
import {
  fetchJournalEntry,
  fetchJournalSupplements,
  submitJournalEntry,
  submitJournalSupplements,
} from "../api";
import type {
  JournalEntry,
  MoodTag,
  MorningFeeling,
  SupplementIntake,
  TimeOfDay,
} from "../types";
import { Card, CardHeader } from "./Card";

const SUPPLEMENT_SECTIONS: { key: TimeOfDay; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "noon", label: "Noon" },
  { key: "evening", label: "Evening" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Props {
  // When false, renders the form content without its own .overview-card so a
  // parent can host it inside a shared card. Default true for standalone use.
  wrapped?: boolean;
}

export function IntakeLog({ wrapped = true }: Props = {}) {
  const [date, setDate] = useState<string>(todayISO());
  const [supplements, setSupplements] = useState<SupplementIntake[]>([]);
  // Preserved-through fields owned by other sections of the daily landing.
  // Loaded from the server and written back unchanged so auto-saving
  // supplements here doesn't clobber them:
  //   morning_feeling, is_work_day → TodayJournal (today only)
  //   drank_alcohol, alcohol_amount, notes → JournalPage (yesterday)
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling>("normal");
  const [notes, setNotes] = useState("");
  const [isWorkDay, setIsWorkDay] = useState<boolean | null>(null);
  const [drankAlcohol, setDrankAlcohol] = useState(false);
  const [alcoholAmount, setAlcoholAmount] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [moodTag, setMoodTag] = useState<MoodTag | null>(null);
  const [cognitiveLoad, setCognitiveLoad] = useState<number | null>(null);
  const [subjectiveEnergy, setSubjectiveEnergy] = useState<number | null>(null);
  const [avgRtMs, setAvgRtMs] = useState<number | null>(null);
  const [rtTrials, setRtTrials] = useState<number | null>(null);
  const [suppStatus, setSuppStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    setSuppStatus("idle");
    Promise.all([fetchJournalEntry(date), fetchJournalSupplements(date)])
      .then(([entry, supps]) => {
        if (cancelled) return;
        setSupplements(supps);
        if (entry) {
          setMorningFeeling(entry.morning_feeling);
          setNotes(entry.notes ?? "");
          setIsWorkDay(entry.is_work_day);
          setDrankAlcohol(entry.drank_alcohol);
          setAlcoholAmount(entry.alcohol_amount);
          setFocus(entry.focus);
          setMoodTag(entry.mood_tag);
          setCognitiveLoad(entry.cognitive_load);
          setSubjectiveEnergy(entry.subjective_energy);
          setAvgRtMs(entry.avg_rt_ms);
          setRtTrials(entry.rt_trials);
        } else {
          setMorningFeeling("normal");
          setNotes("");
          setIsWorkDay(null);
          setDrankAlcohol(false);
          setAlcoholAmount(null);
          setFocus(null);
          setMoodTag(null);
          setCognitiveLoad(null);
          setSubjectiveEnergy(null);
          setAvgRtMs(null);
          setRtTrials(null);
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

  function journalEntryFor(nextSupplements: SupplementIntake[]): JournalEntry {
    const followedSupplements =
      nextSupplements.length === 0 ? true : nextSupplements.every((s) => s.taken);
    return {
      date,
      followed_supplements: followedSupplements,
      drank_alcohol: drankAlcohol,
      alcohol_amount: alcoholAmount,
      morning_feeling: morningFeeling,
      notes: notes.trim() || null,
      is_work_day: isWorkDay,
      focus,
      mood_tag: moodTag,
      cognitive_load: cognitiveLoad,
      subjective_energy: subjectiveEnergy,
      avg_rt_ms: avgRtMs,
      rt_trials: rtTrials,
    };
  }

  async function persistSupplements(next: SupplementIntake[]) {
    setSuppStatus("saving");
    try {
      await submitJournalSupplements(
        date,
        next.map((s) => ({ supplement_id: s.id, taken: s.taken }))
      );
      // Keep the journal's derived followed_supplements in sync.
      await submitJournalEntry(journalEntryFor(next));
      setSuppStatus("saved");
    } catch {
      setSuppStatus("error");
    }
  }

  async function toggleSupplement(id: number) {
    const next = supplements.map((s) =>
      s.id === id ? { ...s, taken: !s.taken } : s
    );
    setSupplements(next);
    await persistSupplements(next);
  }

  async function toggleSection(key: TimeOfDay) {
    const sectionItems = supplements.filter((s) => s.time_of_day === key);
    if (sectionItems.length === 0) return;
    const allTaken = sectionItems.every((s) => s.taken);
    const next = supplements.map((s) =>
      s.time_of_day === key ? { ...s, taken: !allTaken } : s
    );
    setSupplements(next);
    await persistSupplements(next);
  }

  const body = (
    <>
      {wrapped && (
        <label className="journal-field">
          <span className="stat-label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      )}

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
            const allTaken = sectionItems.every((s) => s.taken);
            return (
              <div key={section.key} className="journal-supplement-group">
                <label className="supplement-section-head">
                  <input
                    type="checkbox"
                    checked={allTaken}
                    onChange={() => toggleSection(section.key)}
                    disabled={suppStatus === "saving"}
                    aria-label={`Mark all ${section.label.toLowerCase()} supplements taken`}
                  />
                  <span className="stat-label">{section.label}</span>
                </label>
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
    </>
  );

  if (!wrapped) return body;
  return (
    <div className="journal-page">
      <Card id="act.intake-log" className="journal-form overview-card">
        <CardHeader id="act.intake-log" />
        {body}
      </Card>
    </div>
  );
}
