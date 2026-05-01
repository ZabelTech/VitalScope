import { format } from "date-fns";
import { BloodworkSection } from "./BloodworkSection";
import { GenomeSection } from "./GenomeSection";
import { ImageUpload } from "./ImageUpload";
import { JournalPage } from "./JournalPage";
import { NutritionPage } from "./NutritionPage";
import { OodaPage } from "./OodaPage";

const today = format(new Date(), "yyyy-MM-dd");

export function EntriesPage() {
  return (
    <OodaPage
      sections={[
        { id: "journal", label: "Journal", content: <JournalPage /> },
        { id: "food", label: "Food & water", content: <NutritionPage /> },
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
        { id: "bloodwork", label: "Bloodwork", content: <BloodworkSection /> },
        { id: "dna", label: "DNA", content: <GenomeSection /> },
      ]}
    />
  );
}
