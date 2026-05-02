import { format, subYears } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiFetch,
  deleteGenomeUpload,
  fetchGenomeVariants,
  ingestSnpediaBundle,
  listGenomeUploads,
} from "../api";
import type { GenomeUpload, GenomeVariant, GenomeWikiIngestResult } from "../types";
import { Card, CardHeader } from "./Card";
import { ImageUpload } from "./ImageUpload";

const today = format(new Date(), "yyyy-MM-dd");
const fiveYearsAgo = format(subYears(new Date(), 5), "yyyy-MM-dd");

const DOMAIN_LABELS: Record<string, string> = {
  performance: "Performance",
  nutrition: "Nutrition",
  longevity: "Longevity",
  pharmacogenomics: "Pharmacogenomics",
  recovery: "Recovery",
};

export function GenomeSection() {
  const [uploads, setUploads] = useState<GenomeUpload[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setUploads(await listGenomeUploads(fiveYearsAgo, today));
    } catch {
      setUploads([]);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onDelete(id: number) {
    await deleteGenomeUpload(id);
    if (openId === id) setOpenId(null);
    await reload();
  }

  return (
    <Card id="decide.genome-upload">
      <CardHeader id="decide.genome-upload" />
      <ImageUpload
        kind="genome"
        date={today}
        label="Upload a genome file (annotated VCF with RS IDs)"
        hint="Accepts .vcf or .vcf.gz — up to 50 MB."
        onSaved={reload}
      />

      <SnpediaWikiPanel />

      <div className="bloodwork-panels-list">
        <h3 className="stat-label">Saved genomes</h3>
        {uploads.length === 0 ? (
          <p className="journal-hint">No genome files saved yet.</p>
        ) : (
          <ul className="bloodwork-panels-ul">
            {uploads.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="bloodwork-panel-row"
                  onClick={() => setOpenId(openId === u.id ? null : u.id)}
                >
                  <span className="bloodwork-panel-date">{u.date}</span>
                  <span className="bloodwork-panel-meta">
                    {u.variant_count.toLocaleString()} variants · {u.rs_count.toLocaleString()} RS IDs
                  </span>
                </button>
                {openId === u.id && (
                  <GenomeDetail upload={u} onDelete={() => onDelete(u.id)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function GenomeDetail({ upload, onDelete }: { upload: GenomeUpload; onDelete: () => void }) {
  const [variantsByDomain, setVariantsByDomain] = useState<Record<string, GenomeVariant[]> | null>(null);
  const [varErr, setVarErr] = useState(false);

  useEffect(() => {
    fetchGenomeVariants(upload.id)
      .then(setVariantsByDomain)
      .catch(() => setVarErr(true));
  }, [upload.id]);

  return (
    <div className="bloodwork-panel-detail">
      <div className="genome-parse-stats">
        <div className="genome-parse-stat">
          <span className="genome-parse-stat-value">{upload.variant_count.toLocaleString()}</span>
          <span className="genome-parse-stat-label">variants</span>
        </div>
        <div className="genome-parse-stat">
          <span className="genome-parse-stat-value">{upload.rs_count.toLocaleString()}</span>
          <span className="genome-parse-stat-label">with RS ID</span>
        </div>
        <div className="genome-parse-stat">
          <span className="genome-parse-stat-value">{upload.chromosomes.length}</span>
          <span className="genome-parse-stat-label">chromosomes</span>
        </div>
      </div>
      {upload.chromosomes.length > 0 && (
        <p className="journal-hint genome-chrom-list">
          {upload.chromosomes.slice(0, 30).join(", ")}
          {upload.chromosomes.length > 30 ? ` +${upload.chromosomes.length - 30} more` : ""}
        </p>
      )}
      {upload.notes && <p className="journal-hint">{upload.notes}</p>}

      {variantsByDomain === null && !varErr && (
        <p className="journal-hint">Loading variant interpretations…</p>
      )}
      {varErr && (
        <p className="journal-hint">Could not load variant interpretations.</p>
      )}
      {variantsByDomain && Object.keys(variantsByDomain).length === 0 && (
        <p className="journal-hint">No registry variants detected in this file. Upload an annotated VCF with RS IDs to see interpretations.</p>
      )}
      {variantsByDomain && Object.keys(variantsByDomain).length > 0 && (
        <div className="genome-variants-section">
          {Object.entries(variantsByDomain).map(([domain, variants]) => (
            <div key={domain} className="genome-domain-group">
              <h4 className="genome-domain-label">
                {DOMAIN_LABELS[domain] ?? domain}
              </h4>
              <div className="bloodwork-draft-table-wrap">
                <table className="bloodwork-draft-table bloodwork-draft-table--readonly genome-variants-table">
                  <thead>
                    <tr>
                      <th>Gene / Variant</th>
                      <th>Your genotype</th>
                      <th>Interpretation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v) => (
                      <tr key={v.rs_id}>
                        <td>
                          <span className="genome-variant-gene">{v.gene}</span>
                          <span className="genome-variant-name">{v.variant_name}</span>
                          <span className="genome-variant-rsid">{v.rs_id}</span>
                        </td>
                        <td>
                          <span className="genome-variant-label">{v.impact_label}</span>
                        </td>
                        <td className="genome-variant-interp">{v.interpretation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="journal-actions">
        <button
          type="button"
          className="chip chip-danger"
          onClick={() => {
            if (confirm("Delete this genome upload?")) onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// SNPedia bundle uploader + "Compile genomic wiki" trigger. Sits below the
// VCF upload because the wiki ingest needs an existing genome upload to
// match SNPedia pages against.
function SnpediaWikiPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<GenomeWikiIngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "snpedia");
      fd.append("date", today);
      fd.append("file", file);
      const res = await apiFetch("/api/uploads", { method: "POST", body: fd });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`upload failed: ${res.status} ${t}`);
      }
      const json = await res.json();
      setUploadId(json.id);
      setUploadName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onCompile() {
    if (!uploadId) return;
    setCompiling(true);
    setError(null);
    try {
      const r = await ingestSnpediaBundle({ snpedia_upload_id: uploadId });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompiling(false);
    }
  }

  return (
    <div className="genome-snpedia-panel">
      <h3 className="stat-label">Genomic wiki (SNPedia)</h3>
      <p className="journal-hint">
        Upload a ZIP bundle of SNPedia pages (one .md per RS ID) that match
        your genome. The AI compiles per-variant, per-gene, and per-system
        wiki pages into the Orient → Genomic wiki browser.
      </p>
      <div className="genome-snpedia-actions">
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={onFile}
          disabled={uploading || compiling}
        />
        <button
          type="button"
          className="chip chip-primary"
          onClick={onCompile}
          disabled={!uploadId || compiling}
        >
          {compiling ? "Compiling…" : "Compile genomic wiki"}
        </button>
      </div>
      {uploading && <p className="journal-hint">Uploading…</p>}
      {uploadName && uploadId && !compiling && !result && (
        <p className="journal-hint">
          Bundle "{uploadName}" uploaded. Click "Compile genomic wiki" to
          run the AI ingest pass.
        </p>
      )}
      {error && <p className="orient-ai-error">{error}</p>}
      {result && (
        <div className="genome-snpedia-result">
          <p>
            Considered <strong>{result.considered}</strong>; wrote{" "}
            <strong>{result.written}</strong>; skipped for cap{" "}
            <strong>{result.skipped_for_cap}</strong>.
          </p>
          {result.skipped_for_cap > 0 && (
            <p className="journal-hint">
              Raise the per-run cap in Settings → AI Context to include
              the skipped variants.
            </p>
          )}
          {result.errors.length > 0 && (
            <details>
              <summary>{result.errors.length} errors</summary>
              <ul>
                {result.errors.slice(0, 12).map((e, i) => (
                  <li key={i}>
                    <code>{JSON.stringify(e)}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
