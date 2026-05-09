#!/usr/bin/env bash
# Probe one or more OpenRouter models against the genome-wiki ingest pipeline.
#
# For each model: provisions a per-model probe dir, symlinks the rank cache
# and position TSVs from your real wiki dir, runs ingest_top_genome_rsids.py
# with --force on the top-N rsids, and reports wall time + page counts.
#
# Per-model probe dirs land under $PROBE_OUT_DIR/<slug>/ and contain:
#   wiki/variants/, wiki/genes/, wiki/systems/   (the AI-compiled pages)
#   run.log                                       (full stdout/stderr)
#   exit_code.txt                                 (process rc)
#   elapsed_seconds.txt                           (wall time)
#
# Usage examples:
#   # Default 4-model sweep, --top-n 20
#   OPENROUTER_API_KEY=sk-or-... ./scripts/probe_genome_wiki_models.sh
#
#   # Custom model list (whitespace-separated)
#   OPENROUTER_API_KEY=sk-or-... \
#     MODELS="openai/gpt-oss-20b google/gemini-2.0-flash-001" \
#     ./scripts/probe_genome_wiki_models.sh
#
#   # Single model, smaller batch, shorter timeout
#   OPENROUTER_API_KEY=sk-or-... TOP_N=5 PER_MODEL_TIMEOUT=300 \
#     MODELS="x-ai/grok-4.3" \
#     ./scripts/probe_genome_wiki_models.sh
#
# Prerequisites:
#   - OPENROUTER_API_KEY in env
#   - venv activated (script will source venv/bin/activate from repo root)
#   - $VITALSCOPE_GENOME_WIKI populated with rank_by_magnitude.tsv +
#     rsid_positions_hg{19,38}.tsv + snpedia_gene_intervals_hg38.tsv +
#     dbsnp_gene_lookup.tsv (run the ingest's --rebuild-rank pass first)
#
# After a probe run, the strand canary is rs1333049 → C/C (homozygous risk,
# magnitude=4.0); a flipped (G;G) means the model failed the strand check
# and should be disqualified for production use.

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "OPENROUTER_API_KEY is not set — export it or wire to a secret store" >&2
  exit 1
fi

# venv activation
if [ -f venv/bin/activate ]; then
  # shellcheck disable=SC1091
  source venv/bin/activate
fi

WIKI_ROOT="${VITALSCOPE_GENOME_WIKI:-$REPO_ROOT/genome_wiki}"
if [ ! -f "$WIKI_ROOT/rank_by_magnitude.tsv" ]; then
  echo "Missing rank cache at $WIKI_ROOT/rank_by_magnitude.tsv" >&2
  echo "Run: python3 ingest_top_genome_rsids.py --rebuild-rank --top-n 0" >&2
  exit 1
fi

PROBE_OUT_DIR="${PROBE_OUT_DIR:-/tmp/genome_wiki_probe}"
mkdir -p "$PROBE_OUT_DIR"

TOP_N="${TOP_N:-20}"
CONCURRENCY_VARIANTS="${CONCURRENCY_VARIANTS:-10}"
CONCURRENCY_GENES="${CONCURRENCY_GENES:-5}"
PER_MODEL_TIMEOUT="${PER_MODEL_TIMEOUT:-600}"
GENOME_WIKI_AI_TIMEOUT_SEC="${GENOME_WIKI_AI_TIMEOUT_SEC:-180}"
export VITALSCOPE_AI_PROVIDER=openrouter
export GENOME_WIKI_AI_TIMEOUT_SEC

# Default 4-model sweep — winners + competitive options from MODEL_EVALUATION.md
DEFAULT_MODELS=(
  "openai/gpt-oss-20b"                    # cheapest content-rich pick
  "qwen/qwen3-235b-a22b-2507"             # richest variant prose
  "google/gemini-2.0-flash-001"           # speed
  "x-ai/grok-4.3"                         # premium reliability
)

# Read $MODELS env var or arrive on argv
if [ "$#" -gt 0 ]; then
  MODELS_ARRAY=("$@")
elif [ -n "${MODELS:-}" ]; then
  # shellcheck disable=SC2206
  MODELS_ARRAY=( $MODELS )
else
  MODELS_ARRAY=("${DEFAULT_MODELS[@]}")
fi

