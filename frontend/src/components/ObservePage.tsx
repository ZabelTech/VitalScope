import { format } from "date-fns";
import { ActivityHistory } from "./ActivityHistory";
import { FormCheckTimeline } from "./FormCheckTimeline";
import { MetaboliserProfile } from "./MetaboliserProfile";
import { OodaPage } from "./OodaPage";
import { TodayMetrics } from "./TodayMetrics";

const today = format(new Date(), "yyyy-MM-dd");

export function ObservePage() {
  return (
    <OodaPage
      sections={[
        { id: "metrics", label: "Today's metrics", content: <TodayMetrics /> },
        {
          id: "metaboliser",
          label: "Metaboliser profile",
          content: <MetaboliserProfile date={today} />,
        },
        { id: "visual-record", label: "Visual record", content: <FormCheckTimeline /> },
        { id: "activity", label: "Activity history", content: <ActivityHistory /> },
      ]}
    />
  );
}
