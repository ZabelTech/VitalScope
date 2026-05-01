import { useCardVisibility } from "../hooks/useCardVisibility";

export function HiddenCardsReveal({ prefixes }: { prefixes: string[] }) {
  const { hiddenIds, unhide } = useCardVisibility();
  const matches: string[] = [];
  for (const id of hiddenIds) {
    if (prefixes.some((p) => id.startsWith(p))) matches.push(id);
  }
  if (matches.length === 0) return null;
  return (
    <div className="cards-hidden-strip">
      <span>
        {matches.length} card{matches.length === 1 ? "" : "s"} hidden
      </span>
      <button
        type="button"
        className="cards-hidden-show"
        onClick={() => matches.forEach(unhide)}
      >
        show
      </button>
    </div>
  );
}
