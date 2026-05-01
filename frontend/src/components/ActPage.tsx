import { IntakeLog } from "./IntakeLog";
import { OodaPage } from "./OodaPage";
import { TodayDashboard } from "./TodayDashboard";

export function ActPage() {
  return (
    <OodaPage
      revealPrefixes={["act.", "today."]}
      sections={[
        { id: "today", label: "Today", content: <TodayDashboard /> },
        { id: "log", label: "Supplements & alcohol", content: <IntakeLog /> },
      ]}
    />
  );
}
