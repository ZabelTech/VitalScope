import { format, subMonths } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import {
  deleteBloodworkPanel,
  getBloodworkPanel,
  listBloodworkPanels,
} from "../api";
import type { BloodworkPanel, BloodworkResult } from "../types";
import { ImageUpload } from "./ImageUpload";

const today = format(new Date(), "yyyy-MM-dd");
const twoYearsAgo = format(subMonths(new Date(), 24), "yyyy-MM-dd");

export function BloodworkSection() {
  const [panels, setPanels] = useState<BloodworkPanel[]>([]);
  const [openPanelId, setOpenPanelId] = useState<number | null>(null);
  const [openPanel, setOpenPanel] = useState<BloodworkPanel | null>(null);

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
      return;
    }
    getBloodworkPanel(openPanelId)
      .then(setOpenPanel)
      .catch(() => setOpenPanel(null));
  }, [openPanelId]);

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
                  <PanelDetail panel={openPanel} onDelete={() => onDelete(p.id)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PanelDetail({
  panel,
  onDelete,
}: {
  panel: BloodworkPanel;
  onDelete: () => void;
}) {
  const results = panel.results || [];
  return (
    <div className="bloodwork-panel-detail">
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
                <th>Unit</th>
                <th>Reference</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r: BloodworkResult, i: number) => (
                <tr key={r.id ?? i} className={r.flag ? `bloodwork-flag-${r.flag}` : undefined}>
                  <td>{r.analyte}</td>
                  <td>{r.value !== null ? r.value : r.value_text || "—"}</td>
                  <td>{r.unit || ""}</td>
                  <td>
                    {r.reference_low !== null && r.reference_high !== null
                      ? `${r.reference_low} – ${r.reference_high}`
                      : r.reference_text || ""}
                  </td>
                  <td>{r.flag || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
