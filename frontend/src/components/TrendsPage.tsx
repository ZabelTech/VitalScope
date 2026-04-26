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

interface Props {
  start: string;
  end: string;
}

export function TrendsPage({ start, end }: Props) {
  return (
    <>
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
