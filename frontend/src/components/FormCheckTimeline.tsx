import { useEffect, useState } from "react";
import { fetchFormCheckHistory, uploadImageUrl } from "../api";
import type { BodyCompositionEstimate, FormCheckHistoryItem } from "../types";

type View = "grid" | "detail" | "compare-select" | "compare-view";

function fmt(val: string | null | undefined): string {
  if (!val) return "—";
  return val.replace(/_/g, " ");
}

function EstimatePanel({ estimate }: { estimate: BodyCompositionEstimate | null }) {
  if (!estimate) {
    return <p className="form-check-no-estimate">No AI estimate saved for this photo.</p>;
  }

  const confidenceColor: Record<string, string> = {
    low: "#ef4444",
    medium: "#f59e0b",
    high: "#22c55e",
  };

  return (
    <div className="form-check-estimate">
      {estimate.confidence && (
        <div style={{ marginBottom: 8 }}>
          <span
            className="confidence-badge"
            style={{ background: (estimate.confidence ? confidenceColor[estimate.confidence] : null) ?? "#64748b" }}
          >
            {estimate.confidence}
          </span>
          <span className="stat-label" style={{ marginLeft: 8 }}>confidence</span>
        </div>
      )}
      <table className="form-check-table">
        <tbody>
          {estimate.body_fat_pct != null && (
            <tr>
              <td>Body fat %</td>
              <td>{estimate.body_fat_pct}%</td>
            </tr>
          )}
          {estimate.muscle_mass_category && (
            <tr>
              <td>Muscle mass</td>
              <td>{fmt(estimate.muscle_mass_category)}</td>
            </tr>
          )}
          {estimate.water_retention && (
            <tr>
              <td>Water retention</td>
              <td>{fmt(estimate.water_retention)}</td>
            </tr>
          )}
          {estimate.visible_definition && (
            <tr>
              <td>Visible definition</td>
              <td>{fmt(estimate.visible_definition)}</td>
            </tr>
          )}
          {estimate.fatigue_signs && (
            <tr>
              <td>Fatigue signs</td>
              <td>{fmt(estimate.fatigue_signs)}</td>
            </tr>
          )}
          {estimate.hydration_signs && (
            <tr>
              <td>Hydration</td>
              <td>{fmt(estimate.hydration_signs)}</td>
            </tr>
          )}
        </tbody>
      </table>
      {estimate.posture_note && (
        <p className="form-check-obs-note">
          <span className="stat-label">Posture</span> {estimate.posture_note}
        </p>
      )}
      {estimate.symmetry_note && (
        <p className="form-check-obs-note">
          <span className="stat-label">Symmetry</span> {estimate.symmetry_note}
        </p>
      )}
      {estimate.general_vigor_note && (
        <p className="form-check-obs-note">
          <span className="stat-label">Vigor</span> {estimate.general_vigor_note}
        </p>
      )}
      {estimate.notes && <p className="form-check-summary-note">{estimate.notes}</p>}
    </div>
  );
}

interface ThumbProps {
  item: FormCheckHistoryItem;
  selectLabel: string | null;
  selected: boolean;
  onClick: () => void;
}

function Thumb({ item, selectLabel, selected, onClick }: ThumbProps) {
  return (
    <li
      className={`form-check-thumb${selected ? " form-check-thumb--selected" : ""}`}
      onClick={onClick}
    >
      <img src={uploadImageUrl(item.upload_id)} alt={item.date} loading="lazy" />
      <div className="form-check-thumb-date">{item.date}</div>
      {item.estimate && <div className="form-check-thumb-badge">AI</div>}
      {selectLabel && (
        <div className="form-check-thumb-select-label">{selectLabel}</div>
      )}
    </li>
  );
}

export function FormCheckTimeline() {
  const [items, setItems] = useState<FormCheckHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("grid");
  const [detail, setDetail] = useState<FormCheckHistoryItem | null>(null);
  const [compareA, setCompareA] = useState<FormCheckHistoryItem | null>(null);
  const [compareB, setCompareB] = useState<FormCheckHistoryItem | null>(null);

  useEffect(() => {
    fetchFormCheckHistory()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="chart-loading">Loading visual record...</div>;
  if (items.length === 0) {
    return (
      <p className="form-check-empty">
        No progress photos yet. Upload a form check in Act &#8594; Log intake.
      </p>
    );
  }

  function handleThumbClick(item: FormCheckHistoryItem) {
    if (view === "compare-select") {
      if (item.upload_id === compareA?.upload_id) {
        setCompareA(null);
        return;
      }
      if (item.upload_id === compareB?.upload_id) {
        setCompareB(null);
        return;
      }
      if (!compareA) { setCompareA(item); return; }
      if (!compareB) { setCompareB(item); return; }
      return;
    }
    setDetail(item);
    setView("detail");
  }

  function backToGrid() {
    setView("grid");
    setDetail(null);
    setCompareA(null);
    setCompareB(null);
  }

  function selLabel(item: FormCheckHistoryItem): string | null {
    if (item.upload_id === compareA?.upload_id) return "A";
    if (item.upload_id === compareB?.upload_id) return "B";
    return null;
  }

  if (view === "detail" && detail) {
    return (
      <div className="form-check-detail">
        <button className="chip" onClick={backToGrid}>&#8592; Back</button>
        <div className="form-check-side-by-side">
          <div className="form-check-photo-col">
            <img
              src={uploadImageUrl(detail.upload_id)}
              alt={detail.date}
              className="form-check-photo"
            />
            <div className="form-check-date">{detail.date}</div>
          </div>
          <div className="form-check-estimate-col">
            <EstimatePanel estimate={detail.estimate} />
          </div>
        </div>
      </div>
    );
  }

  if (view === "compare-view" && compareA && compareB) {
    return (
      <div className="form-check-detail">
        <div className="form-check-toolbar">
          <button
            className="chip"
            onClick={() => { setCompareB(null); setView("compare-select"); }}
          >
            &#8592; Pick again
          </button>
          <button className="chip" onClick={backToGrid}>Grid</button>
        </div>
        <div className="form-check-compare">
          {([compareA, compareB] as const).map((item, i) => (
            <div key={item.upload_id} className="form-check-compare-col">
              <div className="form-check-compare-label">{i === 0 ? "A" : "B"} — {item.date}</div>
              <img
                src={uploadImageUrl(item.upload_id)}
                alt={item.date}
                className="form-check-photo"
              />
              <EstimatePanel estimate={item.estimate} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="form-check-timeline">
      <div className="form-check-toolbar">
        {view === "grid" && (
          <button
            className="chip"
            onClick={() => { setCompareA(null); setCompareB(null); setView("compare-select"); }}
          >
            Compare two
          </button>
        )}
        {view === "compare-select" && (
          <>
            <span className="stat-label">
              {!compareA
                ? "Select photo A"
                : !compareB
                ? "Select photo B"
                : "Ready to compare"}
            </span>
            {compareA && compareB && (
              <button
                className="chip"
                onClick={() => setView("compare-view")}
              >
                Compare &#8594;
              </button>
            )}
            <button className="chip chip-danger" onClick={backToGrid}>Cancel</button>
          </>
        )}
      </div>
      <ul className="form-check-grid">
        {items.map((item) => (
          <Thumb
            key={item.upload_id}
            item={item}
            selectLabel={selLabel(item)}
            selected={selLabel(item) !== null}
            onClick={() => handleThumbClick(item)}
          />
        ))}
      </ul>
    </div>
  );
}
