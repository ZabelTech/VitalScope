import { format, subYears } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { deleteGenomeUpload, fetchGenomeVariants, listGenomeUploads } from "../api";
import type { GenomeUpload, GenomeVariant } from "../types";
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
    <div className="overview-card">
      <ImageUpload
        kind="genome"
        date={today}
        label="Upload a genome file (annotated VCF with RS IDs)"
        hint="Accepts .vcf or .vcf.gz — up to 50 MB."
        onSaved={reload}
      />

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
    </div>
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
