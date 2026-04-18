import { GoalsPage } from "./GoalsPage";
import { OodaPage } from "./OodaPage";
import { PlanPage } from "./PlanPage";

export function DecidePage() {
  return (
    <OodaPage
      sections={[
        { id: "goals", label: "Goals", content: <GoalsPage /> },
        { id: "plan", label: "Plan", content: <PlanPage /> },
      ]}
    />
  );
}
