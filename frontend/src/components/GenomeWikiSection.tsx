import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchGenomeWikiIndex,
  fetchGenomeWikiPage,
  runGenomeWikiLint,
} from "../api";
import type {
  GenomeWikiIndexEntry,
  GenomeWikiLintResult,
  GenomeWikiPage,
  GenomeWikiPageType,
} from "../types";
import { Card, CardHeader } from "./Card";

const TYPE_LABELS: Record<GenomeWikiPageType, string> = {
  index: "Index",
  me: "Subject",
  log: "Log",
  variant: "Variants",
  gene: "Genes",
  system: "Systems",
  trait: "Traits",
  drug: "Drugs",
  risk: "Risks",
  ancestry: "Ancestry",
  source: "Sources",
  qa: "Q&A",
  report: "Reports",
  lint: "Lint",
};

const TYPE_ORDER: GenomeWikiPageType[] = [
  "variant", "gene", "system", "trait", "drug", "risk", "ancestry",
  "qa", "report", "source", "lint", "index", "me", "log",
];

export function GenomeWikiSection() {
  const [index, setIndex] = useState<GenomeWikiIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [page, setPage] = useState<GenomeWikiPage | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [linting, setLinting] = useState(false);
  const [lint, setLint] = useState<GenomeWikiLintResult | null>(null);
  const [tab, setTab] = useState<"browse" | "lint">("browse");

  const reload = useCallback(async () => {
    try {
      const rows = await fetchGenomeWikiIndex();
      setIndex(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedPath) {
      setPage(null);
      return;
    }
    setPage(null);
    setPageError(null);
    fetchGenomeWikiPage(selectedPath)
      .then(setPage)
      .catch((e) => setPageError(e instanceof Error ? e.message : String(e)));
  }, [selectedPath]);

  const grouped = useMemo(() => {
    const out: Partial<Record<GenomeWikiPageType, GenomeWikiIndexEntry[]>> = {};
    for (const row of index ?? []) {
      const t = row.type;
      if (!out[t]) out[t] = [];
      out[t]!.push(row);
    }
    return out;
  }, [index]);

  async function onLint() {
    setLinting(true);
    try {
      const result = await runGenomeWikiLint();
      setLint(result);
      await reload();
      setTab("lint");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinting(false);
    }
  }

  function navigateTo(target: string) {
    let cleaned = target.replace(/^\/+/, "");
    if (!cleaned.endsWith(".md")) cleaned = cleaned + ".md";
    if (!cleaned.startsWith("wiki/") && !cleaned.startsWith("raw/")) {
      cleaned = "wiki/" + cleaned;
    }
    setSelectedPath(cleaned);
  }

  return (
    <Card id="orient.genome-wiki" className="genome-wiki-card">
      <CardHeader id="orient.genome-wiki" />

      <div className="genome-wiki-toolbar">
        <div className="tabs-row">
          <button
            type="button"
            className={tab === "browse" ? "chip chip-active" : "chip"}
            onClick={() => setTab("browse")}
          >
            Browse
          </button>
          <button
            type="button"
            className={tab === "lint" ? "chip chip-active" : "chip"}
            onClick={() => setTab("lint")}
          >
            Lint
          </button>
        </div>
        <button
          type="button"
          className="chip"
          onClick={onLint}
          disabled={linting}
        >
          {linting ? "Linting…" : "Run lint"}
        </button>
      </div>

      {error && <p className="orient-ai-error">{error}</p>}

      {tab === "browse" && (
        <div className="genome-wiki-grid">
          <nav className="genome-wiki-nav">
            {!index ? (
              <p className="journal-hint">Loading index…</p>
            ) : index.length === 0 ? (
              <p className="journal-hint">
                No wiki pages yet. Upload a SNPedia bundle in Decide → Entries
                → DNA, then click "Compile genomic wiki".
              </p>
            ) : (
              TYPE_ORDER.map((t) => {
                const rows = grouped[t];
                if (!rows || rows.length === 0) return null;
                return (
                  <section key={t} className="genome-wiki-nav-group">
                    <h4 className="genome-wiki-nav-heading">
                      {TYPE_LABELS[t]} <span className="genome-wiki-nav-count">{rows.length}</span>
                    </h4>
                    <ul className="genome-wiki-nav-list">
                      {rows.map((row) => (
                        <li key={row.path}>
                          <button
                            type="button"
                            className={
                              row.path === selectedPath
                                ? "genome-wiki-nav-item genome-wiki-nav-item--active"
                                : "genome-wiki-nav-item"
                            }
                            onClick={() => setSelectedPath(row.path)}
                          >
                            <span className="genome-wiki-nav-title">{row.title}</span>
                            {row.summary && (
                              <span className="genome-wiki-nav-summary">{row.summary}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </nav>
          <article className="genome-wiki-reader">
            {!selectedPath ? (
              <p className="journal-hint">Pick a page on the left.</p>
            ) : pageError ? (
              <p className="orient-ai-error">{pageError}</p>
            ) : !page ? (
              <p className="journal-hint">Loading page…</p>
            ) : (
              <PageView page={page} onLink={navigateTo} />
            )}
          </article>
        </div>
      )}

      {tab === "lint" && (
        <div className="genome-wiki-lint">
          {!lint ? (
            <p className="journal-hint">
              No lint results yet. Click "Run lint" above to scan the wiki for
              orphans, missing concepts, contradictions, and stale pages.
            </p>
          ) : (
            <LintView result={lint} onLink={navigateTo} />
          )}
        </div>
      )}
    </Card>
  );
}

function PageView({
  page,
  onLink,
}: {
  page: GenomeWikiPage;
  onLink: (target: string) => void;
}) {
  return (
    <div className="genome-wiki-page">
      <FrontmatterView fm={page.frontmatter} />
      <Markdown body={page.body} onLink={onLink} />
    </div>
  );
}

function FrontmatterView({ fm }: { fm: Record<string, unknown> }) {
  const keys = ["rsid", "gene", "my_genotype", "my_zygosity", "evidence_strength", "snpedia_magnitude", "last_reviewed"];
  const present = keys.filter((k) => fm[k] !== undefined && fm[k] !== null && fm[k] !== "");
  if (present.length === 0) return null;
  return (
    <dl className="genome-wiki-fm">
      {present.map((k) => (
        <div key={k} className="genome-wiki-fm-row">
          <dt>{k}</dt>
          <dd>{String(fm[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

function LintView({
  result,
  onLink,
}: {
  result: GenomeWikiLintResult;
  onLink: (target: string) => void;
}) {
  return (
    <div className="genome-wiki-lint-result">
      <h4>Orphans <small>({result.orphans.length})</small></h4>
      {result.orphans.length === 0 ? (
        <p className="journal-hint">No orphan pages.</p>
      ) : (
        <ul>
          {result.orphans.map((p) => (
            <li key={p}>
              <button type="button" className="link-inline" onClick={() => onLink(p)}>{p}</button>
            </li>
          ))}
        </ul>
      )}
      <h4>Missing concepts <small>({result.missing.length})</small></h4>
      {result.missing.length === 0 ? (
        <p className="journal-hint">All wikilinks resolve.</p>
      ) : (
        <ul>
          {result.missing.map((m, i) => (
            <li key={i}>
              <button type="button" className="link-inline" onClick={() => onLink(m.page)}>{m.page}</button>
              {" → "}
              <code>{m.target}</code>
            </li>
          ))}
        </ul>
      )}
      <h4>Stale pages <small>({result.stale.length})</small></h4>
      {result.stale.length === 0 ? (
        <p className="journal-hint">No stale pages.</p>
      ) : (
        <ul>
          {result.stale.map((s) => (
            <li key={s.path}>
              <button type="button" className="link-inline" onClick={() => onLink(s.path)}>{s.path}</button>
              {" — last reviewed "}{s.last_reviewed}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Minimal markdown renderer covering the subset the wiki uses:
// headings (## / ###), bullet lists, blockquote, code spans, **bold** /
// *italic*, fenced tables, and Obsidian-style [[wikilinks]].
export function Markdown({
  body,
  onLink,
}: {
  body: string;
  onLink: (target: string) => void;
}) {
  const blocks = useMemo(() => parseBlocks(body), [body]);
  return (
    <div className="genome-wiki-md">
      {blocks.map((b, i) => renderBlock(b, i, onLink))}
    </div>
  );
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

function parseBlocks(body: string): Block[] {
  const lines = body.split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      out.push({ kind: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push({ kind: "list", items });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*[-:|\s]+\s*\|/.test(lines[i + 1])) {
      const splitRow = (s: string) =>
        s.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push({ kind: "table", header, rows });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("#") && !lines[i].startsWith(">") && !/^[-*]\s+/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push({ kind: "para", text: buf.join(" ") });
  }
  return out;
}

function renderInline(text: string, onLink: (t: string) => void): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[\[([^\]]+?)\]\]|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const target = m[1].trim();
      out.push(
        <button
          key={`l${key++}`}
          type="button"
          className="genome-wiki-link"
          onClick={() => onLink(target)}
        >
          {target}
        </button>,
      );
    } else if (m[2] !== undefined) {
      out.push(<strong key={`b${key++}`}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      out.push(<em key={`i${key++}`}>{m[3]}</em>);
    } else if (m[4] !== undefined) {
      out.push(<code key={`c${key++}`}>{m[4]}</code>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderBlock(block: Block, key: number, onLink: (t: string) => void) {
  if (block.kind === "heading") {
    const Tag = (`h${Math.min(6, block.level + 1)}`) as "h2" | "h3" | "h4" | "h5" | "h6";
    return <Tag key={key}>{renderInline(block.text, onLink)}</Tag>;
  }
  if (block.kind === "para") {
    return <p key={key}>{renderInline(block.text, onLink)}</p>;
  }
  if (block.kind === "list") {
    return (
      <ul key={key}>
        {block.items.map((it, i) => (
          <li key={i}>{renderInline(it, onLink)}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === "quote") {
    return <blockquote key={key}>{renderInline(block.text, onLink)}</blockquote>;
  }
  if (block.kind === "code") {
    return (
      <pre key={key}>
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "table") {
    return (
      <table key={key} className="genome-wiki-table">
        <thead>
          <tr>{block.header.map((h, i) => <th key={i}>{renderInline(h, onLink)}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{renderInline(c, onLink)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  return null;
}
