import { BloodworkPlaceholder } from "./BloodworkPlaceholder";
import { JournalPage } from "./JournalPage";
import { OodaPage } from "./OodaPage";
import { TodayMetrics } from "./TodayMetrics";

export function ObservePage() {
  return (
    <OodaPage
      sections={[
        { id: "metrics", label: "Today's metrics", content: <TodayMetrics /> },
        { id: "journal", label: "Journal", content: <JournalPage /> },
        { id: "bloodwork", label: "Bloodwork", content: <BloodworkPlaceholder mode="observe" /> },
      ]}
    />
  );
}
