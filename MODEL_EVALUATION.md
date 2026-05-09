# Genome wiki ingest — model evaluation

**Date:** 2026-05-09
**Probe corpus:** top 20 ranked rsids from the user's VCF, including the strand canary rs1333049 (homozygous risk, mag=4.0)
**Test harness:** `ingest_top_genome_rsids.py --top-n 20 --force --concurrency-variants 10 --concurrency-genes 5`
**OpenRouter is the only inference path used in this evaluation.**

## TL;DR

After fixing the strand-orientation plumbing (commits below), all 30+ tested models that complete a run correctly identify the user's diploid alleles. The model choice is now a quality / cost / speed tradeoff:

| Use case | Model | $/Mt in/out | Total $ for ~2700 rsids | Wall (20 rsids) |
|---|---|---|---|---|
| **Best $/quality combo** | **`openai/gpt-oss-20b`** | **$0.03 / $0.14** | **~$2** | 71s |
| **Richest variant prose** | **`qwen/qwen3-235b-a22b-2507`** | $0.07 / $0.10 | ~$2.50 | 158s |
| Best gene pages | `openai/gpt-oss-120b` (paid) | $0.04 / $0.18 | ~$3 | 187s |
| Best ACMG framing | `google/gemma-3-27b-it` | $0.08 / $0.16 | ~$3.50 | 163s |
| Cheap & fast (thinner gene pages) | `google/gemini-2.0-flash-001` | $0.10 / $0.40 | ~$5 | 34s |
| Speed champion | `meta-llama/llama-4-scout` | $0.08 / $0.30 | ~$5 | 40s |
| Premium reliability | `x-ai/grok-4.3` | $1.25 / $2.50 | ~$60 | 83s |

## The strand-orientation problem (fixed)

Before the fix, ~9 of 17 models confidently inverted the genotype on rs1333049 (wrote "(G;G) non-risk" when the user is homozygous for the (C;C) risk allele, mag=4.0). Strand-flippers were:

DeepSeek-v4-flash, Gemini-3.x family (3-flash-preview, 3.1-flash-lite, ~flash-latest = Gemini-3-Flash), Gemini-2.0-flash-001, Grok-4.1-fast, Seed-1.6-flash, Ling-2.6-flash. They cargo-culted the SNPedia `geno1/2/3` listing position rather than anchoring on the magnitude annotation.

### Fix (three small edits)

1. `ingest_top_genome_rsids.py` — pass `r["user_genotype"]` (e.g. `(C;C)`, already plus-strand-resolved by the VCF-vs-SNPedia rank join) into the variant dict as `user_genotype_snpedia`.
2. `backend/app.py` — added `_diploid_from_snpedia_notation()` to convert `(C;C)` → `C/C`. Falls back to `_resolve_diploid_alleles(GT, REF, ALT)` for SNV cases when SNPedia notation is unavailable.
3. `backend/app.py:_compile_variant_page` — strengthened the system prompt with a dedicated **STRAND / GENOTYPE RULE** block:
   - tells the model the diploid alleles in the user message are ground truth
   - explicitly forbids re-deriving from `geno1/2/3` listing position
   - explicitly forbids "plus-orientation conversion"
   - matches SNPedia genotype subpages by unordered allele set, not listing position
   - cross-checks magnitude is on the matching genotype
   - bans echoing `{{Rsnum}}` / `{{PMID}}` wikitext templates

After the fix: **18/18 strand-correct** on the homozygous canary, **18/18 strand-correct** on the heterozygous canary (rs11591147 → G/T).

## Full leaderboard (post-v3, 20 variants)

