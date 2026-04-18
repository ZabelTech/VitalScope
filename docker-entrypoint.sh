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

exec "$@"
