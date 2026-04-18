import { useState } from "react";
import { SupplementsPage } from "./SupplementsPage";

type Tab = "supplements" | "food" | "activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "supplements", label: "Supplements" },
  { key: "food", label: "Food" },
  { key: "activity", label: "Activity" },
];

export function PlanPage() {
  const [tab, setTab] = useState<Tab>("supplements");

  return (
    <div className="journal-page">
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: "0.5rem",
          borderBottom: "1px solid #334155",
          margin: "1rem 0",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              borderBottom:
                tab === t.key ? "2px solid #60a5fa" : "2px solid transparent",
              padding: "0.5rem 1rem",
              color: tab === t.key ? "#e2e8f0" : "#94a3b8",
              cursor: "pointer",
              fontSize: "0.95em",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "supplements" && <SupplementsPage />}
      {tab === "food" && (
        <section className="overview-card">
          <h3>Food plan</h3>
          <div className="overview-card-body">
            <p style={{ opacity: 0.6 }}>
              Coming soon — daily meal plan &amp; macro targets.
            </p>
          </div>
        </section>
      )}
      {tab === "activity" && (
        <section className="overview-card">
          <h3>Activity plan</h3>
          <div className="overview-card-body">
            <p style={{ opacity: 0.6 }}>
              Coming soon — weekly training plan.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
