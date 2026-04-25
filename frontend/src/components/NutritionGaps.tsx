import { useEffect, useState } from "react";
import { fetchNutritionGaps } from "../api";
import type { NutritionGapItem } from "../types";

interface Props {
  date: string;
  refreshKey?: number;
  /** Wrap in an overview-card with a "Nutrient gaps" heading */
  asCard?: boolean;
}

export function NutritionGaps({ date, refreshKey, asCard }: Props) {
  const [gaps, setGaps] = useState<NutritionGapItem[]>([]);

  useEffect(() => {
    fetchNutritionGaps(date)
      .then(setGaps)
      .catch(() => setGaps([]));
  }, [date, refreshKey]);

  const low = gaps
    .filter((g) => g.status === "low")
    .sort((a, b) => a.delta / a.target - b.delta / b.target)
    .slice(0, 5);

  const high = gaps
    .filter((g) => g.status === "high")
    .sort((a, b) => b.delta / b.target - a.delta / a.target)
    .slice(0, 2);

  const hasContent = low.length > 0 || high.length > 0;

  if (asCard) {
    if (!hasContent && gaps.length === 0) return null;
    return (
      <div className="overview-card">
        <h3 className="stat-label">Nutrient gaps</h3>
        {hasContent ? (
          <GapList low={low} high={high} />
        ) : (
          <p className="journal-hint">All goals on track.</p>
        )}
      </div>
    );
  }

  if (!hasContent) return null;
  return <GapList low={low} high={high} />;
}

function GapList({
  low,
  high,
}: {
  low: NutritionGapItem[];
  high: NutritionGapItem[];
}) {
  return (
    <div className="nutrition-gaps">
      {low.length > 0 && (
        <>
          <div className="gap-section-label">Under target</div>
          {low.map((g) => (
            <GapRow key={g.key} item={g} />
          ))}
        </>
      )}
      {high.length > 0 && (
        <>
          <div className="gap-section-label">Over target</div>
          {high.map((g) => (
            <GapRow key={g.key} item={g} />
          ))}
        </>
      )}
    </div>
  );
}

function GapRow({ item }: { item: NutritionGapItem }) {
  const total = item.consumed + item.from_supplements;
  const pct = item.target > 0 ? Math.round((total / item.target) * 100) : 0;
  return (
    <div className={`gap-row gap-${item.status}`}>
      <span className="gap-label">{item.label}</span>
      <span className="gap-detail">
        {fmt(total)}
        {item.unit} / {fmt(item.target)}
        {item.unit}
        {item.from_supplements > 0 && (
          <span className="gap-supp">
            {" "}+{fmt(item.from_supplements)}
            {item.unit} supps
          </span>
        )}
      </span>
      <span className="gap-pct">{pct}%</span>
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 100) return String(Math.round(n));
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/\.?0+$/, "");
}
