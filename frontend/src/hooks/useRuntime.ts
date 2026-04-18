import { useEffect, useState } from "react";
import { fetchRuntime, type RuntimeInfo } from "../api";

let cached: RuntimeInfo | null = null;
let inflight: Promise<RuntimeInfo> | null = null;

export function useRuntime(): RuntimeInfo | null {
  const [info, setInfo] = useState<RuntimeInfo | null>(cached);

  useEffect(() => {
    if (cached) return;
    if (!inflight) inflight = fetchRuntime();
    inflight.then((r) => {
      cached = r;
      setInfo(r);
    }).catch(() => {
      // leave null — caller treats as "not demo"
    });
  }, []);

  return info;
}
