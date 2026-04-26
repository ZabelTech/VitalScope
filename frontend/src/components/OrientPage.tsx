import { useState } from "react";
import { format, subDays } from "date-fns";
import { ActivityHistory } from "./ActivityHistory";
import { CognitionSection } from "./CognitionSection";
import { DateRangePicker } from "./DateRangePicker";
import { FormCheckTimeline } from "./FormCheckTimeline";
import { GenotypePhenotypeSection } from "./GenotypePhenotypeSection";
import { LongevitySection } from "./LongevitySection";
import { MorningBriefing } from "./MorningBriefing";
import { OodaPage } from "./OodaPage";
import { OrientAiAnalysis } from "./OrientAiAnalysis";
import { TrendsPage } from "./TrendsPage";

const today = format(new Date(), "yyyy-MM-dd");
const ninetyDaysAgo = format(subDays(new Date(), 90), "yyyy-MM-dd");

export function OrientPage() {
  const [start, setStart] = useState(ninetyDaysAgo);
  const [end, setEnd] = useState(today);

  return (
    <>
      <div className="trends-header">
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
      </div>
      <OodaPage
        sections={[
          { id: "cognition", label: "Cognition", content: <CognitionSection start={start} end={end} /> },
          { id: "briefing", label: "Morning briefing", content: <MorningBriefing /> },
          { id: "ai-analysis", label: "AI Analysis", content: <OrientAiAnalysis /> },
          { id: "longevity", label: "Biological age & longevity", content: <LongevitySection /> },
          { id: "trends", label: "Trends", content: <TrendsPage start={start} end={end} /> },
          { id: "visual-record", label: "Visual record", content: <FormCheckTimeline /> },
          { id: "activity", label: "Activity history", content: <ActivityHistory /> },
          {
            id: "genotype-phenotype",
            label: "Genotype × phenotype",
            content: <GenotypePhenotypeSection />,
          },
        ]}
      />
    </>
  );
}
