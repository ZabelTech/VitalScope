import { useCallback, useEffect, useState } from "react";
import { createWater, deleteWater, listWater } from "../api";
import type { WaterEntry } from "../types";

interface Props {
  date: string;
  goalMl?: number;
  quickAdds?: number[];
  title?: string;
}

export function WaterQuickLog({
  date,
  goalMl = 2500,
  quickAdds = [200, 250, 500],
  title = "Water",
}: Props) {
  const [water, setWater] = useState<WaterEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setWater(await listWater(date, date));
  }, [date]);

  useEffect(() => {
    reload().catch(() => setWater([]));
  }, [reload]);

  const total = water.reduce((sum, w) => sum + w.amount_ml, 0);
  const pct = Math.min(100, Math.round((total / goalMl) * 100));

  async function addMl(ml: number) {
    if (saving) return;
    setSaving(true);
    try {
      await createWater({ date, time: null, amount_ml: ml });
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    await deleteWater(id);
    await reload();
  }

  return (
    <div className="overview-card water-quick-log">
      <h3 className="stat-label">
        {title} — {total} / {goalMl} ml
      </h3>
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="water-quick-adds">
        {quickAdds.map((ml) => (
          <button
            key={ml}
            type="button"
            onClick={() => addMl(ml)}
            disabled={saving}
            className="quick-action"
          >
            +{ml} ml
          </button>
        ))}
      </div>
      {water.length > 0 && (
        <ul className="water-list">
          {water.map((w) => (
            <li key={w.id}>
              <span>{w.time ?? "—"}</span>
              <span>{w.amount_ml} ml</span>
              <button
                type="button"
                className="supplement-delete"
                aria-label="Delete water entry"
                onClick={() => onDelete(w.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
