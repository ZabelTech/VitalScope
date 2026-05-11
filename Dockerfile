# --- stage 1: build the frontend ---
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- stage 2: python runtime ---
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VITALSCOPE_ENV=prod \
    VITALSCOPE_DB=/data/vitalscope.db

WORKDIR /app

# sqlite3 CLI is needed to restore the SNPedia mirror dump and (later)
# attach it into the runtime DB on first boot.
RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Restore the SNPedia mirror at build time into a standalone seed DB.
# This is intentionally placed BEFORE the code COPYs so any source change
# does not invalidate this heavy ~78 MB layer — Docker will reuse the
# cached layer whenever the seed file hasn't changed. The runtime
# entrypoint will copy these tables into the live /data/vitalscope.db
# only when snpedia_pages is absent (idempotent, fast).
COPY data/seed/snpedia_mirror.sql.gz /app/data/seed/snpedia_mirror.sql.gz
RUN mkdir -p /app/data \
    && zcat /app/data/seed/snpedia_mirror.sql.gz | sqlite3 /app/data/snpedia_seed.db \
    && sqlite3 /app/data/snpedia_seed.db "PRAGMA integrity_check;" \
    && sqlite3 /app/data/snpedia_seed.db "SELECT 'snpedia_pages=' || COUNT(*) FROM snpedia_pages;" \
    && rm /app/data/seed/snpedia_mirror.sql.gz

COPY backend ./backend
COPY sync_garmin.py sync_garmin_activities.py sync_strong.py sync_eufy.py seed_demo.py ./
COPY --from=frontend-build /build/dist ./frontend/dist

RUN mkdir -p /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
