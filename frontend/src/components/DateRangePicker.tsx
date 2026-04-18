import { useEffect, useState } from "react";
import { subDays, subMonths, subYears, format } from "date-fns";
import { fetchDateRange } from "../api";

interface Props {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

export function DateRangePicker({ start, end, onChange }: Props) {
  const [bounds, setBounds] = useState({ earliest: "2021-01-01", latest: fmt(new Date()) });

  useEffect(() => {
    fetchDateRange().then(setBounds).catch(console.error);
  }, []);

  const today = new Date();
  const presets = [
    { label: "30d", start: fmt(subDays(today, 30)) },
    { label: "90d", start: fmt(subDays(today, 90)) },
    { label: "6mo", start: fmt(subMonths(today, 6)) },
    { label: "1yr", start: fmt(subYears(today, 1)) },
    { label: "All", start: bounds.earliest },
  ];

  return (
    <div className="date-range-picker">
      <div className="date-inputs">
        <input
          type="date"
          value={start}
          min={bounds.earliest}
          max={bounds.latest}
          onChange={(e) => onChange(e.target.value, end)}
        />
        <span className="date-sep">to</span>
        <input
          type="date"
          value={end}
          min={bounds.earliest}
          max={bounds.latest}
          onChange={(e) => onChange(start, e.target.value)}
        />
      </div>
      <div className="date-presets">
        {presets.map((p) => (
          <button
            key={p.label}
            className={start === p.start ? "active" : ""}
            onClick={() => onChange(p.start, fmt(today))}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
