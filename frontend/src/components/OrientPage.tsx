import { ActivityHistory } from "./ActivityHistory";
import { BloodworkPlaceholder } from "./BloodworkPlaceholder";
import { OodaPage } from "./OodaPage";
import { TrendsPage } from "./TrendsPage";

export function OrientPage() {
  return (
    <OodaPage
      sections={[
        { id: "trends", label: "Trends", content: <TrendsPage /> },
        { id: "activity", label: "Activity history", content: <ActivityHistory /> },
        { id: "bloodwork", label: "Bloodwork", content: <BloodworkPlaceholder mode="orient" /> },
      ]}
    />
  );
}
