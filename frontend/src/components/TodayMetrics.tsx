import { format, subDays, subYears } from "date-fns";
import { useEffect, useState } from "react";
import { apiFetch, fetchUploads, listBloodPressure, uploadImageUrl } from "../api";
import { useGoals } from "../hooks/useGoals";
import { useMetricData } from "../hooks/useMetricData";
import type {
  BloodPressureEntry,
  BodyBatteryDaily,
  HeartRateDaily,
  HrvDaily,
  SleepDaily,
  StressDaily,
  Upload,
  WeightDaily,
} from "../types";

const today = format(new Date(), "yyyy-MM-dd");
const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Round to at most 2 decimals; trailing zeros stripped (e.g. 96.0 -> "96", 85.353 -> "85.35").
function fmt2(n: number | null | undefined): string {
  if (n == null) return "--";
  return String(Math.round(n * 100) / 100);
}

function fmtAge(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return "";
  if (isoOrDate.length === 10) {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    if (isoOrDate >= todayStr) return "today";
    const yest = format(subDays(new Date(), 1), "yyyy-MM-dd");
    if (isoOrDate === yest) return "yesterday";
    const diffMs = new Date(todayStr).getTime() - new Date(isoOrDate).getTime();
    const diffD = Math.round(diffMs / 86_400_000);
    if (diffD < 30) return `${diffD}d ago`;
    return isoOrDate;
  }
  const now = Date.now();
  const then = new Date(isoOrDate).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 90) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "yesterday";
  if (diffD < 30) return `${diffD}d ago`;
  return isoOrDate.slice(0, 10);
}

function AgeBadge({ at }: { at: string | null | undefined }) {
  const text = fmtAge(at);
  if (!text) return null;
  return <span className="card-age">{text}</span>;
}

function ScoreBadge({ quality }: { quality: string | null }) {
  if (!quality) return null;
  const colors: Record<string, string> = {
    EXCELLENT: "#22c55e",
    GOOD: "#84cc16",
    FAIR: "#f59e0b",
    POOR: "#ef4444",
  };
  return (
    <span className="score-badge" style={{ background: colors[quality] ?? "#64748b" }}>
      {quality}
    </span>
  );
}

function SleepBar({
  label,
  seconds,
  total,
  color,
}: {
  label: string;
  seconds: number | null;
  total: number;
  color: string;
}) {
  if (seconds == null || total === 0) return null;
  const pct = (seconds / total) * 100;
  return (
    <div className="sleep-bar-row">
      <span className="sleep-bar-label">{label}</span>
      <div className="sleep-bar-track">
        <div className="sleep-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sleep-bar-value">{fmtDuration(seconds)}</span>
    </div>
  );
}

