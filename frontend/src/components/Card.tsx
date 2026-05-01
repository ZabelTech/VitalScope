import type { CSSProperties, FormEvent, ReactNode } from "react";
import { CARD_INFO, type CardId } from "../cardInfo";
import { useCardVisibility } from "../hooks/useCardVisibility";
import { CardHelpButton } from "./CardHelpButton";

type CardTag = "div" | "section" | "details" | "form";

export function Card({
  id,
  className = "overview-card",
  as = "div",
  style,
  children,
  onSubmit,
}: {
  id: CardId;
  className?: string;
  as?: CardTag;
  style?: CSSProperties;
  children: ReactNode;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const { isHidden } = useCardVisibility();
  if (isHidden(id)) return null;
  if (as === "section") {
    return (
      <section className={className} style={style}>
        {children}
      </section>
    );
  }
  if (as === "details") {
    return (
      <details className={className} style={style}>
        {children}
      </details>
    );
  }
  if (as === "form") {
    return (
      <form className={className} style={style} onSubmit={onSubmit}>
        {children}
      </form>
    );
  }
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function CardHeader({
  id,
  level = "h3",
  children,
}: {
  id: CardId;
  level?: "h2" | "h3";
  children?: ReactNode;
}) {
  const { hide } = useCardVisibility();
  const info = CARD_INFO[id];
  const Tag = level;
  const headerContent = children ?? info.title;
  return (
    <Tag className="card-header">
      {headerContent}
      <span className="card-actions">
        <CardHelpButton id={id} />
        <button
          type="button"
          className="card-icon-btn card-hide-btn"
          aria-label="Hide card"
          title="Hide card"
          onClick={(e) => {
            e.stopPropagation();
            hide(id);
          }}
        >
          ×
        </button>
      </span>
    </Tag>
  );
}

export function CardHeaderInline({ id }: { id: CardId }) {
  const { hide } = useCardVisibility();
  return (
    <span className="card-actions">
      <CardHelpButton id={id} />
      <button
        type="button"
        className="card-icon-btn card-hide-btn"
        aria-label="Hide card"
        title="Hide card"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          hide(id);
        }}
      >
        ×
      </button>
    </span>
  );
}
