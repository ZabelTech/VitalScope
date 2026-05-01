import { format, subYears } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { deleteBloodPressure, listBloodPressure } from "../api";
import type { BloodPressureEntry } from "../types";
import { Card, CardHeader } from "./Card";

const today = format(new Date(), "yyyy-MM-dd");
const twoYearsAgo = format(subYears(new Date(), 2), "yyyy-MM-dd");

const TOOLTIP_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 8,
};

export function BloodPressureSection() {
  const [entries, setEntries] = useState<BloodPressureEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listBloodPressure(twoYearsAgo, today);
      setEntries(rows);
    } catch {
      // silently degrade
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteEntry(id: number) {
    await deleteBloodPressure(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const hasPulse = entries.some((e) => e.pulse_bpm != null);

  const chartData = entries.map((e) => ({
    label: e.time ? `${e.date} ${e.time}` : e.date,
    systolic_mmhg: e.systolic_mmhg,
    diastolic_mmhg: e.diastolic_mmhg,
    pulse_bpm: e.pulse_bpm,
  }));

  return (
    <div>
      <p className="longevity-disclaimer">
        Add new readings under <strong>Entries → Blood pressure</strong>.
      </p>

      <Card id="orient.chart-blood-pressure" className="chart-section">
        <CardHeader id="orient.chart-blood-pressure" level="h2">Blood Pressure</CardHeader>

        {entries.length > 0 && (
          <>
            <div
              className="chart-wrap"
              style={{ "--chart-h": "240px" } as React.CSSProperties}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="systolic_mmhg"
                    name="Systolic (mmHg)"
                    stroke="#ef4444"
                    dot={{ r: 4, fill: "#ef4444" }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="diastolic_mmhg"
                    name="Diastolic (mmHg)"
                    stroke="#3b82f6"
                    dot={{ r: 4, fill: "#3b82f6" }}
                    connectNulls
                  />
                  {hasPulse && (
                    <Line
                      type="monotone"
                      dataKey="pulse_bpm"
                      name="Pulse (bpm)"
                      stroke="#22c55e"
                      dot={{ r: 3, fill: "#22c55e" }}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="longevity-entry-list">
              {[...entries].reverse().map((e) => (
                <div key={e.id} className="longevity-entry-row">
                  <span className="longevity-entry-date">
                    {e.date}
                    {e.time ? ` ${e.time}` : ""}
                  </span>
                  <span
                    className="longevity-entry-value"
                    style={{ color: "#ef4444" }}
                  >
                    {e.systolic_mmhg}/{e.diastolic_mmhg} mmHg
                  </span>
                  {e.pulse_bpm != null && (
                    <span className="longevity-entry-meta">
                      pulse {e.pulse_bpm} bpm
                    </span>
                  )}
                  {e.notes && (
                    <span className="longevity-entry-meta">{e.notes}</span>
                  )}
                  <button
                    className="longevity-delete-btn"
                    onClick={() => deleteEntry(e.id)}
                    aria-label="Delete entry"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {entries.length === 0 && !loading && (
          <p className="longevity-empty">No blood pressure entries yet.</p>
        )}
      </Card>
    </div>
  );
}
