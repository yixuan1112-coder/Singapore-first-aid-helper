# Kampung Kaki Env Feature Map

Local secrets live in `.env.local`, which is gitignored. Add one key at a time, then run the matching smoke test.

## No Key Required

Feature: Shell workflows, role switching, local SOS/report/dispatch/case state  
Env: none  
Smoke: `npx -y node@20 scripts/smoke-shell.mjs`

Feature: Map basemap tiles  
Env: none  
Source: OneMap public raster tiles  
Smoke: open app and verify map renders.

Feature: NEA PSI/rainfall/2-hour forecast  
Env:
- `VITE_ENABLE_LIVE_PROVIDER_FETCH=true` to allow browser-side live fetches.
Source: `api.data.gov.sg` public environment endpoints  
Smoke: source health shows NEA live once fetched.
Quota guard:
- Default shell load does not call Data.gov.sg.
- Data.gov.sg calls are capped in code and show a quota-protection warning if triggered.

## Backend / Realtime

Feature: REST persistence and initial snapshots  
Env:
- `PORT`
- `VITE_API_BASE_URL`
Smoke target:
- `GET $VITE_API_BASE_URL/api/health`
- `GET $VITE_API_BASE_URL/api/snapshot`

Feature: Browser realtime sync  
Env:
- `VITE_API_BASE_URL`
Smoke target:
- Open two clients.
- File a report in one.
- Confirm the other updates without refresh.

Feature: MQTT responder/SOS bridge  
Env:
- `MQTT_URL`
Smoke target:
- Publish responder heartbeat to `qa/responder/R-ECHO-1/heartbeat`.
- Confirm map responder position/status updates.

## AI

Feature: Host AI slash commands  
Env:
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_MODEL_DEV`
- `OPENROUTER_MODEL_PRESENTATION`
Smoke target:
- `/host weather` returns sourced NEA-backed answer.
- `/host hospital load` returns unavailable unless a real hospital adapter is configured.
Quota guard:
- OpenRouter smoke and future Host calls are capped so repeated AI requests cannot burn quota silently.

## Singapore API Adapters

Feature: LTA DataMall traffic incidents and speed bands  
Env:
- `DATAMALL_ACCOUNT_KEY`
Smoke target:
- `GET /api/live/traffic`
- Source health moves from `not_configured` to live/stale/down honestly.
Quota guard:
- DataMall smoke calls are capped. Repeated traffic/speed-band calls must return an explicit rate-limit message.

Feature: Data.gov.sg keyed APIs, if required by future endpoint changes  
Env:
- `DATAGOV_API_KEY`
Smoke target:
- NEA/data.gov adapters still return source-labelled data.
Quota guard:
- Repeated Data.gov.sg calls return an explicit rate-limit message instead of retry loops.

Feature: OneMap reverse geocode, routing, themes/AED lookup  
Env:
- `ONEMAP_API_KEY`
Smoke target:
- Route lookup returns real route or explicit unavailable.
- Reverse geocode returns a real address or explicit unavailable.
- AED/theme lookup returns source-labelled data if account access permits it.
Quota guard:
- OneMap smoke calls are capped. Repeated Search, Reverse Geocode, Routing, and Themes calls must return an explicit rate-limit message.

## Hospital Load

Feature: Hospital load  
Env:
- `HOSPITAL_LOAD_API_URL`
- `HOSPITAL_LOAD_API_KEY`
Smoke target:
- If blank: Host and UI must say unavailable.
- If configured: response must include source label and timestamp.
