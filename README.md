# Kampung Kaki — Section 2 (CODEEXP)

A live, role-aware map of Singapore for citizens, responders, and ops.
One map. Three views. Real OneMap basemap. Real NEA data. Shared truth
store so an action by one role appears for the others in the same tick.

See `../BLUEPRINT.md` in the parent folder for the full product blueprint
including every data source we plan to wire (Tier A → D).

---

## Features

- **Role-Aware Interface**: Three distinct views for Citizen, Responder, and Ops roles
- **Real Singapore Map**: OneMap grey tiles via MapLibre GL
- **Live NEA Data**: PSI (Pollutant Standards Index) and rainfall overlays refreshed every 60 seconds
- **Interactive Map Pins**: Events displayed at Bedok, AYE, and Tampines
- **Drawing Tools** (Ops only): 11-tool drawing toolbox for marking areas
- **Real-Time SOS**: Tracking pill appears for live SOS or assignment events
- **Shared State Store**: Actions by one role immediately visible to others
- **Case Room Chat**: Slash-command chat interface for responder groups
- **AI-Powered Agents**: Ollama-powered Kaki agents for assisted responses

---

## Prerequisites

- **Docker** (recommended) — https://www.docker.com/products/docker-desktop
- **Node.js 18+** (alternative) — https://nodejs.org
- **Ollama** (optional, for AI features) — https://ollama.com

---

## Quick Start (Docker - Recommended)

### Setup

```bash
# Clone the repository
git clone https://github.com/kampung-kaki/CODEEXP.git
cd CODEEXP

# Run the full stack
./start.sh
```

### Commands

```bash
./start.sh          # Build and run, follow logs in terminal
./start.sh -d       # Run detached (background)
./start.sh down     # Stop all services
```

### First Run

On first run, `start.sh` automatically:
1. Checks Docker is running
2. Creates `.env.local` from `.env.example`
3. Verifies Ollama is available (for AI features)
4. Builds and starts all containers

### Access

- **App**: http://localhost:3000
- **Live Demo**: http://localhost:3000/?demo=director&autostart=1
- **MQTT**: tcp://localhost:1883 (bridge), ws://localhost:9001 (browsers)
- **Redis**: localhost:6379
- **Bridge API**: localhost:8787

---

## Manual Setup (Node.js - Alternative)

### Setup

```bash
# Clone the repository
git clone https://github.com/kampung-kaki/CODEEXP.git
cd CODEEXP

# Install dependencies and build
chmod +x build.sh run.sh
./build.sh
```

### Run

```bash
./run.sh           # Build (if needed) + preview on http://localhost:5173
./run.sh dev       # Vite dev server on http://localhost:3000 (hot reload)
./run.sh share     # Build + preview + public Cloudflare tunnel
```

### Access

- **Preview**: http://localhost:5173
- **Dev Server**: http://localhost:3000
- **Public Share**: https://*.trycloudflare.com (via `./run.sh share`)

---

## Environment Variables

Copy `.env.example` to `.env.local` and configure as needed:

| Variable | Description |
|----------|-------------|
| `DATAMALL_ACCOUNT_KEY` | DataMall API key for transport data |
| `ONEMAP_API_KEY` | OneMap API key for map tiles |
| `OLLAMA_BASE_URL` | Ollama daemon URL (default: http://host.docker.internal:11434) |
| `KK_AI_MODEL` | AI model for Kaki agents (default: minimax-m2.5:cloud) |

The app degrades gracefully without API keys — map and basic features still work.

---

## Docker Services

The stack runs four services via `infra/docker-compose.yml`:

| Service | Port | Description |
|---------|------|-------------|
| mosquitto | 1883, 9001 | MQTT 5 broker for real-time messaging |
| redis | 6379 | Durable state mirror |
| bridge | 8787 | FastAPI + MQTT for identity, presence, live demo |
| web | 3000 | Vite server with React app, AI agents, gov-data proxies |

---

## Project Layout

```
CODEEXP/
├── src/
│   ├── AppContext.tsx              # Shared truth store + actions
│   ├── services/
│   │   └── live.ts                # Real-time NEA fetchers
│   ├── components/
│   │   ├── Shell.tsx              # Top-level layout
│   │   ├── map/
│   │   │   └── MapCanvas.tsx     # MapLibre + OneMap + drawing
│   │   ├── layout/
│   │   │   ├── TopChrome.tsx
│   │   │   ├── LeftRail.tsx       # Role-aware navigation
│   │   │   ├── WorkspaceDrawer.tsx
│   │   │   ├── GlobalActionDock.tsx
│   │   │   └── BottomStrip.tsx
│   │   └── workspaces/
│   │       ├── CitizenWorkspaces.tsx
│   │       ├── ResponderWorkspaces.tsx
│   │       └── OpsWorkspaces.tsx
│   └── primitives/               # Reusable UI components
├── infra/
│   └── docker-compose.yml         # Full stack definition
├── backend/
│   ├── Dockerfile                 # Bridge container
│   └── src/                       # FastAPI backend
├── start.sh                       # One-command Docker setup
├── start.ps1                      # Windows version
├── build.sh                       # Node.js build script
└── run.sh                         # Node.js run script
```

---

## Managing Docker Containers

### View running containers

```bash
docker ps
```

### View all containers (including stopped)

```bash
docker ps -a
```

### Start all containers

```bash
docker compose -f infra/docker-compose.yml up -d
```

### Stop all containers

```bash
docker compose -f infra/docker-compose.yml down
```

### Restart a specific service

```bash
docker compose -f infra/docker-compose.yml restart <service-name>
```

Example:
```bash
docker compose -f infra/docker-compose.yml restart bridge
```

### View logs for all services

```bash
docker compose -f infra/docker-compose.yml logs -f
```

### View logs for a specific service

```bash
docker compose -f infra/docker-compose.yml logs -f <service-name>
```

Example:
```bash
docker compose -f infra/docker-compose.yml logs -f web
```

### Access container shell (for debugging)

```bash
docker exec -it <container-name> /bin/sh
```

Example:
```bash
docker exec -it kk-web /bin/sh
```


## Troubleshooting

### "Port already in use"

```bash
# Find and kill process on port
lsof -ti:3000 | xargs kill -9
```

### Map shows grey rectangle but no tiles

Network is blocking `www.onemap.gov.sg`. Verify:
```bash
curl -I https://www.onemap.gov.sg/maps/tiles/Grey/12/3274/2042.png
```
Should return `HTTP/2 200`.

### NEA data shows "fetching…" forever

Network or ad-blocker is blocking `api.data.gov.sg`. Verify:
```bash
curl -sI https://api.data.gov.sg/v1/environment/psi
```

### Ollama not responding

Install Ollama and sign in for AI features:
```bash
ollama signin
```

### View logs

```bash
# Docker logs
docker compose -f infra/docker-compose.yml logs -f

# Specific service
docker compose -f infra/docker-compose.yml logs -f bridge
```

---

## License

Internal R&D. Not for production deployment until partner agreements
land (Section 8). See `../BLUEPRINT.md` § 13 for the non-negotiables.