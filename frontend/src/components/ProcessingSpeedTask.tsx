import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessingSpeedSessionInput } from "../types";

const SYMBOLS = ["◆", "▲", "■", "●", "★", "✚", "☾", "♣", "♠", "✦", "⬢", "⬟"];
const DIFFICULTIES = ["easy", "easy", "easy", "easy", "easy", "easy", "moderate", "moderate", "moderate", "hard"] as const;
const SESSION_MS = 75000;
const TRIAL_TIMEOUT_MS = 4000;
const PRACTICE_TRIALS = 6;
const PRACTICE_RESET_DAYS = 7;
const LAST_SESSION_KEY = "processing_speed_last_session_date";

type Difficulty = "easy" | "moderate" | "hard";

type Trial = {
  trial_index: number;
  difficulty: Difficulty;
  target_symbol: string;
  candidate_symbols: string[];
  correct_answer: boolean;
  user_answer: boolean | null;
  is_correct: boolean;
  rt_ms: number | null;
  timeout: boolean;
  presented_at: string;
};

interface Props {
  date: string;
  onComplete: (payload: ProcessingSpeedSessionInput) => Promise<void>;
  disabled?: boolean;
}

type Phase = "idle" | "practice" | "running" | "done";

function hashToSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seedInput: string) {
  let state = hashToSeed(seedInput) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000000) / 1000000;
  };
}

function pickOne<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

function makeTrial(rand: () => number, trialIndex: number): Trial {
  const difficulty = pickOne([...DIFFICULTIES], rand);
  const pool = [...SYMBOLS];
  const target = pickOne(pool, rand);
  const present = rand() > 0.5;
  const candidateCount = difficulty === "easy" ? 3 : difficulty === "moderate" ? 4 : 5;
  const candidates: string[] = [];
  if (present) {
    candidates.push(target);
  }
  while (candidates.length < candidateCount) {
    const next = pickOne(pool, rand);
    if (next === target || candidates.includes(next)) continue;
    candidates.push(next);
  }
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return {
    trial_index: trialIndex,
    difficulty,
    target_symbol: target,
    candidate_symbols: candidates,
    correct_answer: present,
    user_answer: null,
    is_correct: false,
    rt_ms: null,
    timeout: false,
    presented_at: new Date().toISOString(),
  };
}

