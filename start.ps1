# KampungKaki - one command to set up and run EVERYTHING (app + live demo + AI) on Windows.
#
#   .\start.ps1          build + run the whole stack, follow logs
#   .\start.ps1 -Detach  run in the background
#   .\start.ps1 down     stop everything
#
# Prereqs it checks for you: Docker Desktop running, Ollama signed in (for the AI).
# If PowerShell blocks the script, run once:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
param([string]$Cmd = "")
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Say  ($m) { Write-Host ">> $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "!! $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "xx $m" -ForegroundColor Red; exit 1 }

if ($Cmd -eq "down") {
  Say "stopping KampungKaki..."
  docker compose -f infra/docker-compose.yml down
  exit $LASTEXITCODE
}

# 1 - Docker must be installed and running.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die "Docker not found. Install Docker Desktop: https://docker.com/products/docker-desktop"
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Die "Docker is installed but not running. Start Docker Desktop, then re-run." }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Die "The 'docker compose' plugin is missing. Update Docker Desktop." }
Say "Docker is running."

# 2 - first-run env: the app degrades gracefully without keys, so just seed the file.
if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Warn "Created .env.local from the template. Fill DATAMALL/ONEMAP keys later for live map layers (optional)."
}

# 3 - Ollama (the AI). The :cloud model tag routes to ollama.com under your account.
try {
  Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 *> $null
  Say "Ollama daemon reachable on :11434."
} catch {
  Warn "Ollama is not responding on :11434 - the AI Kaki agents won't work until it is."
  Warn "Install it (https://ollama.com/download), then run:  ollama signin   (needed for the :cloud model)."
  Warn "Everything else (map, SOS, the live demo) still runs. Continuing..."
}

# 4 - one build + run.
Say "building + starting the whole stack (first run pulls images / installs deps - a few minutes)..."
if ($Cmd -eq "-Detach" -or $Cmd -eq "-d") {
  docker compose -f infra/docker-compose.yml up -d --build
  Say "Up. App: http://localhost:3000   .   Live demo: http://localhost:3000/?demo=director&autostart=1"
  Say "Logs: docker compose -f infra/docker-compose.yml logs -f   .   Stop: .\start.ps1 down"
} else {
  Say "App will be at http://localhost:3000  (live demo: add ?demo=director&autostart=1). Ctrl-C stops it."
  docker compose -f infra/docker-compose.yml up --build
}
