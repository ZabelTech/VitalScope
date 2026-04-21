import { useState } from "react";
import { format, subDays } from "date-fns";
import { DateRangePicker } from "./DateRangePicker";
import { GlucoseChart } from "./GlucoseChart";
import { HeartRateChart } from "./HeartRateChart";
import { HrvChart } from "./HrvChart";
import { SleepChart } from "./SleepChart";
import { StressChart } from "./StressChart";
import { BodyBatteryChart } from "./BodyBatteryChart";
import { StepsChart } from "./StepsChart";
import { WeightChart } from "./WeightChart";
import { TrainingChart } from "./TrainingChart";
import { NutritionChart } from "./NutritionChart";

const today = format(new Date(), "yyyy-MM-dd");
const ninetyDaysAgo = format(subDays(new Date(), 90), "yyyy-MM-dd");

export function TrendsPage() {
  const [start, setStart] = useState(ninetyDaysAgo);
  const [end, setEnd] = useState(today);

  return (
    <>
      <div className="trends-header">
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
      </div>
      <GlucoseChart start={start} end={end} />
      <HeartRateChart start={start} end={end} />
      <HrvChart start={start} end={end} />
      <SleepChart start={start} end={end} />
      <StressChart start={start} end={end} />
      <BodyBatteryChart start={start} end={end} />
      <StepsChart start={start} end={end} />
      <WeightChart start={start} end={end} />
      <TrainingChart start={start} end={end} />
      <NutritionChart start={start} end={end} />
    </>
  );
}
