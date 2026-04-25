import { GoalsPage } from "./GoalsPage";
import { NightBriefingCard } from "./NightBriefingCard";
import { OodaPage } from "./OodaPage";
import { PlanPage } from "./PlanPage";

export function DecidePage() {
  return (
    <OodaPage
      sections={[
        { id: "night-briefing", label: "Night briefing", content: <NightBriefingCard /> },
        { id: "goals", label: "Goals", content: <GoalsPage /> },
        { id: "plan", label: "Plan", content: <PlanPage /> },
      ]}
    />
  );
}
