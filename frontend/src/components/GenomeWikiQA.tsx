import { useCallback, useEffect, useState } from "react";
import {
  fetchGenomeWikiIndex,
  fetchGenomeWikiPage,
  submitGenomeWikiQuery,
} from "../api";
import type {
  GenomeWikiAnswer,
  GenomeWikiIndexEntry,
  GenomeWikiPage,
} from "../types";
import { Card, CardHeader } from "./Card";
import { Markdown } from "./GenomeWikiSection";

export function GenomeWikiQA() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<GenomeWikiIndexEntry[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<GenomeWikiPage | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await fetchGenomeWikiIndex({ type: "qa" });
      rows.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
      setHistory(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!openPath) {
      setOpenPage(null);
      setOpenErr(null);
      return;
    }
    setOpenPage(null);
    setOpenErr(null);
    fetchGenomeWikiPage(openPath)
      .then(setOpenPage)
      .catch((e) => setOpenErr(e instanceof Error ? e.message : String(e)));
  }, [openPath]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setSubmitting(true);
    setError(null);
    try {
      const ans: GenomeWikiAnswer = await submitGenomeWikiQuery(q);
      setQuestion("");
      await reload();
      setOpenPath(ans.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function navigateTo(target: string) {
    let cleaned = target.replace(/^\/+/, "");
    if (!cleaned.endsWith(".md")) cleaned = cleaned + ".md";
    if (!cleaned.startsWith("wiki/") && !cleaned.startsWith("raw/")) {
      cleaned = "wiki/" + cleaned;
    }
    setOpenPath(cleaned);
  }

  return (
    <Card id="decide.genome-wiki-qa">
      <CardHeader id="decide.genome-wiki-qa" />
      <form onSubmit={onSubmit} className="genome-wiki-qa-form">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about your genome — e.g. 'what does my MTHFR C677T mean for folate intake?'"
          rows={3}
          disabled={submitting}
        />
        <button type="submit" className="chip chip-primary" disabled={submitting || !question.trim()}>
          {submitting ? "Asking…" : "Ask"}
        </button>
      </form>
      {error && <p className="orient-ai-error">{error}</p>}

      <div className="genome-wiki-qa-history">
        <h3 className="stat-label">Past answers</h3>
        {history.length === 0 ? (
          <p className="journal-hint">No questions asked yet.</p>
        ) : (
          <ul className="genome-wiki-qa-list">
            {history.map((row) => (
              <li key={row.path}>
                <button
                  type="button"
                  className={
                    row.path === openPath
                      ? "genome-wiki-qa-row genome-wiki-qa-row--active"
                      : "genome-wiki-qa-row"
                  }
                  onClick={() => setOpenPath(openPath === row.path ? null : row.path)}
                >
                  <span className="genome-wiki-qa-title">{row.title}</span>
                  {row.summary && (
                    <span className="genome-wiki-qa-summary">{row.summary}</span>
                  )}
                </button>
                {openPath === row.path && (
                  <div className="genome-wiki-qa-body">
                    {openErr && <p className="orient-ai-error">{openErr}</p>}
                    {!openErr && !openPage && <p className="journal-hint">Loading…</p>}
                    {openPage && <Markdown body={openPage.body} onLink={navigateTo} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