| Model | Wall | v/g | rc | Template leak | $/Mt in/out | Notes |
|---|---|---|---|---|---|---|
| **gemini-2.0-flash-001** | 34s | **20/17** | 0 | 0 | $0.10/$0.40 | clean run, thinnest gene pages |
| **gemini-3.1-flash-lite** | 34s | 20/17 | 0 | 0 | $0.25/$1.50 | clean, 2.5× pricier than 2.0-flash-001 |
| gemini-2.5-flash-lite | 41s | 19/16 | 1 | 1 | $0.10/$0.40 | 1× upstream 5xx, 1× `{{Rsnum`leak |
| gemini-3-flash-preview | 42s | 20/17 | 0 | 0 | $0.50/$3.00 | clean |
| ~gemini-flash-latest | 46s | 20/17 | 0 | 0 | $0.50/$3.00 | clean (alias requires leading `~`) |
| gemini-2.5-flash | 47s | 18/16 | 1 | 0 | $0.30/$2.50 | 2× validator_link |
| seed-1.6-flash | 83s | 20/16 | 1 | 0 | $0.075/$0.30 | 1× upstream 5xx |
| ling-2.6-flash | 83s | 20/14 | 1 | 0 | $0.08/$0.24 | 3× validator_link, invented `[[1]]`/`[[2]]` numeric refs |
| **grok-4.3** | 83s | 20/17 | 0 | 0 | $1.25/$2.50 | clean, premium reliability |
| haiku-4.5 | 102s | 20/16 | 1 | 0 | $1/$5 | 1× validator_link (`[[sources/snpedia/CYP2C9]]`) |
| **gpt-oss-120b** (paid) | 187s | **20/17** | 0 | 0 | $0.04/$0.18 | clean run, richest content |
| **grok-4.1-fast** | 188s | **20/17** | 0 | 0 | $0.20/$0.50 | clean run, well-balanced |
| gpt-oss-120b:free | 268s | 20/15 | 1 | 0 | free | 1× validator_hedge + 1× malformed JSON |
| deepseek-v4-flash | 307s | 19/16 | 1 | 0 | $0.14/$0.28 | 1× validator_hedge |
| glm-4.7-flash | 310s | 20/**1** | 1 | 0 | $0.06/$0.40 | **gene pass collapses** — Z.AI 5xx storm at concurrency 5 |
| gemini-2.0-flash-lite | 31s | **14/12** | 1 | 0 | $0.075/$0.30 | **6× validator_link** — high hallucination rate |
| sonnet-4.6 | 600s ⏱ | 20/17 | 124 | 0 | $3/$15 | timed out at 600s on system-page validator_hedge retries |
| nemotron-3-super-120b:free | 600s ⏱ | 17/0 | 124 | 0 | free | upstream 524 storm |

### Disqualifications (post-v3)

- **`gemini-2.0-flash-lite-001`** — 6/20 variant validator_link failures (invented wikilinks like `[[rs1057911]]`, `[[PCSK9]]`, `[[irinotecan]]`, `[[hemochromatosis]]`).
- **`z-ai/glm-4.7-flash`** — Z.AI's gene route collapses at concurrency ≥5; 16/17 gene pages 502'd. Variants are fine; gene pages effectively unobtainable.
- **`anthropic/claude-sonnet-4.6`** — too slow at the system-page stage; can't finish 20 rsids in 600s. Output quality is gold-standard but workflow doesn't fit.
- **`nvidia/nemotron-3-super-120b-a12b:free`** — upstream 524 storms throughout; reaches the gene pass before the wall clock kills it on free routing.

### Failure category counts across the 18 runs

| Category | Count | Root cause |
|---|---|---|
| upstream_5xx | 20 | Provider/network — mostly glm-4.7-flash (Z.AI), one-offs elsewhere |
| validator_link | 13 | Model invented disallowed `[[wikilinks]]` (gene names, bare rsids, PMIDs, numbered refs) |
| validator_hedge | 5 | Medical claim without trailing `[[…]]` citation |

## Output quality — head-to-head on the three zero-failure cheap/fast options

### Verbosity

| Model | Variant avg | Gene avg | Style |
|---|---|---|---|
| gemini-2.0-flash-001 | 1,631 c | 1,333 c (thinnest) | compact, bullet-driven |
| gpt-oss-120b paid | 2,292 c | **2,973 c (richest)** | detailed prose + tables |
| grok-4.1-fast | 1,968 c | 2,318 c | balanced |

### Quality scoring

| Dimension | gemini-2.0-flash-001 | gpt-oss-120b paid | grok-4.1-fast |
|---|---|---|---|
| Strand correctness | ✓ | ✓ | ✓ |
| Citation discipline | ✓ every claim | ✓ + PMIDs | ✓ + OMIM/ClinVar/PMID |
| ACMG terminology | minimal | **strong** ("likely-benign", "risk-factor", "ACMG framework") | adequate |
| External citations | SNPedia only | SNPedia + PMID + NEJM | SNPedia + OMIM + ClinVar + PMID |
| Header levels (`##` vs `###`) | ✓ correct | **✗ uses `###` for primary sections** | ✓ correct |
| Variant page depth | thin/generic | rich, multi-bullet with effect sizes | balanced, often quotes effect sizes |
| Gene page depth | **thin** (one short paragraph) | **richest**, structured tables | substantive, sectioned |
| Glitches | invented hgvs `T>A` (actual is C>G) | none | HTML-entity-encoded apostrophes (`&#39;`) |
| ACMG-style framing | absent | explicit ("not pathogenic in ACMG sense") | implicit |

### Concrete examples on rs1333049 / CDKN2A

- **gemini-2.0-flash-001** writes a clean compact "Your data is C/C" + a single uncategorized prose paragraph in "What it means". Generic.
- **gpt-oss-120b paid** writes 6 bulleted clinical categories under `### What it means` (`Risk-factor`, `Coronary artery disease`, `Myocardial infarction and recurrence`, `Peripheral artery disease`, `Stroke`, `Atherosclerosis`), each with OR/CI inline and `[[sources/snpedia/rs1333049]]` per claim. Adds an explicit ACMG framing in `### What we don't know` ("not pathogenic in the ACMG sense; risk-factor not disease-causing").
- **grok-4.1-fast** quotes the OMIM identifier ("CHDS8; OMIM 611139") and specific p-values (`p=1E-13`, `p=3E-56`), more compact. Slightly misleading parenthetical "(homozygous reference in SNPedia ordering)" — geno1 is alphabetical, not reference-ordered.

## Cost projection — full ~2700-rsid backlog

| Model | Total $ | Time @ probe-cadence × 1350 batches |
|---|---|---|
| gpt-oss-120b paid | **~$3** | ~7 hours |
| gemini-2.0-flash-001 | ~$5 | ~76 min |
| gemini-2.5-flash-lite | ~$5 | ~92 min |
| grok-4.1-fast | ~$15 | ~4 hours |
| grok-4.3 | ~$60 | ~3 hours |
| sonnet-4.6 | ~$140 | DNF in 600s blocks |

## OpenAI flash-class addendum

After the main 18-model sweep, four additional OpenAI small/fast models were probed (the openai-equivalent of the "flash" tier):

| Model | Wall | v/g | rc | Strand | $/Mt in/out | Notes |
|---|---|---|---|---|---|---|
| **`openai/gpt-oss-20b`** | 71s | 20/16 | 1 | ✓ | **$0.030 / $0.140** | substantive content, ACMG-aware, PMID-citing |
| `openai/gpt-4o-mini` | 50s | 20/17 | 0 | ✓ | $0.150 / $0.600 | **DQ — GOF/LOF inversion on PCSK9** |
| `openai/gpt-4.1-mini` | 86s | 20/17 | 0 | ✓ | $0.400 / $1.600 | best of the OAI mini line; expensive |
| `openai/gpt-4.1-nano` | 43s | 19/15 | 1 | n/a | $0.100 / $0.400 | **DQ — silent miss on rs1333049** |

### Disqualifications

- **`gpt-4.1-nano`**: failed `validator_hedge` 3× on rs1333049 (the highest-magnitude variant) and again on the PCSK9 gene. Silent miss on the canary is unacceptable for a personal-genome wiki.
- **`gpt-4o-mini`**: clean rc=0, but writes *"Carriers of this variant exhibit a **gain-of-function** effect"* on PCSK9 rs11591147. R46L is loss-of-function, not GOF — every other model calls it LOF correctly. Inverted clinical mechanism is a content-accuracy regression.

## Cheap-untested addendum

Eight additional cheap (<$0.30/$0.30 per Mt) tool-capable models probed after the OpenAI flash sweep:

| Model | Wall | v/g | rc | Strand | $/Mt | Verdict |
|---|---|---|---|---|---|---|
| **`qwen/qwen3-235b-a22b-2507`** | 158s | 20/17 | 0 | ✓ | $0.07/$0.10 | **★ richest variant prose with structured association tables** |
| **`google/gemma-3-27b-it`** | 163s | 20/17 | 0 | ✓ | $0.08/$0.16 | **★ best ACMG framing**; invents URLs occasionally |
| **`meta-llama/llama-4-scout`** | **40s** | 20/17 | 0 | ✓ | $0.08/$0.30 | fastest clean run, but very thin gene pages |
| `amazon/nova-lite-v1` | 74s | 19/15 | 1 | ✓ | $0.06/$0.24 | 2× validator_link |
| `mistralai/mistral-small-3.2-24b-instruct` | 148s | 19/15 | 1 | ✓ | $0.075/$0.20 | 2× validator_hedge |
| `qwen/qwen3-30b-a3b-instruct-2507` | 161s | 20/**8** | 1 | ✓ | $0.09/$0.30 | DQ — gene compile collapses (5× validator_hedge) |
| `qwen/qwen3.5-flash-02-23` | 40s | **0/0** | 1 | n/a | $0.07/$0.26 | DQ — `tool_choice` 404 (Qwen-flash routing rejects forced tool_choice) |
| `nvidia/nemotron-3-nano-30b-a3b` | 460s | **0/0** | 1 | n/a | $0.05/$0.20 | DQ — full upstream 5xx storm (same as nemotron-super free) |

### qwen3-235b — content surprise of the eval

A 235B MoE at $0.07/$0.10 produces variant pages with a **structured clinical-association table** (`| Condition | OR/HR | Study Population | Citation |`) that previously only Sonnet 4.6 emitted. Cites PMID + PMC + NCBI Books URLs. ACMG-aware ("classified as likely-benign in terms of monogenic disease but confers a protective cardiovascular effect through loss-of-function activity"). Heading levels mostly correct.

Caveats:
- Invents the `hgvs` field on rs1333049 (`g.22125504G>A`; actual is C>G). Same hgvs-hallucination pattern as gemini-2.0-flash-001.
- 158s wall for 20 variants vs gpt-oss-20b's 71s — slower per call.

For ~$2.50 total cost vs gpt-oss-20b's ~$2, qwen3-235b offers visibly richer content. **A genuine alternative to gpt-oss-20b for the bulk ingest.**

### gemma-3-27b — best ACMG framing

Strongest ACMG terminology of the cheap tier. Distinguishes user's likely-benign protective variant from FH-causing pathogenic ones — a clinical sophistication absent in most cheap models. Cites OMIM and PubMed URLs.

Caveats:
- **Invents an ACMG URL** (`[[https://www.acmg.net/clinical-guidelines/secondary-findings/pcsk9]]` — ACMG doesn't host per-gene guideline pages). Could be regex-detected and stripped by the validator.
- Sets `hgvs: CDKN2A rs1333049` — not a valid HGVS string.
- Same `###`-as-primary-header issue as gpt-oss line.

### llama-4-scout — fastest clean run

40s for 20 variants @ concurrency=10. Tied with the fastest models in the field, with full 20/17 completion and rc=0. But gene pages are extremely thin — PCSK9 page is one paragraph with no sub-sections. Variant pages also basic (1,440 c). Acceptable if you only care about variant pages, not gene synthesis.

### gpt-oss-20b — also a front-runner

Same content style as gpt-oss-120b paid (which was previously the "best content quality" pick) — `###` heading style, PMID citations, multi-section gene pages, ACMG framing — at:

- **25% lower cost** ($0.03/$0.14 vs $0.04/$0.18)
- **2.6× faster** (71s vs 187s on 20 variants)
- 1 minor regression: 1 gene failure (MAOA validator_link) vs 0 for the 120b

Full backlog: **~$2, ~3 hours** (vs gpt-oss-120b's ~$3, ~7 hours).

## Recommendation

Two top picks emerge from the full 30+ model field. Both at ~$2-3 total backlog cost:

**Primary (cheapest + content-rich): `openai/gpt-oss-20b`** — ~$2 total, ~3 hours runtime. Multi-section gene pages with PMID citations, ACMG framing, no factual content errors observed. Heading-level violation (`###` instead of `##` for primary sections) is the main quality concern; tractable via prompt tightening.

**Alternative (richer variant prose): `qwen/qwen3-235b-a22b-2507`** — ~$2.50 total, ~5 hours. **Best variant pages** in the entire eval, with structured clinical-association tables (Condition / OR / Study population / Citation per row) that match Sonnet's quality at 1/40th the cost. Occasional hgvs hallucinations.

**Alternates by use case:**
- **`google/gemini-2.0-flash-001`** if runtime > content quality. ~76 min, $5, zero failures. Gene pages will be thin.
- **`google/gemma-3-27b-it`** if best ACMG clinical framing matters most. ~$3.50, ~5 hours. Invents URLs occasionally.
- **`meta-llama/llama-4-scout`** if you only care about variant pages, not gene synthesis. ~$5, ~80 min. Gene pages are skim-level.
- **`openai/gpt-oss-120b`** paid if you want the absolute richest gene-level content. ~$3, ~7 hours.
- **`x-ai/grok-4.3`** if you want premium minimal-supervision with no `###` heading concern. ~$60, ~3 hours, 100% completion.

## Open quality issues (post-v3, low priority)

| Issue | Models affected | Effect | Mitigation |
|---|---|---|---|
| `###` used for primary `##` sections | gpt-oss-120b paid (consistent), occasional others | section heading hierarchy off — TOC tools may misread | add explicit prompt instruction or post-validator |
| invented hgvs strings | gemini-2.0-flash-001 (occasional) | false-positive HGVS notation in frontmatter | cross-check against dbSNP API in validator |
| HTML-entity-encoded apostrophes (`&#39;`) | grok-4.1-fast (consistent) | renders as literal entity on most md viewers | one-line regex fix in `_validate_wiki_page` |
| literal `\n` instead of newlines in body | gemini-2.5-flash-lite (occasional, ~5% rate) | page renders as one long line | regex normalize in validator |
| validator_link hallucinations | smaller/cheaper models, especially gemini-2.0-flash-lite, ling-2.6-flash | wikilinks to gene names, PMIDs, numbered refs | already retried 3×; auto-strip before retry could help |

## Probe artifacts

All raw outputs (variant + gene pages, run logs, exit codes, elapsed times) saved at `/tmp/genome_wiki_probe/<slug>_v3/` until next reboot. Reproduce a single run with `bash /tmp/genome_wiki_probe/run_full_v3.sh` (driver) — env var setup, model dispatch, parallel execution, summary.
