import { OodaPage } from "./OodaPage";
import { TodayMetrics } from "./TodayMetrics";

export function ObservePage() {
  return (
    <OodaPage
      sections={[
        { id: "metrics", label: "Today's metrics", content: <TodayMetrics /> },
      ]}
    />
  );
}
