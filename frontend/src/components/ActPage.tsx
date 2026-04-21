import { BloodworkSection } from "./BloodworkSection";
import { GenomeSection } from "./GenomeSection";
import { IntakeLog } from "./IntakeLog";
import { NightBriefingCard } from "./NightBriefingCard";
import { NutritionPage } from "./NutritionPage";
import { OodaPage } from "./OodaPage";
import { TodayDashboard } from "./TodayDashboard";

export function ActPage() {
  return (
    <OodaPage
      sections={[
        { id: "today", label: "Today", content: <TodayDashboard /> },
        { id: "night-briefing", label: "Night briefing", content: <NightBriefingCard /> },
        { id: "log", label: "Supplements & alcohol", content: <IntakeLog /> },
        { id: "intake", label: "Meals & water", content: <NutritionPage /> },
        { id: "bloodwork", label: "Bloodwork", content: <BloodworkSection /> },
        { id: "genome", label: "Genome", content: <GenomeSection /> },
      ]}
    />
  );
}
