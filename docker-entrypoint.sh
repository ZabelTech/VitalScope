#!/bin/sh
set -eu

# Upload dir lives next to the DB on the persistent volume.
: "${VITALSCOPE_UPLOADS:=/data/uploads}"
export VITALSCOPE_UPLOADS
mkdir -p "$VITALSCOPE_UPLOADS"

# Seed a synthetic DB on first boot when running in demo mode.
if [ "${VITALSCOPE_DEMO:-0}" = "1" ] && [ ! -f "${VITALSCOPE_DB}" ]; then
  echo "entrypoint: demo mode, seeding ${VITALSCOPE_DB}"
  python3 /app/seed_demo.py
fi

# Always copy the bundled SNPedia mirror seed into the live DB at boot.
# /app/data/snpedia_seed.db is baked into the image at build time (in a
# cached Docker layer that only invalidates when the dump file changes),
# so this step is just a table copy from one SQLite file to another —
# INSERT OR REPLACE keyed by primary key, so re-running it is idempotent
# and overwrites any drift with whatever the latest baked snapshot says.
SEED_DB=/app/data/snpedia_seed.db
if [ -f "$SEED_DB" ]; then
  if [ ! -f "$VITALSCOPE_DB" ]; then
    sqlite3 "$VITALSCOPE_DB" "PRAGMA journal_mode=WAL;" >/dev/null
  fi
  echo "entrypoint: copying SNPedia seed into ${VITALSCOPE_DB}"
  for tbl in snpedia_pages snpedia_rsid_catalog snpedia_variants snpedia_genotypes snpedia_external_links snpedia_references snpedia_sync_state snpedia_catalog_state; do
    sqlite3 "$VITALSCOPE_DB" <<SQL
ATTACH '$SEED_DB' AS seed;
CREATE TABLE IF NOT EXISTS main.$tbl AS SELECT * FROM seed.$tbl WHERE 0;
INSERT OR REPLACE INTO main.$tbl SELECT * FROM seed.$tbl;
DETACH seed;
SQL
  done
  final=$(sqlite3 "$VITALSCOPE_DB" "SELECT COUNT(*) FROM snpedia_pages;" 2>/dev/null || echo "?")
  echo "entrypoint: SNPedia seed import done (snpedia_pages=$final)"
fi

exec "$@"
