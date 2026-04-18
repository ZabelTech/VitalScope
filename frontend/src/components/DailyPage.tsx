import { format, subDays } from "date-fns";
import { AutoTickedToday } from "./AutoTickedToday";
import { ImageUpload } from "./ImageUpload";
import { IntakeLog } from "./IntakeLog";
import { JournalPage } from "./JournalPage";
import { NutritionTodayCard } from "./NutritionTodayCard";
import { OodaPage } from "./OodaPage";
import { TodayJournal } from "./TodayJournal";
import { WaterQuickLog } from "./WaterQuickLog";

const today = format(new Date(), "yyyy-MM-dd");
const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

export function DailyPage() {
  return (
    <OodaPage
      sections={[
        {
          id: "today",
          label: "Today",
          content: (
            <div className="journal-page">
              <div className="journal-form overview-card">
                <TodayJournal date={today} />
                <IntakeLog wrapped={false} />
              </div>
            </div>
          ),
        },
        { id: "journal", label: "Yesterday's journal", content: <JournalPage initialDate={yesterday} showDate={false} /> },
        { id: "water", label: "Water", content: <WaterQuickLog date={today} /> },
        { id: "activity", label: "Activities & steps", content: <AutoTickedToday date={today} /> },
        {
          id: "nutrition",
          label: "Nutrients",
          content: (
            <>
              <NutritionTodayCard date={today} />
              <ImageUpload
                kind="meal"
                date={today}
                label="Meal photo"
                hint="Snap today's meals so you can cross-reference them with the totals."
              />
            </>
          ),
        },
        {
          id: "form-check",
          label: "Form check",
          content: (
            <ImageUpload
              kind="form"
              date={today}
              label="Form-check photo"
              hint="Upload a photo or short clip from a working set — review later."
            />
          ),
        },
      ]}
    />
  );
}
