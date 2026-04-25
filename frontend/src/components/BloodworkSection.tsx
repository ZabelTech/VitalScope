import { format, subMonths } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  deleteBloodworkPanel,
  getAnalyteHistory,
  getBloodworkPanel,
  listBloodworkPanels,
} from "../api";
import type { AnalyteDataPoint, BloodworkPanel, BloodworkResult } from "../types";
import { ImageUpload } from "./ImageUpload";

const today = format(new Date(), "yyyy-MM-dd");
const twoYearsAgo = format(subMonths(new Date(), 24), "yyyy-MM-dd");

export function BloodworkSection() {
  const [panels, setPanels] = useState<BloodworkPanel[]>([]);
  const [openPanelId, setOpenPanelId] = useState<number | null>(null);
  const [openPanel, setOpenPanel] = useState<BloodworkPanel | null>(null);
  const [prevPanel, setPrevPanel] = useState<BloodworkPanel | null>(null);

  const reload = useCallback(async () => {
    try {
      setPanels(await listBloodworkPanels(twoYearsAgo, today));
    } catch {
      setPanels([]);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (openPanelId == null) {
      setOpenPanel(null);
      setPrevPanel(null);
      return;
    }
    getBloodworkPanel(openPanelId)
      .then(setOpenPanel)
      .catch(() => setOpenPanel(null));

    // panels is sorted DESC by date; the "previous" panel in time is at index+1
    const idx = panels.findIndex((p) => p.id === openPanelId);
    if (idx >= 0 && idx + 1 < panels.length) {
      getBloodworkPanel(panels[idx + 1].id)
        .then(setPrevPanel)
        .catch(() => setPrevPanel(null));
    } else {
      setPrevPanel(null);
    }
  }, [openPanelId, panels]);

  async function onDelete(id: number) {
    await deleteBloodworkPanel(id);
    if (openPanelId === id) setOpenPanelId(null);
    await reload();
  }

  return (
    <div className="overview-card">
      <ImageUpload
        kind="bloodwork"
        date={today}
        label="Upload a bloodwork report (PDF or image)"
        hint="Claude extracts analytes into a reviewable table. Not a medical device."
        onSaved={reload}
      />

      <div className="bloodwork-panels-list">
        <h3 className="stat-label">Recent panels</h3>
        {panels.length === 0 ? (
          <p className="journal-hint">No panels saved yet.</p>
        ) : (
          <ul className="bloodwork-panels-ul">
            {panels.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="bloodwork-panel-row"
                  onClick={() =>
                    setOpenPanelId(openPanelId === p.id ? null : p.id)
                  }
                >
                  <span className="bloodwork-panel-date">{p.date}</span>
                  <span className="bloodwork-panel-meta">
                    {p.lab_name || "—"} · {p.result_count ?? 0} analytes
                  </span>
                </button>
                {openPanelId === p.id && openPanel && (
                  <PanelDetail
                    panel={openPanel}
                    prevPanel={prevPanel}
                    onDelete={() => onDelete(p.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  const pct = previous !== 0 ? (diff / Math.abs(previous)) * 100 : 0;
  const sign = diff >= 0 ? "+" : "";
  const cls =
    diff > 0
      ? "bloodwork-delta bloodwork-delta--up"
      : diff < 0
        ? "bloodwork-delta bloodwork-delta--down"
        : "bloodwork-delta bloodwork-delta--flat";
  return (
    <span className={cls}>
      {sign}
      {diff % 1 === 0 ? diff.toFixed(0) : diff.toFixed(1)} ({sign}
      {pct.toFixed(0)}%)
    </span>
  );
}

function AnalyteSparkline({ analyte }: { analyte: string }) {
  const [history, setHistory] = useState<AnalyteDataPoint[] | null>(null);

  useEffect(() => {
    getAnalyteHistory(analyte)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [analyte]);

  const numeric = (history || []).filter((d) => d.value !== null);
  if (!history || numeric.length < 2) return null;

  return (
    <span className="bloodwork-sparkline">
      <ResponsiveContainer width={60} height={24}>
        <LineChart data={numeric}>
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            dot={false}
            strokeWidth={1.5}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, background: "#1e293b", border: "none" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );
}

function PanelDetail({
  panel,
  prevPanel,
  onDelete,
}: {
  panel: BloodworkPanel;
  prevPanel: BloodworkPanel | null;
  onDelete: () => void;
}) {
  const results = panel.results || [];

  const prevByAnalyte = new Map<string, BloodworkResult>();
  for (const r of prevPanel?.results || []) {
    prevByAnalyte.set(r.analyte, r);
  }

  const showDelta = prevByAnalyte.size > 0;

  return (
    <div className="bloodwork-panel-detail">
      {panel.narrative && (
        <div className="bloodwork-narrative">
          <span className="bloodwork-narrative-label">Since your last panel</span>
          <p>{panel.narrative}</p>
        </div>
      )}
      {panel.notes && <p className="journal-hint">{panel.notes}</p>}
      {results.length === 0 ? (
        <p className="journal-hint">No analytes in this panel.</p>
      ) : (
        <div className="bloodwork-draft-table-wrap">
          <table className="bloodwork-draft-table bloodwork-draft-table--readonly">
            <thead>
              <tr>
                <th>Analyte</th>
                <th>Value</th>
                {showDelta && <th>vs prior</th>}
                <th>Trend</th>
                <th>Unit</th>
                <th>Reference</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r: BloodworkResult, i: number) => {
                const prev = prevByAnalyte.get(r.analyte);
                return (
                  <tr
                    key={r.id ?? i}
                    className={r.flag ? `bloodwork-flag-${r.flag}` : undefined}
                  >
                    <td>{r.analyte}</td>
                    <td>{r.value !== null ? r.value : r.value_text || "—"}</td>
                    {showDelta && (
                      <td>
                        {r.value !== null && prev?.value !== undefined && prev.value !== null ? (
                          <Delta current={r.value} previous={prev.value} />
                        ) : (
                          <span className="bloodwork-delta bloodwork-delta--flat">—</span>
                        )}
                      </td>
                    )}
                    <td>
                      <AnalyteSparkline analyte={r.analyte} />
                    </td>
                    <td>{r.unit || ""}</td>
                    <td>
                      {r.reference_low !== null && r.reference_high !== null
                        ? `${r.reference_low} – ${r.reference_high}`
                        : r.reference_text || ""}
                    </td>
                    <td>{r.flag || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {prevPanel && (
        <p className="journal-hint" style={{ marginTop: 6 }}>
          Deltas vs panel dated {prevPanel.date}
        </p>
      )}
      <div className="journal-actions">
        <button
          type="button"
          className="chip chip-danger"
          onClick={() => {
            if (confirm("Delete this panel and all its results?")) onDelete();
          }}
        >
          Delete panel
        </button>
      </div>
    </div>
  );
}
