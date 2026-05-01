import { useEffect, useRef } from "react";
import { CARD_INFO, type CardId, type CardInfo } from "../cardInfo";
import { useCardVisibility } from "../hooks/useCardVisibility";

export function CardHelpButton({ id }: { id: CardId }) {
  const { openHelpId, setOpenHelpId } = useCardVisibility();
  const open = openHelpId === id;
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const info: CardInfo = CARD_INFO[id];

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpenHelpId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenHelpId(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpenHelpId]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="card-icon-btn card-help-btn"
        aria-label="About this card"
        aria-expanded={open}
        title="About this card"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpenHelpId(open ? null : id);
        }}
      >
        ⓘ
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="card-help-popover"
          role="dialog"
          aria-label={`About ${info.title}`}
        >
          <div className="card-help-title">{info.title}</div>
          <h4>Source</h4>
          <p>{info.source}</p>
          <h4>What it means</h4>
          <p>{info.meaning}</p>
          {info.science && (
            <>
              <h4>Science</h4>
              <p>{info.science}</p>
            </>
          )}
          <button
            type="button"
            className="card-help-close"
            onClick={(e) => {
              e.stopPropagation();
              setOpenHelpId(null);
            }}
            aria-label="Close"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
