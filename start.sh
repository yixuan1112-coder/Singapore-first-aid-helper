#!/usr/bin/env bash
# KampungKaki — one command to set up and run EVERYTHING (app + live demo + AI).
#
#   ./start.sh          build + run the whole stack, follow logs
#   ./start.sh -d       run detached (background)
#   ./start.sh down     stop everything
#
# Prereqs it checks for you: Docker running, Ollama signed in (for the AI).
set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
say()  { printf "${GREEN}>>${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!!${NC} %s\n" "$1"; }
die()  { printf "${RED}xx${NC} %s\n" "$1"; exit 1; }

if [ "$1" = "down" ]; then
  say "stopping KampungKaki…"
  exec docker compose -f infra/docker-compose.yml down
fi

# 1 — Docker must be installed and running.
command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker Desktop: https://docker.com/products/docker-desktop"
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop, then re-run."
docker compose version >/dev/null 2>&1 || die "The 'docker compose' plugin is missing. Update Docker Desktop."
say "Docker is running."

# 2 — first-run env: app degrades gracefully without keys, so just seed the file.
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  warn "Created .env.local from the template. Fill DATAMALL/ONEMAP keys later for live map layers (optional)."
fi

# 3 — Ollama (the AI). The model tag :cloud routes to ollama.com under your account.
if curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then
  say "Ollama daemon reachable on :11434."
else
  warn "Ollama is not responding on :11434 — the AI Kaki agents won't work until it is."
  warn "Install it (https://ollama.com/download), then run:  ollama signin   (needed for the :cloud model)."
  warn "Everything else (map, SOS, the live demo) still runs. Continuing…"
fi

# 4 — one build + run.
say "building + starting the whole stack (first run pulls images / installs deps — a few minutes)…"
if [ "$1" = "-d" ]; then
  docker compose -f infra/docker-compose.yml up -d --build
  say "Up. App: http://localhost:3000   ·   Live demo: http://localhost:3000/?demo=director&autostart=1"
  say "Logs: docker compose -f infra/docker-compose.yml logs -f   ·   Stop: ./start.sh down"
else
  say "App will be at http://localhost:3000  (live demo: add ?demo=director&autostart=1). Ctrl-C stops it."
  exec docker compose -f infra/docker-compose.yml up --build
fi
