import { ActivityHistory } from "./ActivityHistory";
import { LongevitySection } from "./LongevitySection";
import { OodaPage } from "./OodaPage";
import { OrientAiAnalysis } from "./OrientAiAnalysis";
import { TrendsPage } from "./TrendsPage";

export function OrientPage() {
  return (
    <OodaPage
      sections={[
        { id: "ai-analysis", label: "AI Analysis", content: <OrientAiAnalysis /> },
        { id: "longevity", label: "Biological age & longevity", content: <LongevitySection /> },
        { id: "trends", label: "Trends", content: <TrendsPage /> },
        { id: "activity", label: "Activity history", content: <ActivityHistory /> },
      ]}
    />
  );
}
