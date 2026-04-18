import { useEffect, useState } from "react";
import type { GarminActivity, Workout } from "../types";
import { ActivityCard } from "./ActivityCard";
import { apiFetch } from "../api";

export function ActivityHistory() {
  const [activities, setActivities] = useState<GarminActivity[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  useEffect(() => {
    apiFetch("/api/activities/recent?limit=30")
      .then((r) => r.json())
      .then(setActivities)
      .catch(() => {});
    apiFetch("/api/workouts/recent?limit=30")
      .then((r) => r.json())
      .then(setWorkouts)
      .catch(() => {});
  }, []);

  return (
    <ActivityCard
      activities={activities}
      workouts={workouts}
      title="Activity history"
      maxItems={30}
      emptyHint="No activity history yet."
    />
  );
}
