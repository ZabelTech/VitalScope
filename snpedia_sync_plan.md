# SNPedia → SQLite sync plan (high-throughput, bot-api aware)

## Goal
Build a new sync script that incrementally downloads SNPedia data through the MediaWiki bot API, normalizes it into SQLite, and preserves enough detail for local genome matching (RSID + genotype/allele), provenance, metadata, links, references, and cited studies.

## Architecture overview

1. **Fetcher layer (Bot API client)**
   - Uses `requests.Session` + retry/backoff.
   - Pulls pages by namespace/category using API continuation (`continue` tokens).
   - Fetches:
     - page metadata (`revisions`, timestamps, pageid, redirect flags)
     - parsed wikitext/templates (for genotype claims)
     - categories, external links, references/citation sections.

2. **Parser layer**
   - Extracts structured variants and genotype statements from:
     - RS pages (e.g., `rs1234`)
     - genotype subpages / allele pages (e.g., `rs1234(A;G)` patterns where present)
     - template parameters used in SNPedia infobox/content.
   - Emits normalized records:
     - variant-level facts (rsid-level)
     - allele/genotype-level facts (for local matching)
     - evidence/references
     - outbound resource links.

3. **Persistence layer (SQLite)**
   - Bulk-upsert into normalized tables.
   - WAL mode, batched transactions, and prepared statements.
   - Incremental sync based on remote revision timestamps/revid.

4. **Incremental orchestration**
   - Default mode: only changed pages since last sync checkpoint.
   - Full mode: complete resync.
   - Crash-safe checkpoints every N pages.

## API strategy (Bot API)

Use the MediaWiki API in descending cost order (cheapest first):

1. **Change discovery** (fast incremental)
   - `list=recentchanges` filtered to SNP-relevant namespaces/categories.
   - Alternative: `generator=categorymembers` for SNP categories + fetch latest revisions.
   - Persist `last_rc_timestamp`/`last_revid` checkpoint.

2. **Page batch fetch**
   - Batch page IDs/titles in chunks (`|`-joined) using `prop=revisions|categories|extlinks|templates|info`.
   - Request only required revision slots/fields (`rvprop=ids|timestamp|content|comment` where needed).

3. **Conditional content fetch**
   - For unchanged pages: skip full parsing.
   - For changed pages: fetch wikitext/parsed content and re-parse.

4. **Politeness + throughput controls**
   - Respect API limits, `maxlag`, and retry-after.
   - Concurrency with bounded worker pool (e.g., 8–24 workers depending on observed throttling).
   - Adaptive rate limiter: lower concurrency on 429/maxlag, increase slowly on stable windows.

## SQLite schema design

Create dedicated tables so metadata and links are first-class, not buried JSON.

### Core entities

- `snpedia_pages`
  - `page_id` (PK), `title`, `ns`, `is_redirect`, `touched_at`, `latest_revid`, `latest_rev_ts`
  - `first_seen_at`, `last_seen_at`, `raw_wikitext` (optional toggle), `raw_json` (API snapshot)

- `snpedia_variants`
  - `rsid` (PK, normalized lowercase like `rs429358`)
  - `page_id` (FK), `chromosome`, `position_build`, `gene`, `summary`
  - `orientation`, `snp_type`, `magnitude`, `repute` (if present), `updated_at`

- `snpedia_genotypes`
  - `id` (PK)
  - `rsid` (FK), `genotype_text` (e.g., `A;G`), `allele1`, `allele2`, `zygosity`
  - `page_title`, `claim_text`, `magnitude`, `repute`, `risk_label`, `effect_direction`
  - Unique key on `(rsid, genotype_text, page_title)`

### Metadata & provenance

- `snpedia_page_categories`
  - `(page_id, category)` unique

- `snpedia_page_templates`
  - `(page_id, template)` unique

- `snpedia_revisions`
  - `revid` (PK), `page_id`, `timestamp`, `user`, `comment`, `sha1`, `size`

- `snpedia_properties`
  - flexible key/value metadata extracted from infobox/template params
  - `(entity_type, entity_id, key, value)`

### External links, references, studies

- `snpedia_external_links`
  - `id` PK, `page_id`, `url`, `domain`, `link_type` (`extlink`, `template_link`, `see_also`)

- `snpedia_references`
  - `id` PK, `page_id`, `ref_key`, `raw_citation`, `title`, `authors`, `journal`, `year`, `doi`, `pmid`, `pmcid`, `url`

