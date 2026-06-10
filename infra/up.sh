#!/usr/bin/env bash
# Bring up the KampungKaki CSOT backend.
# Prefers `docker compose`; falls back to plain `docker run` (+ host bridge)
# when the compose plugin isn't installed.
set -e
cd "$(dirname "$0")"
CONF="$PWD/mosquitto/config/mosquitto.conf"

if docker compose version >/dev/null 2>&1; then
  exec docker compose up -d --build
fi

echo "[up] compose plugin not found — using docker run + host bridge"
docker rm -f kk-mosquitto kk-redis >/dev/null 2>&1 || true
docker run -d --name kk-redis -p 6379:6379 redis:7-alpine --appendonly yes >/dev/null
docker run -d --name kk-mosquitto -p 1883:1883 -p 9001:9001 \
  -v "$CONF":/mosquitto/config/mosquitto.conf:ro eclipse-mosquitto:2 >/dev/null
echo "[up] broker (1883/9001) + redis (6379) running"

cd ../backend
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
echo "[up] starting CSOT bridge on :8787"
MQTT_HOST=localhost MQTT_PORT=1883 REDIS_URL=redis://localhost:6379 PORT=8787 python bridge.py
