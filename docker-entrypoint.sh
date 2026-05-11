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

# DB hygiene: when a previous boot was killed mid-write (Fly cycle, OOM,
# disk-full, …) it can leave a stale -wal / -shm pair that triggers
# "sqlite3.OperationalError: database is locked" on the next boot. Force
# WAL mode (idempotent) + a full checkpoint to merge any orphan WAL back
# into the main DB and clear the lock files.
if [ -f "${VITALSCOPE_DB}" ]; then
  sqlite3 "${VITALSCOPE_DB}" <<'EOF' >/dev/null 2>&1 || true
PRAGMA journal_mode=WAL;
PRAGMA wal_checkpoint(TRUNCATE);
EOF
fi

# Conditionally copy the bundled SNPedia mirror seed into the live DB.
# /app/data/snpedia_seed.db is baked into the image at build time. The
# import is heavy (~800 MB of raw_json across snpedia_pages + ~3 M rows
# in snpedia_external_links) and takes 3-6 minutes on a 512 MB Fly
# machine — well past Fly's boot window — so doing it on every boot
# put prod in a permanent restart loop. We now only run the import
# when the live DB is unpopulated (or substantially below the seed's
# row count), making subsequent boots near-instant once Fly's
# persistent volume holds the data. Force a re-import after refreshing
# the bundled seed by setting SNPEDIA_FORCE_RESEED=1.
SEED_DB=/app/data/snpedia_seed.db
if [ -f "$SEED_DB" ]; then
  if [ ! -f "$VITALSCOPE_DB" ]; then
    sqlite3 "$VITALSCOPE_DB" "PRAGMA journal_mode=WAL;" >/dev/null
  fi
  current=$(sqlite3 "$VITALSCOPE_DB" \
    "SELECT COALESCE((SELECT COUNT(*) FROM snpedia_pages), 0);" \
    2>/dev/null || echo "0")
  force=${SNPEDIA_FORCE_RESEED:-0}
  if [ "$force" = "1" ] || [ "$current" -lt 200000 ]; then
    echo "entrypoint: importing SNPedia seed (existing=$current, force=$force)"
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
  else
    echo "entrypoint: SNPedia seed already populated (snpedia_pages=$current), skipping"
  fi
fi

exec "$@"
