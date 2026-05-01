import { GoalsPage } from "./GoalsPage";
import { MorningBriefing } from "./MorningBriefing";
import { NightBriefingCard } from "./NightBriefingCard";
import { OodaPage } from "./OodaPage";
import { PlanPage } from "./PlanPage";
import { ProtocolsSection } from "./ProtocolsSection";

export function DecidePage() {
  return (
    <OodaPage
      sections={[
        { id: "morning-briefing", label: "Morning briefing", content: <MorningBriefing /> },
        { id: "night-briefing", label: "Night briefing", content: <NightBriefingCard /> },
        { id: "goals", label: "Goals", content: <GoalsPage /> },
        { id: "plan", label: "Plan", content: <PlanPage /> },
        { id: "protocols", label: "Protocols", content: <ProtocolsSection /> },
      ]}
    />
  );
}
