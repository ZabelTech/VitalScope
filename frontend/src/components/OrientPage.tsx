import { ActivityHistory } from "./ActivityHistory";
import { CognitionSection } from "./CognitionSection";
import { GenotypePhenotypeSection } from "./GenotypePhenotypeSection";
import { LongevitySection } from "./LongevitySection";
import { MorningBriefing } from "./MorningBriefing";
import { OodaPage } from "./OodaPage";
import { OrientAiAnalysis } from "./OrientAiAnalysis";
import { TrendsPage } from "./TrendsPage";

export function OrientPage() {
  return (
    <OodaPage
      sections={[
        { id: "briefing", label: "Morning briefing", content: <MorningBriefing /> },
        { id: "ai-analysis", label: "AI Analysis", content: <OrientAiAnalysis /> },
        { id: "longevity", label: "Biological age & longevity", content: <LongevitySection /> },
        { id: "trends", label: "Trends", content: <TrendsPage /> },
        { id: "cognition", label: "Cognition", content: <CognitionSection /> },
        { id: "activity", label: "Activity history", content: <ActivityHistory /> },
        {
          id: "genotype-phenotype",
          label: "Genotype × phenotype",
          content: <GenotypePhenotypeSection />,
        },
      ]}
    />
  );
}
