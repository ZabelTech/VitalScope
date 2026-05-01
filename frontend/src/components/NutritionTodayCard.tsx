import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchNutritionDaily, fetchNutritionGoals, listNutrientDefs } from "../api";
import type { NutrientDef, NutrientGoals, NutritionDailyTotals } from "../types";
import { Card, CardHeader } from "./Card";
import { NutritionGaps } from "./NutritionGaps";

interface Props {
  date: string;
}

const HIGHLIGHT_KEYS = [
  "calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "fiber_g",
  "iron_mg",
  "magnesium_mg",
];

function fmt(n: number | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return "0";
  const rounded = Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
  return String(rounded);
}

export function NutritionTodayCard({ date }: Props) {
  const [goals, setGoals] = useState<NutrientGoals>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [defs, setDefs] = useState<Record<string, NutrientDef>>({});

  useEffect(() => {
    Promise.all([
      fetchNutritionGoals().catch(() => ({})),
      fetchNutritionDaily(date, date).catch(() => [] as NutritionDailyTotals[]),
      listNutrientDefs().catch(() => [] as NutrientDef[]),
    ]).then(([g, d, ds]) => {
      setGoals(g);
      const today = d.find((row) => row.date === date);
      setTotals(today?.totals ?? {});
      setDefs(Object.fromEntries(ds.map((x) => [x.key, x])));
    });
  }, [date]);

  const keys = HIGHLIGHT_KEYS.filter((k) => goals[k] != null || totals[k] != null);

  return (
    <Card id="today.nutrition-detail" className="overview-card nutrition-today">
      <CardHeader id="today.nutrition-detail">
        Nutrients today
        <Link to="/act#intake" className="card-age" style={{ textDecoration: "underline" }}>
          log meal
        </Link>
      </CardHeader>
      {keys.length === 0 ? (
        <p className="journal-hint">
          No goals set. Seed goals in <code>seed_demo.py</code> or set via API.
        </p>
      ) : (
        <ul className="nutrient-progress-list">
          {keys.map((k) => {
            const goal = goals[k];
            const got = totals[k] ?? 0;
            const pct = goal ? Math.min(100, Math.round((got / goal) * 100)) : 0;
            const label = defs[k]?.label ?? k;
            const unit = defs[k]?.unit ?? "";
            return (
              <li key={k}>
                <div className="nutrient-progress-head">
                  <span>{label}</span>
                  <span className="nutrient-progress-val">
                    {fmt(got, k.endsWith("_g") ? 1 : 0)}
                    {goal ? ` / ${fmt(goal, 0)}` : ""} {unit}
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <NutritionGaps date={date} />
    </Card>
  );
}