- `snpedia_study_links`
  - `id` PK, `page_id`, `rsid` nullable, `genotype_id` nullable, `reference_id` nullable
  - `relation` (`supports`, `contradicts`, `mentions`, `unknown`)

### Sync bookkeeping

- `snpedia_sync_state`
  - single-row state: `last_rc_ts`, `last_full_sync_at`, `api_base`, `schema_version`

- `snpedia_sync_runs`
  - run stats: start/end, mode, pages_seen, pages_changed, variants_upserted, references_upserted, errors

## RSID + allele/genotype extraction plan

1. **RSID detection**
   - Regex canonicalizer: `(?i)\brs\d+\b`.
   - Normalize to lowercase in storage, keep original for display.

2. **Genotype parsing**
   - Capture SNPedia genotype title patterns such as `rs1234(A;G)`.
   - Parse allele pairs from:
     - title suffix
     - infobox/template fields
     - structured list rows in wikitext.

3. **Local genome matching fields**
   - Store both:
     - exact genotype text (`A;G`)
     - split alleles (`allele1=A`, `allele2=G`)
     - canonical unordered key (`AG`) for order-insensitive matching
   - Optional strand/orientation flag if inferable.

4. **Confidence tags**
   - Add parse confidence (`high`, `medium`, `low`) depending on source format.
   - Keep raw snippet offsets for auditability.

## Performance plan (make it fast)

1. **I/O parallelism**
   - Async or thread pool for network calls; parser workers separate from DB writer.

2. **Single writer pattern**
   - One DB writer thread/process receives parsed batches via queue.
   - Large transaction batches (e.g., 500–5000 rows/table batch).

3. **SQLite tuning for ingest**
   - `PRAGMA journal_mode=WAL;`
   - `PRAGMA synchronous=NORMAL;`
   - `PRAGMA temp_store=MEMORY;`
   - `PRAGMA cache_size=-200000;` (approx 200MB, adjustable)
   - Index creation strategy:
     - keep critical lookup indexes during incremental sync
     - defer non-critical index rebuild on first full sync if needed.

4. **Delta-only parsing**
   - Skip parse if `latest_revid` unchanged.
   - Hash content for safety when revision metadata unavailable.

5. **Checkpoint + resume**
   - Persist continuation token and last committed batch ID frequently.
   - Resume without duplicating via idempotent UPSERT keys.

## Data quality and completeness

- Preserve raw payload snapshots (`raw_json`) for reprocessing when parser improves.
- Normalize known identifiers from links/citations:
  - DOI
  - PMID/PMCID
  - ClinVar IDs when linked
  - dbSNP URLs
- Keep many-to-many mappings between page ↔ reference and rsid/genotype ↔ reference.
- Add validation passes:
  - RSID pages without `snpedia_variants` rows
  - genotype pages missing parsed allele pair
  - references without resolvable identifiers.

## Script interface

Proposed script name: `sync_snpedia.py`

CLI:
- `python3 sync_snpedia.py` (incremental default)
- `python3 sync_snpedia.py --full`
- `python3 sync_snpedia.py --since 2020-01-01T00:00:00Z`
- `python3 sync_snpedia.py --workers 16 --batch-size 100`
- `python3 sync_snpedia.py --store-raw-wikitext`

Env vars:
- `VITALSCOPE_DB` (required pattern in this repo)
- `SNPEDIA_API_BASE` (default SNPedia API endpoint)
- `SNPEDIA_USER_AGENT` (required courteous UA)
- Optional credentials if SNPedia bot auth is needed.

## Bot API considerations

- Identify as bot-like client with descriptive User-Agent.
- Respect API etiquette (`maxlag`, backoff, continuation handling).
- If authenticated bot account is available:
  - use login/token flow once per session
  - cache token/cookies securely in `~/.snpediaapp/`
  - renew on auth failure.

## Rollout plan

1. Implement schema + migration guard.
2. Implement API client with retry/maxlag logic.
3. Implement incremental page discovery.
4. Implement parsers for RS and genotype pages.
5. Implement references/external-links extractor.
6. Add sync run telemetry + resumable checkpoints.
7. Run first full sync; profile bottlenecks; tune worker/batch pragmas.
8. Add plugin wrapper (`backend/plugins/snpedia.py`) later if integrating scheduler.

## Acceptance criteria

- Incremental run after baseline completes significantly faster than full run.
- All RSIDs encountered are stored in `snpedia_variants`.
- Genotype/allele rows are queryable for local genome matching.
- References and external links are fully materialized in dedicated tables.
- Every stored claim can be traced back to page/revision/raw snippet.
