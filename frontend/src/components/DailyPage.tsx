import { format, subDays } from "date-fns";
import { AutoTickedToday } from "./AutoTickedToday";
import { Card, CardHeader } from "./Card";
import { ImageUpload } from "./ImageUpload";
import { IntakeLog } from "./IntakeLog";
import { JournalPage } from "./JournalPage";
import { MealTextDescribe } from "./MealTextDescribe";
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
              <Card id="daily.today-journal" className="journal-form overview-card">
                <CardHeader id="daily.today-journal" />
                <TodayJournal date={today} />
                <IntakeLog wrapped={false} />
              </Card>
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
            <div className="card-stack">
              <NutritionTodayCard date={today} />
              <ImageUpload
                kind="meal"
                date={today}
                label="Meal photo"
                hint="Snap today's meals so you can cross-reference them with the totals."
              />
              <Card id="daily.meal-describe" className="overview-card journal-form">
                <CardHeader id="daily.meal-describe" />
                <MealTextDescribe
                  date={today}
                  label="Describe a meal (AI)"
                  hint="No photo? Type what you ate — the AI estimates the nutrients."
                />
              </Card>
            </div>
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
