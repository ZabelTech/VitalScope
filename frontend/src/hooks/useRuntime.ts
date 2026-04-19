import { useEffect, useState } from "react";
import { fetchRuntime, type RuntimeInfo } from "../api";

let cached: RuntimeInfo | null = null;
let inflight: Promise<RuntimeInfo> | null = null;
const refreshCallbacks = new Set<() => void>();

export function refreshRuntime(): void {
  cached = null;
  inflight = fetchRuntime();
  inflight.then((r) => {
    cached = r;
    refreshCallbacks.forEach((fn) => fn());
  }).catch(() => {});
}

export function useRuntime(): RuntimeInfo | null {
  const [info, setInfo] = useState<RuntimeInfo | null>(cached);

  useEffect(() => {
    const onRefresh = () => { if (cached) setInfo(cached); };
    refreshCallbacks.add(onRefresh);
    if (!cached) {
      if (!inflight) inflight = fetchRuntime();
      inflight.then((r) => {
        cached = r;
        setInfo(r);
      }).catch(() => {});
    }
    return () => { refreshCallbacks.delete(onRefresh); };
  }, []);

  return info;
}