slug_of() {
  # turn "openai/gpt-oss-20b" → "openai_gpt_oss_20b"
  echo "$1" | sed 's|/|_|g; s|[^a-zA-Z0-9_]|_|g; s|^~||'
}

run_one() {
  local model="$1"
  local slug
  slug=$(slug_of "$model")
  local out="$PROBE_OUT_DIR/$slug"

  rm -rf "$out"
  mkdir -p "$out"
  for f in rank_by_magnitude.tsv rsid_positions_hg19.tsv rsid_positions_hg38.tsv \
           snpedia_gene_intervals_hg38.tsv dbsnp_gene_lookup.tsv; do
    if [ -f "$WIKI_ROOT/$f" ]; then
      ln -sf "$WIKI_ROOT/$f" "$out/$f"
    fi
  done

  local start end rc
  start=$(date +%s)
  VITALSCOPE_GENOME_WIKI="$out" timeout "$PER_MODEL_TIMEOUT" \
    python3 -u ingest_top_genome_rsids.py \
      --top-n "$TOP_N" --force \
      --concurrency-variants "$CONCURRENCY_VARIANTS" \
      --concurrency-genes "$CONCURRENCY_GENES" \
      --model "$model" \
      > "$out/run.log" 2>&1
  rc=$?
  end=$(date +%s)
  echo $((end-start)) > "$out/elapsed_seconds.txt"
  echo "$rc" > "$out/exit_code.txt"
  local v g
  v=$(ls "$out/wiki/variants/"*.md 2>/dev/null | wc -l)
  g=$(ls "$out/wiki/genes/"*.md 2>/dev/null | wc -l)
  echo "[done $slug] rc=$rc elapsed=$((end-start))s v=$v g=$g model=$model"
}
export -f run_one slug_of
export PROBE_OUT_DIR WIKI_ROOT TOP_N CONCURRENCY_VARIANTS CONCURRENCY_GENES PER_MODEL_TIMEOUT

echo "==> Probing ${#MODELS_ARRAY[@]} model(s) in parallel"
echo "    top-n=$TOP_N concurrency=${CONCURRENCY_VARIANTS}v/${CONCURRENCY_GENES}g timeout=${PER_MODEL_TIMEOUT}s"
echo "    output: $PROBE_OUT_DIR"
echo

pids=()
for model in "${MODELS_ARRAY[@]}"; do
  echo "[start] $model"
  run_one "$model" &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done

echo
echo "=== SUMMARY ==="
for model in "${MODELS_ARRAY[@]}"; do
  slug=$(slug_of "$model")
  out="$PROBE_OUT_DIR/$slug"
  el=$(cat "$out/elapsed_seconds.txt" 2>/dev/null || echo ?)
  rc=$(cat "$out/exit_code.txt" 2>/dev/null || echo ?)
  v=$(ls "$out/wiki/variants/"*.md 2>/dev/null | wc -l)
  g=$(ls "$out/wiki/genes/"*.md 2>/dev/null | wc -l)
  printf "%-44s rc=%-3s elapsed=%-4ss v=%-2s g=%-2s\n" "$model" "$rc" "$el" "$v" "$g"
done

echo
echo "=== STRAND CANARY (rs1333049 → C/C; flipped (G;G) means model failed strand discipline) ==="
for model in "${MODELS_ARRAY[@]}"; do
  slug=$(slug_of "$model")
  page="$PROBE_OUT_DIR/$slug/wiki/variants/rs1333049_CDKN2A.md"
  if [ -f "$page" ]; then
    # Models occasionally emit literal '\n' instead of real newlines in body,
    # so collapse the page to one line before the canary scan, and look at
    # text after "Your data" until the next section heading.
    flat=$(tr -d '\n' < "$page" | sed 's/\\n/ /g')
    your_data=$(echo "$flat" | sed -n 's/.*Your data\(.*\)What it means.*/\1/p' | head -c 200)
    if echo "$your_data" | grep -qiE "C/C|\(C;C\)|homozygous.*C|two.*C alleles"; then
      mark="✓"
    elif echo "$your_data" | grep -qiE "G/G|\(G;G\)|homozygous.*G|two.*G alleles"; then
      mark="✗ FLIPPED"
    else
      mark="? unclear"
    fi
    yd_short=$(echo "$your_data" | tr -s ' ' | head -c 130)
  else
    yd_short="(no page)"; mark="·"
  fi
  printf "%-12s  %-44s %s\n" "$mark" "$model" "$yd_short"
done
