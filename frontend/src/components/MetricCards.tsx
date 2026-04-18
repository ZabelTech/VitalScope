import type { StatValues } from "../types";

interface CardItem {
  label: string;
  stats: StatValues | null;
  unit?: string;
  decimals?: number;
}

function fmt(v: number | null, decimals = 0): string {
  if (v === null || v === undefined) return "--";
  return v.toFixed(decimals);
}

export function MetricCards({ items }: { items: CardItem[] }) {
  return (
    <div className="metric-cards">
      {items.map((item) => (
        <div key={item.label} className="metric-card-group">
          <div className="metric-card-title">{item.label}</div>
          <div className="metric-card-row">
            {(["min", "max", "avg", "median"] as const).map((key) => (
              <div key={key} className="metric-card">
                <div className="metric-card-label">
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </div>
                <div className="metric-card-value">
                  {fmt(item.stats?.[key] ?? null, item.decimals ?? 0)}
                  {item.unit && <span className="metric-card-unit">{item.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
