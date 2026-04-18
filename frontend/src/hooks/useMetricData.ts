import { useEffect, useState } from "react";
import { fetchMetric } from "../api";

export function useMetricData<T>(endpoint: string, start: string, end: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMetric<T>(endpoint, start, end)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => console.error(`Failed to fetch ${endpoint}:`, err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, start, end]);

  return { data, loading };
}
