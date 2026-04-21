import { ActivityHistory } from "./ActivityHistory";
import { CognitionSection } from "./CognitionSection";
import { OodaPage } from "./OodaPage";
import { OrientAiAnalysis } from "./OrientAiAnalysis";
import { TrendsPage } from "./TrendsPage";

export function OrientPage() {
  return (
    <OodaPage
      sections={[
        { id: "ai-analysis", label: "AI Analysis", content: <OrientAiAnalysis /> },
        { id: "trends", label: "Trends", content: <TrendsPage /> },
        { id: "cognition", label: "Cognition", content: <CognitionSection /> },
        { id: "activity", label: "Activity history", content: <ActivityHistory /> },
      ]}
    />
  );
}
