import { useEffect, useState } from "react";
import { fetchGoals } from "../api";
import type { UserGoals } from "../types";

let _cached: UserGoals | null = null;
const _listeners = new Set<(g: UserGoals) => void>();

export function notifyGoalsUpdated(goals: UserGoals): void {
  _cached = goals;
  _listeners.forEach((fn) => fn(goals));
}

export function useGoals(): UserGoals | null {
  const [goals, setGoals] = useState<UserGoals | null>(_cached);

  useEffect(() => {
    _listeners.add(setGoals);
    if (!_cached) {
      fetchGoals()
        .then((g) => {
          _cached = g;
          _listeners.forEach((fn) => fn(g));
        })
        .catch(() => {});
    }
    return () => {
      _listeners.delete(setGoals);
    };
  }, []);

  return goals;
}
