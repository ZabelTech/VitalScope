import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export interface OodaSection {
  id: string;
  label: string;
  content: ReactNode;
}

export function OodaPage({
  sections,
}: {
  sections: OodaSection[];
}) {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  return (
    <div className="ooda-page">
      {sections.length > 1 && (
        <nav className="ooda-section-nav">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>
      )}
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="ooda-section">
          <h3 className="ooda-section-label">{s.label}</h3>
          {s.content}
        </section>
      ))}
    </div>
  );
}
