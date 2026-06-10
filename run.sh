#!/usr/bin/env bash
# Kampung Kaki — local run only.
# Usage:
#   ./run.sh          # build (if needed) + preview on http://localhost:5173
#   ./run.sh dev      # vite dev server on http://localhost:3000 (hot reload)
set -e
cd "$(dirname "$0")"

MODE="${1:-preview}"

# free common dev ports so re-runs don't fight stale processes
for PORT in 3000 4173 5173; do
  PIDS="$(lsof -ti:"$PORT" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo ">> freeing port $PORT (killing: $PIDS)"
    kill -9 $PIDS 2>/dev/null || true
  fi
done

if ! command -v node >/dev/null 2>&1; then
  echo "!! node.js not found. Install Node 20+ first (https://nodejs.org)."
  exit 1
fi
echo ">> node: $(node -v)"

if [ ! -d node_modules ]; then
  echo ">> installing dependencies..."
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi

case "$MODE" in
  dev)
    echo ">> vite dev server on http://localhost:3000"
    exec npm run dev
    ;;
  preview|"")
    if [ ! -d dist ]; then
      echo ">> no dist/, building first..."
      npm run build
    fi
    echo ">> vite preview on http://localhost:5173"
    exec npx vite preview --host 0.0.0.0 --port 5173
    ;;
  *)
    echo "!! unknown mode: $MODE"
    echo "   usage: ./run.sh [dev|preview]"
    exit 2
    ;;
esac
