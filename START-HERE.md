# KampungKaki — full setup (web app + both live demos)

Clone it, run one command, get the whole stack: the app, the realtime backend,
and **both** live demos with their voices. Everything except two host prerequisites
ships inside the repo.

## Prerequisites (one-time, on the host)

1. **Docker Desktop** — https://docker.com/products/docker-desktop (Win/Mac/Linux). Start it.
2. **Ollama** (powers the AI agents + the demos' AI replies) — https://ollama.com/download.
   After installing, run once:
   ```
   ollama signin
   ```
   Required because the AI model is a **cloud** model (`minimax-m2.5:cloud`) that runs
   under *your* Ollama account — it can't be bundled into the repo or image. Without it
   the map / SOS / demo flows still run; only the AI replies go quiet.

That's all. You do **not** need Node, Python, Mosquitto, Redis, or the Qwen TTS
toolchain installed — Docker provides them, and the demo voices are pre-rendered
and committed.

## Run it

**Windows (PowerShell):** `.\start.ps1`  ·  **Mac / Linux:** `./start.sh`

First run takes a few minutes (pulls images, installs deps, builds); after that it's
seconds. Then open **http://localhost:3000**. Stop with `Ctrl-C` or `./start.sh down`.

## The two live demos

Both run inside the same app, fully self-contained (assets + voices bundled). Launch
them from the buttons bottom-left of the app, or by URL:

| Demo | URL | What it is |
|---|---|---|
| Quick showcase | `http://localhost:3000/?demo=quick&autostart=1` | Fast, cutscene-driven showcase |
| Live demo | `http://localhost:3000/?demo=director&autostart=1` | Full three-client run over MQTT |

Voices are pre-rendered Qwen3-TTS WAVs already in `public/demo/voice*/`. Nothing to
generate. (To *re-render* them you'd need the Qwen toolchain — see "Re-rendering" below.)

## What comes up

| Service | Port | Role |
|---|---|---|
| web | 3000 | React app + both demos + the `api/` functions (gov-data + AI agents) |
| bridge | 8787 | FastAPI + MQTT — identity, presence, demo lifecycle |
| mosquitto | 1883 / 9001 | MQTT broker (TCP for bridge, WebSocket for browsers) |
| redis | 6379 | durable mirror of shared state |

The web container reaches the host's Ollama at `host.docker.internal:11434`.

## Optional: live Singapore map layers

Weather/PSI/traffic layers need free gov-data keys. The app runs fine without them
(those layers show "unavailable" — they never fake data). To enable, edit
`CODEEXP/.env.local` (created on first run from `.env.example`) and fill
`DATAMALL_ACCOUNT_KEY` / `ONEMAP_API_KEY`, then restart.

## Transfer: GitHub, not a Docker image

Push the **source** to GitHub; `docker compose` rebuilds the images on whatever
machine clones it. Don't `docker save` an image into the repo — it's multi-GB and git
can't carry that well. The committed pre-rendered voices (~30 MB) and bundled geojson
do travel in the clone, which is fine.

## Re-rendering the demo voices (optional, not needed to run)

Only if you change narration. Needs the Qwen TTS toolchain at
`~/.aiko-core/.../qwentts.cpp` (binary + models + reference voices) and ffmpeg:
```
cd CODEEXP
node scripts/ai-demo-voice.mjs --render        # the live demo's voices
node scripts/proper-demo-voice.mjs --render     # the proper/LiveDirector voices
```
