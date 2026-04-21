import { ActivityHistory } from "./ActivityHistory";
import { GenotypePhenotypeSection } from "./GenotypePhenotypeSection";
import { OodaPage } from "./OodaPage";
import { OrientAiAnalysis } from "./OrientAiAnalysis";
import { TrendsPage } from "./TrendsPage";

export function OrientPage() {
  return (
    <OodaPage
      sections={[
        { id: "ai-analysis", label: "AI Analysis", content: <OrientAiAnalysis /> },
        { id: "trends", label: "Trends", content: <TrendsPage /> },
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
