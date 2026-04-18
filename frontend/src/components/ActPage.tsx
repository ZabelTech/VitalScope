import { IntakeLog } from "./IntakeLog";
import { NutritionPage } from "./NutritionPage";
import { OodaPage } from "./OodaPage";
import { TodayDashboard } from "./TodayDashboard";

export function ActPage() {
  return (
    <OodaPage
      sections={[
        { id: "today", label: "Today", content: <TodayDashboard /> },
        { id: "log", label: "Supplements & alcohol", content: <IntakeLog /> },
        { id: "intake", label: "Meals & water", content: <NutritionPage /> },
      ]}
    />
  );
}
