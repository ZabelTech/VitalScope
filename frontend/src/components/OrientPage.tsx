import { useState } from "react";
import { format, subDays } from "date-fns";
import { CognitionSection } from "./CognitionSection";
import { DateRangePicker } from "./DateRangePicker";
import { GenotypePhenotypeSection } from "./GenotypePhenotypeSection";
import { LongevitySection } from "./LongevitySection";
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
          { id: "ai-analysis", label: "AI Analysis", content: <OrientAiAnalysis /> },
          { id: "trends", label: "Trends", content: <TrendsPage start={start} end={end} /> },
          { id: "cognition", label: "Cognition", content: <CognitionSection start={start} end={end} /> },
          { id: "longevity", label: "Biological age & longevity", content: <LongevitySection /> },
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
