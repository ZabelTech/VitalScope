import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getHiddenCards, setCardHidden } from "../api";

interface CardVisibilityCtx {
  hiddenIds: Set<string>;
  isHidden: (id: string) => boolean;
  hide: (id: string) => void;
  unhide: (id: string) => void;
  hiddenCount: (predicate?: (id: string) => boolean) => number;
  openHelpId: string | null;
  setOpenHelpId: (id: string | null) => void;
  loaded: boolean;
}

const Ctx = createContext<CardVisibilityCtx | null>(null);

export function CardVisibilityProvider({ children }: { children: ReactNode }) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [openHelpId, setOpenHelpId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHiddenCards()
      .then((ids) => {
        if (!cancelled) setHiddenIds(new Set(ids));
      })
      .catch((err) => console.warn("getHiddenCards failed:", err))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hide = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setCardHidden(id, true).catch((err) => {
      console.warn(`hide(${id}) failed, reverting:`, err);
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }, []);

  const unhide = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setCardHidden(id, false).catch((err) => {
      console.warn(`unhide(${id}) failed, reverting:`, err);
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    });
  }, []);

  const value = useMemo<CardVisibilityCtx>(
    () => ({
      hiddenIds,
      isHidden: (id: string) => hiddenIds.has(id),
      hide,
      unhide,
      hiddenCount: (predicate) => {
        if (!predicate) return hiddenIds.size;
        let count = 0;
        for (const id of hiddenIds) if (predicate(id)) count += 1;
        return count;
      },
      openHelpId,
      setOpenHelpId,
      loaded,
    }),
    [hiddenIds, hide, unhide, openHelpId, loaded],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCardVisibility(): CardVisibilityCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      hiddenIds: new Set(),
      isHidden: () => false,
      hide: () => {},
      unhide: () => {},
      hiddenCount: () => 0,
      openHelpId: null,
      setOpenHelpId: () => {},
      loaded: true,
    };
  }
  return ctx;
}