export function TodayMetrics() {
  const { data: sleepData, loading: sleepLoading } = useMetricData<SleepDaily[]>(
    "sleep/daily",
    today,
    today,
  );
  const { data: hrvData, loading: hrvLoading } = useMetricData<HrvDaily[]>(
    "hrv/daily",
    today,
    today,
  );
  const { data: hrData, loading: hrLoading } = useMetricData<HeartRateDaily[]>(
    "heart-rate/daily",
    today,
    today,
  );
  const { data: stressData, loading: stressLoading } = useMetricData<StressDaily[]>(
    "stress/daily",
    today,
    today,
  );
  const { data: bbData, loading: bbLoading } = useMetricData<BodyBatteryDaily[]>(
    "body-battery/daily",
    today,
    today,
  );
  const { data: weightData, loading: weightLoading } = useMetricData<WeightDaily[]>(
    "weight/daily",
    thirtyDaysAgo,
    today,
  );

  const sleep = sleepData?.[0] ?? null;
  const hrv = hrvData?.[0] ?? null;
  const hr = hrData?.[0] ?? null;
  const stress = stressData?.[0] ?? null;
  const bb = bbData?.[0] ?? null;
  const weight =
    weightData && weightData.length > 0 ? weightData[weightData.length - 1] : null;

  const goals = useGoals();

  const [bbCurrent, setBbCurrent] = useState<{
    date: string;
    current: number | null;
    min: number | null;
    max: number | null;
    updated_at: string | null;
  } | null>(null);
  useEffect(() => {
    apiFetch("/api/body-battery/current")
      .then((r) => r.json())
      .then((d) => setBbCurrent(d && d.date ? d : null))
      .catch(() => {});
  }, []);

  const [recentPhotos, setRecentPhotos] = useState<Upload[]>([]);
  useEffect(() => {
    fetchUploads("form")
      .then((uploads) => setRecentPhotos(uploads.slice(0, 3)))
      .catch(() => {});
  }, []);

  const [latestBp, setLatestBp] = useState<BloodPressureEntry | null>(null);
  useEffect(() => {
    const start = format(subYears(new Date(), 2), "yyyy-MM-dd");
    listBloodPressure(start, today)
      .then((rows) => {
        if (rows.length === 0) {
          setLatestBp(null);
          return;
        }
        const sorted = [...rows].sort((a, b) => {
          const ak = `${a.date} ${a.time ?? ""}`;
          const bk = `${b.date} ${b.time ?? ""}`;
          if (ak === bk) return a.id - b.id;
          return ak < bk ? -1 : 1;
        });
        setLatestBp(sorted[sorted.length - 1]);
      })
      .catch(() => {});
  }, []);

  const loading =
    sleepLoading || hrvLoading || hrLoading || stressLoading || bbLoading || weightLoading;

  if (loading) return <div className="chart-loading">Loading today's metrics...</div>;

  const sleepTotal =
    (sleep?.deep_sleep_seconds ?? 0) +
    (sleep?.light_sleep_seconds ?? 0) +
    (sleep?.rem_sleep_seconds ?? 0) +
    (sleep?.awake_seconds ?? 0);

  return (
    <div className="overview">
      <div className="overview-grid-top">
        <div className="overview-card overview-card-large">
          <h3>
            Last Night's Sleep
            <AgeBadge at={sleep?.sleep_end ?? sleep?.date} />
          </h3>
          <div className="overview-card-body">
            <div className="sleep-headline">
              <span className="big-number">{sleep?.sleep_score ?? "--"}</span>
              <ScoreBadge quality={sleep?.sleep_score_quality ?? null} />
              <span className="sleep-duration">
                {fmtDuration(sleep?.sleep_time_seconds ?? null)}
                {goals?.sleep_hours != null && (
                  <span className="goal-hint" style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "0.4rem" }}>
                    goal ≥{goals.sleep_hours.value}h
                  </span>
                )}
              </span>
            </div>
            <div className="sleep-bars">
              <SleepBar label="Deep" seconds={sleep?.deep_sleep_seconds ?? null} total={sleepTotal} color="#1e3a5f" />
              <SleepBar label="Light" seconds={sleep?.light_sleep_seconds ?? null} total={sleepTotal} color="#60a5fa" />
              <SleepBar label="REM" seconds={sleep?.rem_sleep_seconds ?? null} total={sleepTotal} color="#a78bfa" />
              <SleepBar label="Awake" seconds={sleep?.awake_seconds ?? null} total={sleepTotal} color="#fbbf24" />
            </div>
            <div className="sleep-extras">
              <div className="sleep-extra">
                <span className="extra-label">SpO2</span>
                <span className="extra-value">{sleep?.avg_spo2 != null ? `${fmt2(sleep.avg_spo2)}%` : "--"}</span>
              </div>
              <div className="sleep-extra">
                <span className="extra-label">Respiration</span>
                <span className="extra-value">
                  {sleep?.avg_respiration != null ? `${fmt2(sleep.avg_respiration)} br/m` : "--"}
                </span>
              </div>
              <div className="sleep-extra">
                <span className="extra-label">Stress</span>
                <span className="extra-value">
                  {fmt2(sleep?.avg_sleep_stress)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="overview-card">
          <h3>
            Heart Rate Variability
            <AgeBadge at={hrv?.date} />
          </h3>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Last Night Avg</span>
              <span className="big-number">
                {hrv?.last_night_avg ?? "--"}
                <span className="stat-unit">ms</span>
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Weekly Avg</span>
              <span className="stat-value">
                {hrv?.weekly_avg ?? "--"} ms
                {goals?.hrv != null && (
                  <span className="goal-hint" style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "0.4rem" }}>
                    goal ≥{goals.hrv.value}
                  </span>
                )}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">5min High</span>
              <span className="stat-value">{hrv?.last_night_5min_high ?? "--"} ms</span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Baseline</span>
              <span className="stat-value">
                {hrv?.baseline_balanced_low ?? "--"} – {hrv?.baseline_balanced_upper ?? "--"} ms
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="overview-grid-bottom">
        <div className="overview-card">
          <h3>
            Body Battery
            <AgeBadge at={bbCurrent?.updated_at ?? bb?.date} />
          </h3>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Current</span>
              <span className="big-number">
                {bbCurrent?.current ?? "--"}
                <span className="stat-unit">/100</span>
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Today Range</span>
              <span className="stat-value">
                {bbCurrent?.min ?? "--"} – {bbCurrent?.max ?? "--"}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Charged</span>
              <span className="stat-value" style={{ color: "#22c55e" }}>
                +{bb?.charged ?? "--"}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Drained</span>
              <span className="stat-value" style={{ color: "#ef4444" }}>
                −{bb?.drained ?? "--"}
              </span>
            </div>
          </div>
        </div>

        <div className="overview-card">
          <h3>
            Stress
            <AgeBadge at={stress?.date} />
          </h3>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Average</span>
              <span className="big-number">{stress?.avg_stress ?? "--"}</span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Max</span>
              <span className="stat-value">{stress?.max_stress ?? "--"}</span>
            </div>
          </div>
        </div>

        <div className="overview-card">
          <h3>
            Body Composition
            <AgeBadge at={weight?.date} />
          </h3>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Weight</span>
              <span className="big-number">
                {fmt2(weight?.weight_kg)}
                <span className="stat-unit">kg</span>
              </span>
              {goals?.weight_kg != null && (
                <span className="goal-hint" style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "0.5rem" }}>
                  goal {goals.weight_kg.value} kg
                </span>
              )}
            </div>
            <div className="overview-stat">
              <span className="stat-label">BMI</span>
              <span className="stat-value">{fmt2(weight?.bmi)}</span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Body Fat</span>
              <span className="stat-value">
                {weight?.body_fat_pct != null ? `${fmt2(weight.body_fat_pct)}%` : "--"}
                {goals?.body_fat_pct != null && (
                  <span className="goal-hint" style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "0.4rem" }}>
                    goal ≤{goals.body_fat_pct.value}%
                  </span>
                )}
              </span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Water</span>
              <span className="stat-value">
                {weight?.water_pct != null ? `${fmt2(weight.water_pct)}%` : "--"}
              </span>
            </div>
          </div>
        </div>

        <div className="overview-card">
          <h3>
            Heart Rate
            <AgeBadge at={hr?.date} />
          </h3>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Resting</span>
              <span className="big-number">
                {hr?.resting_hr ?? "--"}
                <span className="stat-unit">bpm</span>
              </span>
              {goals?.resting_hr != null && (
                <span className="goal-hint" style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "0.5rem" }}>
                  goal ≤{goals.resting_hr.value}
                </span>
              )}
            </div>
            <div className="overview-stat">
              <span className="stat-label">Min</span>
              <span className="stat-value">{hr?.min_hr ?? "--"} bpm</span>
            </div>
            <div className="overview-stat">
              <span className="stat-label">Max</span>
              <span className="stat-value">{hr?.max_hr ?? "--"} bpm</span>
            </div>
          </div>
        </div>

        <div className="overview-card">
          <h3>
            Blood Pressure
            <AgeBadge at={latestBp?.date} />
          </h3>
          <div className="overview-card-body">
            <div className="overview-stat">
              <span className="stat-label">Systolic / Diastolic</span>
              <span className="big-number">
                {latestBp?.systolic_mmhg ?? "--"}/{latestBp?.diastolic_mmhg ?? "--"}
                <span className="stat-unit">mmHg</span>
              </span>
            </div>
            {latestBp?.pulse_bpm != null && (
              <div className="overview-stat">
                <span className="stat-label">Pulse</span>
                <span className="stat-value">{latestBp.pulse_bpm} bpm</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {recentPhotos.length > 0 && (
        <div className="progress-photo-strip">
          <div className="progress-photo-strip-title">Recent progress photos</div>
          <div className="progress-photo-strip-photos">
            {recentPhotos.map((photo) => (
              <div key={photo.id} className="progress-photo-strip-item">
                <img src={uploadImageUrl(photo.id)} alt={photo.date} />
                <div className="progress-photo-strip-item-date">{photo.date}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
