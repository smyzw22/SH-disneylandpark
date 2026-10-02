FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-ml.txt ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt -r requirements-ml.txt

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY . .

# The SQLite volume is deliberately outside the image so real observations
# survive image upgrades and container restarts.
RUN mkdir -p /app/data \
  && useradd --create-home --uid 10001 appuser \
  && chown -R appuser:appuser /app

USER appuser
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/shanghai_disneyland.db \
    PYTHON_BIN=/opt/venv/bin/python \
    AUTO_COLLECT=true \
    COLLECT_INTERVAL_SEC=300 \
    HISTORY_BACKFILL_DAYS=7

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "server/src/index.js"]
