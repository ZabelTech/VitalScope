export function BloodworkPlaceholder({ mode }: { mode: "observe" | "orient" }) {
  const body =
    mode === "observe"
      ? "Latest bloodwork panel will show up here — lipids, glucose, HbA1c, iron, vitamin D, etc."
      : "Bloodwork trends over time will show up here — line charts per marker with reference ranges.";
  return (
    <div className="overview-card" style={{ opacity: 0.6 }}>
      <h3>Bloodwork</h3>
      <div className="overview-card-body">
        <p style={{ margin: 0 }}>{body}</p>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.85em" }}>
          Coming soon — no sync plugin or manual entry yet.
        </p>
      </div>
    </div>
  );
}