export function ProcessingSpeedTask({ date, onComplete, disabled }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seed, setSeed] = useState<string>("");
  const [timeLeftMs, setTimeLeftMs] = useState(SESSION_MS);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interruptionCount, setInterruptionCount] = useState(0);
  const [focusLostMsTotal, setFocusLostMsTotal] = useState(0);
  const [practiceDone, setPracticeDone] = useState(false);

  const rngRef = useRef<(() => number) | null>(null);
  const sessionStartMsRef = useRef<number>(0);
  const sessionTimerRef = useRef<number | null>(null);
  const trialTimerRef = useRef<number | null>(null);
  const trialStartMsRef = useRef<number>(0);
  const hiddenAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<string>("");
  const trialsRef = useRef<Trial[]>([]);
  const practiceTrialsRef = useRef<Trial[]>([]);

  const summary = useMemo(() => {
    if (trials.length === 0) return null;
    const attempted = trials.length;
    const correct = trials.filter((t) => t.is_correct && !t.timeout).length;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const withRt = trials.filter((t) => t.rt_ms !== null).map((t) => t.rt_ms as number);
    const sorted = [...withRt].sort((a, b) => a - b);
    const median = sorted.length === 0
      ? null
      : sorted.length % 2 === 0
        ? Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
        : sorted[Math.floor(sorted.length / 2)];
    return { attempted, correct, accuracy, median };
  }, [trials]);

  useEffect(() => {
    return () => {
      if (sessionTimerRef.current) window.clearInterval(sessionTimerRef.current);
      if (trialTimerRef.current) window.clearTimeout(trialTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const lastDate = window.localStorage.getItem(LAST_SESSION_KEY);
    if (!lastDate) {
      setPracticeDone(false);
      return;
    }
    const last = Date.parse(`${lastDate}T00:00:00Z`);
    const current = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(last) || Number.isNaN(current)) {
      setPracticeDone(false);
      return;
    }
    const days = Math.floor((current - last) / (24 * 60 * 60 * 1000));
    setPracticeDone(days >= 0 && days < PRACTICE_RESET_DAYS);
  }, [date]);

  useEffect(() => {
    function onVisibilityChange() {
      const now = Date.now();
      if (document.hidden) {
        hiddenAtRef.current = now;
        setInterruptionCount((v) => v + 1);
      } else if (hiddenAtRef.current) {
        setFocusLostMsTotal((v) => v + (now - hiddenAtRef.current!));
        hiddenAtRef.current = null;
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  function clearTrialTimer() {
    if (trialTimerRef.current) {
      window.clearTimeout(trialTimerRef.current);
      trialTimerRef.current = null;
    }
  }

  function nextTrial(index: number) {
    if (!rngRef.current) return;
    clearTrialTimer();
    const next = makeTrial(rngRef.current, index);
    trialStartMsRef.current = Date.now();
    setTrial(next);
    trialTimerRef.current = window.setTimeout(() => {
      answer(null);
    }, TRIAL_TIMEOUT_MS);
  }

  async function finishSession(finalTrials: Trial[]) {
    clearTrialTimer();
    if (sessionTimerRef.current) {
      window.clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    setPhase("done");
    setTrial(null);
    setTrials(finalTrials);
    const endedAt = new Date().toISOString();
    const payload: ProcessingSpeedSessionInput = {
      date,
      started_at: startedAtRef.current,
      ended_at: endedAt,
      duration_ms: Math.max(Date.now() - sessionStartMsRef.current, 1),
      stimulus_seed: seed,
      stimulus_version: "v1",
      interruption_count: interruptionCount,
      focus_lost_ms_total: focusLostMsTotal,
      device_info: {
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      },
      trials: finalTrials,
    };
    setBusy(true);
    setError(null);
    try {
      await onComplete(payload);
      window.localStorage.setItem(LAST_SESSION_KEY, date);
      setPracticeDone(true);
    } catch {
      setError("Could not save this session. You can retry.");
    } finally {
      setBusy(false);
    }
  }

  function answer(userAnswer: boolean | null) {
    if ((phase !== "running" && phase !== "practice") || !trial) return;
    const elapsed = userAnswer === null ? null : Math.max(Date.now() - trialStartMsRef.current, 1);
    const completed: Trial = {
      ...trial,
      user_answer: userAnswer,
      timeout: userAnswer === null,
      rt_ms: elapsed,
      is_correct: userAnswer === null ? false : userAnswer === trial.correct_answer,
    };
    const nextTrials = [...trials, completed];
    setTrials(nextTrials);
    if (phase === "running") {
      trialsRef.current = nextTrials;
    } else {
      practiceTrialsRef.current = nextTrials;
    }
    if (phase === "practice" && nextTrials.length >= PRACTICE_TRIALS) {
      clearTrialTimer();
      setPhase("idle");
      setTrial(null);
      setTrials([]);
      practiceTrialsRef.current = [];
      setPracticeDone(true);
      return;
    }
    const elapsedSession = Date.now() - sessionStartMsRef.current;
    if (phase === "running" && elapsedSession >= SESSION_MS) {
      void finishSession(nextTrials);
      return;
    }
    window.setTimeout(() => {
      nextTrial(nextTrials.length + 1);
    }, 150 + Math.floor(Math.random() * 100));
  }

  function start() {
    const s = `${date}-${Date.now()}`;
    setSeed(s);
    rngRef.current = makeRng(s);
    const iso = new Date().toISOString();
    startedAtRef.current = iso;
    setTrials([]);
    trialsRef.current = [];
    practiceTrialsRef.current = [];
    setError(null);
    setInterruptionCount(0);
    setFocusLostMsTotal(0);
    sessionStartMsRef.current = Date.now();
    setTimeLeftMs(SESSION_MS);
    setPhase("running");
    nextTrial(1);
    sessionTimerRef.current = window.setInterval(() => {
      const left = SESSION_MS - (Date.now() - sessionStartMsRef.current);
      setTimeLeftMs(Math.max(left, 0));
      if (left <= 0) {
        window.clearInterval(sessionTimerRef.current!);
        sessionTimerRef.current = null;
        void finishSession([...trialsRef.current]);
      }
    }, 100);
  }

  function startPractice() {
    const s = `${date}-practice-${Date.now()}`;
    setSeed(s);
    rngRef.current = makeRng(s);
    setTrials([]);
    setTrial(null);
    trialsRef.current = [];
    practiceTrialsRef.current = [];
    setError(null);
    setPhase("practice");
    nextTrial(1);
  }

  function reset() {
    clearTrialTimer();
    if (sessionTimerRef.current) {
      window.clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    setPhase("idle");
    setTrial(null);
    setTrials([]);
    trialsRef.current = [];
    setError(null);
    setBusy(false);
    setInterruptionCount(0);
    setFocusLostMsTotal(0);
  }

  return (
    <fieldset className="journal-field">
      <legend className="stat-label">Processing speed task</legend>
      {phase === "idle" && (
        <div className="rt-widget">
          <p className="rt-feedback">75-second symbol search style task. Tap yes if the target appears.</p>
          {!practiceDone && (
            <p className="rt-feedback">Practice is required first: 6 untimed trials.</p>
          )}
          {!practiceDone && (
            <button type="button" className="chip" onClick={startPractice} disabled={disabled}>
              Start practice
            </button>
          )}
          <button type="button" className="chip" onClick={start} disabled={disabled || !practiceDone}>Start task</button>
        </div>
      )}
      {phase === "practice" && trial && (
        <div className="processing-speed-task">
          <p className="rt-feedback">Practice {trials.length + 1}/{PRACTICE_TRIALS}</p>
          <div className="processing-trial-grid">
            <div className="processing-target">{trial.target_symbol}</div>
            <div className="processing-candidates">
              {trial.candidate_symbols.map((sym, idx) => (
                <span key={`${sym}-${idx}`} className="processing-candidate">{sym}</span>
              ))}
            </div>
          </div>
          <div className="workday-buttons">
            <button type="button" className="chip chip-active" onClick={() => answer(true)}>Yes</button>
            <button type="button" className="chip" onClick={() => answer(false)}>No</button>
            <button type="button" className="rt-cancel" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
      {phase === "running" && trial && (
        <div className="processing-speed-task">
          <p className="rt-feedback">Time left: {(timeLeftMs / 1000).toFixed(1)}s</p>
          <div className="processing-trial-grid">
            <div className="processing-target">{trial.target_symbol}</div>
            <div className="processing-candidates">
              {trial.candidate_symbols.map((sym, idx) => (
                <span key={`${sym}-${idx}`} className="processing-candidate">{sym}</span>
              ))}
            </div>
          </div>
          <div className="workday-buttons">
            <button type="button" className="chip chip-active" onClick={() => answer(true)}>Yes</button>
            <button type="button" className="chip" onClick={() => answer(false)}>No</button>
            <button type="button" className="rt-cancel" onClick={reset}>Cancel</button>
          </div>
          <p className="rt-feedback">{trials.length} trials completed</p>
        </div>
      )}
      {phase === "done" && (
        <div className="rt-result">
          <span className="rt-avg">
            {summary ? `${summary.correct}/${summary.attempted} correct · ${summary.accuracy}% · ${summary.median ?? "—"} ms` : "Done"}
          </span>
          <button type="button" className="chip" onClick={reset}>Run again</button>
        </div>
      )}
      {busy && <p className="rt-feedback">Saving…</p>}
      {error && <p className="rt-feedback rt-too-early">{error}</p>}
    </fieldset>
  );
}
