#!/bin/sh
set -eu

# Seed a synthetic DB on first boot when running in demo mode.
if [ "${VITALSCOPE_DEMO:-0}" = "1" ] && [ ! -f "${VITALSCOPE_DB}" ]; then
  echo "entrypoint: demo mode, seeding ${VITALSCOPE_DB}"
  python3 /app/seed_demo.py
fi

exec "$@"
