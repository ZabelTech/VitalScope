import { useCallback, useEffect, useState } from "react";
import { createWater, listWater } from "../api";
import type { WaterEntry } from "../types";
import { Card, CardHeader } from "./Card";

interface Props {
  date: string;
  goalMl?: number;
  quickAdds?: number[];
  title?: string;
}

// Rough "drink now" suggestion — assumes a 06:00–22:00 hydration window,
// compares the pro-rata expected intake by this hour to the actual.
// Only surfaced for today; back-filling older days doesn't need advice.
function recommendation(total: number, goalMl: number, isToday: boolean): string {
  if (!isToday) return "";
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const startH = 6;
  const endH = 22;
  if (hour < startH) return "Aim for 200 ml after waking.";
  if (hour >= endH) {
    const gap = goalMl - total;
    if (gap > 100) return `Close to bedtime — ${gap} ml short of today's goal.`;
    return "Ease off before bed.";
  }
  const expected = goalMl * Math.min(1, (hour - startH) / (endH - startH));
  const deficit = Math.round((expected - total) / 50) * 50;
  if (deficit <= 0) return "On track — sip as thirsty.";
  const amount = Math.min(750, Math.max(100, deficit));
  return `Drink ~${amount} ml now to catch up.`;
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
  // Gauge runs from 0 to 2× goal so the goal sits dead centre: red on the
  // left (dehydrated), green around the middle (hydrated), blue at the
  // right (overhydrated).
  const gaugeMax = goalMl * 2;
  const markerPct = Math.max(0, Math.min(100, (total / gaugeMax) * 100));
  const todayISO = new Date().toISOString().slice(0, 10);
  const reco = recommendation(total, goalMl, date === todayISO);

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

  return (
    <Card id="today.water-quick-log" className="overview-card water-quick-log">
      <CardHeader id="today.water-quick-log">
        {title} — {total} / {goalMl} ml
      </CardHeader>
      <div className="water-gauge" role="img" aria-label={`${total} ml of ${goalMl} ml goal`}>
        <div className="water-gauge-track">
          <div className="water-gauge-marker" style={{ left: `${markerPct}%` }} />
        </div>
        <div className="water-gauge-labels">
          <span>dehydrated</span>
          <span>hydrated</span>
          <span>overhydrated</span>
        </div>
      </div>
      {reco && <p className="water-reco">{reco}</p>}
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
    </Card>
  );
}
