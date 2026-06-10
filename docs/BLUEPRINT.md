# Kampung Kaki — Blueprint

Current state of the design. Replaces the legacy blueprint at
`BLUEPRINT.legacy.md`. This document is the single answer to "what is Kampung
Kaki right now". Updated 2026-05-19.

---

## 0. One-line product

A live, role-aware map of Singapore that turns real-time public data,
citizen reports, SOS distress signals, and responder action into a single
coordinated picture, with text-first fallbacks under load.

---

## 0.A The full source inventory — every feed we want, honest about state

This is the master list. Anything we plan to ingest, scrape, subscribe, or
plant a client into is below. Tier classifies acquisition difficulty.
State is one of `wired` (running today), `probed` (URL/contract confirmed,
no code yet), `planned` (designed, not probed), `partner` (requires MOU).
"Tracker" = a recurring poller. "Scraper" = HTML/feed parser. "Client" =
a planted account session.

### Tier A — public HTTP, no key, CORS-open

These are the cheapest wins. We hit them directly from the frontend
or from a backend poller. No agreements needed.

| # | Source | Endpoint / handle | What we get | Cadence | State | Used for |
|---|---|---|---|---|---|---|
| A01 | NEA PSI | `https://api.data.gov.sg/v1/environment/psi` | PSI 24h per region | 60s | **wired** | air-quality map overlay, briefing chip, Host weather |
| A02 | NEA rainfall | `https://api.data.gov.sg/v1/environment/rainfall` | per-station mm | 60s | **wired** | rainfall pins, flood-risk auto-elevation |
| A03 | NEA 2h forecast | `https://api.data.gov.sg/v1/environment/2-hour-weather-forecast` | area forecast | 5min | **wired** | citizen briefing, responder weather context |
| A04 | NEA 24h forecast | `https://api.data.gov.sg/v1/environment/24-hour-weather-forecast` | island forecast | 30min | probed | ops day-ahead briefing |
| A05 | NEA air temp | `https://api.data.gov.sg/v1/environment/air-temperature` | per-station °C | 60s | probed | heat advisory layer |
| A06 | NEA humidity | `https://api.data.gov.sg/v1/environment/relative-humidity` | per-station % | 60s | probed | heat stress index |
| A07 | NEA wind speed | `https://api.data.gov.sg/v1/environment/wind-speed` | per-station knots | 60s | probed | smoke plume drift modelling |
| A08 | NEA wind direction | `https://api.data.gov.sg/v1/environment/wind-direction` | per-station ° | 60s | probed | plume drift |
| A09 | NEA UV index | `https://api.data.gov.sg/v1/environment/uv-index` | hourly UV | 60min | probed | citizen advisory |
| A10 | NEA PM2.5 | `https://api.data.gov.sg/v1/environment/pm25` | per-region µg/m³ | 60s | probed | air quality finer than PSI |
| A11 | LTA taxi availability | `https://api.data.gov.sg/v1/transport/taxi-availability` | live taxi GeoJSON | 60s | probed | response-time proxy, evacuation feasibility |
| A12 | LTA carpark availability | `https://api.data.gov.sg/v1/transport/carpark-availability` | per-park lots | 60s | probed | evacuation rendezvous capacity |
| A13 | data.gov.sg dengue clusters | `datastore_search?resource_id=...` | active clusters geojson | 24h | probed | persistent public-health overlay |
| A14 | OneMap basemap grey | `https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png` | raster tiles | on-demand | **wired** | the map you're looking at |
| A15 | OneMap basemap default | `https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png` | raster tiles | on-demand | probed | alt theme |
| A16 | OneMap basemap night | `https://www.onemap.gov.sg/maps/tiles/Night/{z}/{x}/{y}.png` | raster tiles | on-demand | probed | dark ops mode |
| A17 | OneMap reverse geocode | `https://www.onemap.gov.sg/api/common/elastic/search` | address from latlng | on-demand | probed | report compose, SOS reverse |
| A18 | OneMap routing | `https://www.onemap.gov.sg/api/public/routingsvc/route` | driving / walking / cycling | on-demand | planned (needs key for higher quota) | responder ETA, Host `/host route` |
| A19 | CNA RSS | `https://www.channelnewsasia.com/rssfeeds/8395986` | news items | 5min | probed | briefing news layer |
| A20 | Straits Times Singapore RSS | `https://www.straitstimes.com/news/singapore/rss.xml` | news items | 5min | probed | briefing news layer |
| A21 | TODAY Singapore RSS | `https://www.todayonline.com/feed` | news items | 5min | probed | briefing news layer |
| A22 | Mothership RSS | `https://mothership.sg/feed/` | news items | 5min | probed | briefing news layer |
| A23 | Reddit r/singapore | `https://www.reddit.com/r/singapore.json` | hot threads | 10min | probed | early citizen signal (with trust = low) |
| A24 | Reddit r/SingaporeRaw | `https://www.reddit.com/r/SingaporeRaw.json` | raw incident posts | 10min | planned | corroboration for citizen reports |
| A25 | gov.sg news index | `https://www.gov.sg/news` | gov press releases | 15min | planned (scraper) | ops briefing source-of-record |
| A26 | SCDF newsroom | `https://www.scdf.gov.sg/home/about-us/newsroom` | SCDF press releases | 15min | planned (scraper) | fire/medical authoritative line |
| A27 | NEA media room | `https://www.nea.gov.sg/media/news` | NEA press | 15min | planned (scraper) | env/health authoritative line |
| A28 | SPF media | `https://www.police.gov.sg/media-room` | police press releases | 15min | planned (scraper) | crime/threat authoritative line |
| A29 | MOH news highlights | `https://www.moh.gov.sg/news-highlights` | health advisories | 15min | planned (scraper) | outbreak / disease authoritative |
| A30 | PUB news | `https://www.pub.gov.sg/news/pressreleases` | water/flood press | 15min | planned (scraper) | flood authoritative line |

#### Tier A · Telegram public preview channels (no login)

The `t.me/s/<channel>` HTML preview returns the last ~30 messages
without auth. Probed 2026-05-19. This is the fallback path before Tier C
(MTProto) lands.

| # | Channel | URL | What we get | Cadence | State |
|---|---|---|---|---|---|
| A40 | Mothership SG | `https://t.me/s/MothershipSG` | breaking news posts | 5min | probed |
| A41 | MOE Today | `https://t.me/s/moetoday` | schools/edu posts | 5min | probed |
| A42 | AsiaOne | `https://t.me/s/asiaonecom` | regional news | 5min | probed |
| A43 | Zaobao SG | `https://t.me/s/zaobaosg` | Chinese-language news | 5min | probed |

### Tier B — public HTTP with API key

Free tier, but requires a registered account and a key in the request.
We park keys in `backend/.env` and proxy from the backend (never ship
keys to the browser).

| # | Source | Endpoint root | What we get | Cadence | State | Used for |
|---|---|---|---|---|---|---|
| B01 | LTA DataMall traffic incidents | `http://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents` | live road incidents | 60s | planned | road closure overlay, dispatch routing |
| B02 | LTA DataMall traffic speed | `.../TrafficSpeedBands` | per-segment km/h | 5min | planned | live travel-time map |
| B03 | LTA DataMall ERP rates | `.../ERPRates` | current gantry rates | 30min | planned | evacuation cost overlay |
| B04 | LTA DataMall MRT alerts | `.../TrainServiceAlerts` | MRT disruption | 60s | planned | rail outage overlay, dispatch impact |
| B05 | LTA DataMall bus arrival | `.../v3/BusArrival` | per-stop ETAs | on-demand | planned | citizen evacuation routing |
| B06 | LTA DataMall traffic images | `.../Traffic-Imagesv2` | CCTV stills | 5min | planned | ops visual verification |
| B07 | OneMap themesvc — AED | `https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName=aeds` | AED locations | 24h | planned | Host `/host nearest aed` real data |
| B08 | OneMap themesvc — kindergartens | `...?queryName=kindergartens` | school locations | 24h | planned | school-day risk overlay |
| B09 | OneMap themesvc — hawker | `...?queryName=hawkercentre` | hawker centres | 24h | planned | mass-gathering risk overlay |
| B10 | OneMap themesvc — clinics | `...?queryName=clinic` | clinic locations | 24h | planned | non-A&E medical capacity |
| B11 | OneMap themesvc — eldercare | `...?queryName=eldercare` | senior care centres | 24h | planned | vulnerable population overlay |

### Tier C — planted client (a real account, running 24/7)

These are the messy ones. No public API. We run a real user account or
bot session on a persistent worker. Designed, not yet implemented.
**Operator owns the account**, the agreement is between operator and
platform.

#### Tier C · Telegram MTProto (Telethon)

Primary news + emergency comms path. One account, signed in via
real Singapore phone number, joined to public channels. Reads new
messages in real time via long-polling MTProto.

```
backend setup once:
  pip install telethon==1.36.0
  .env:
    TG_API_ID=<from my.telegram.org>
    TG_API_HASH=<from my.telegram.org>
    TG_PHONE=+65XXXXXXXX
    TG_SESSION_PATH=backend/data/telegram.session
  run: python -m backend.tools.tg_login   # enter SMS code once
```

Authoritative handles to join on first login (resolve via Telethon):

| # | Handle | Channel | Cadence | State |
|---|---|---|---|---|
| C01 | `@scdf_singapore` | SCDF official | live | planned |
| C02 | `@police_singapore` | SPF official | live | planned |
| C03 | `@nea_singapore` | NEA official | live | planned |
| C04 | `@moh_singapore` | MOH official | live | planned |
| C05 | `@govsg` | gov.sg | live | planned |
| C06 | `@PUBsingapore` | PUB official | live | planned |
| C07 | `@LTAsg` | LTA official | live | planned |
| C08 | `@SGSecureCommunity` | SGSecure | live | planned |
| C09 | `@MothershipSG` | Mothership news | live | planned |
| C10 | `@CNAInsider` | CNA insider | live | planned |
| C11 | `@straits_times` | Straits Times | live | planned |
| C12 | `@todayonline` | TODAY | live | planned |
| C13 | `@asiaonecom` | AsiaOne | live | planned |
| C14 | `@zaobaosg` | Zaobao | live | planned |
| C15 | `@SingaporeIncidents` | citizen incidents | live | planned |
| C16 | `@SGRoadAccidents` | road accidents | live | planned |
| C17 | `@SGTrafficUpdates` | traffic updates | live | planned |
| C18 | `@SGWeatherStation` | weather watch | live | planned |
| C19 | `@SGTransportNews` | transport | live | planned |

Resolution happens on first run; the login script prints which handles
resolved and which were renamed/dead. Dead ones get logged for manual
replacement.

#### Tier C · other planted clients

| # | Platform | Mechanism | What we get | State |
|---|---|---|---|---|
| C30 | WhatsApp | Baileys library, planted business account | gov.sg broadcast list, neighbour alerts | planned |
| C31 | Facebook | Graph API w/ long-lived page token | public agency Page posts | planned |
| C32 | Instagram | Graph API (same token) | public agency reels/posts | planned |
| C33 | Discord | bot user joined to public SG servers | community early signal | planned |
| C34 | Twitter / X | scraper via Nitter mirrors (no API key) | SCDF/SPF tweets | planned |

### Tier D — partner / agency liaison

Real authority data. Requires an MOU. Out of scope for this build until
partner agreements land in Section 8. Listed honestly so we know what
we're aiming for.

| # | Partner | Feed (theoretical) | What we get | State |
|---|---|---|---|---|
| D01 | SCDF | dispatch event stream | call-outs, fire/medical, units | partner |
| D02 | SCDF | myResponder programme | CPR/AED-trained citizen pool | partner |
| D03 | SPF | incident broadcast | crime/threat | partner |
| D04 | NEA | sensor-grade air/weather | sub-station, sub-minute | partner |
| D05 | MOH | hospital A&E live load | per-hospital capacity, wait | partner |
| D06 | MOH | infectious disease alerts | outbreak start, R0 | partner |
| D07 | PUB | water level sensors | canal/reservoir live | partner |
| D08 | LTA | full Operations Control feed | richer than DataMall | partner |
| D09 | URA | crowd estimate tiles | event density | partner |
| D10 | M1/Singtel/StarHub | cell-tower aggregate density | anonymous footfall by gh5 | partner |
| D11 | SLA | gazetteer + cadastre | precise address/parcel | partner |

### Citizen-generated streams (always-on, no acquisition needed)

These are what flows in from the app itself. Listed to keep the picture
honest.

| # | Stream | Source | State | Used for |
|---|---|---|---|---|
| Z01 | Citizen reports | in-app `Report` compose | **wired** (in-memory) | report queue, event promotion |
| Z02 | Citizen SOS | in-app `Need help` | **wired** (in-memory) | distress queue, dispatch |
| Z03 | Citizen briefing | in-app `Brief` viewport | **wired** | personalised brief |
| Z04 | Citizen presence (consented) | navigator.geolocation | planned | density heatmap, evacuation guidance |
| Z05 | Citizen attachments | photo/video upload | planned (needs backend storage) | verification evidence |

### Responder-generated streams

| # | Stream | Source | State |
|---|---|---|---|
| R01 | Responder GPS heartbeat | mobile responder app | wired (simulated 600ms ticker, real coords) |
| R02 | Responder status | duty toggle, on_scene/en_route ack | wired |
| R03 | Responder voice clips | case room PTT | planned (LiveKit phase) |
| R04 | Responder whiteboard strokes | case canvas | planned (Yjs CRDT) |

### Acquisition pipeline (how all of the above lands in the truth store)

```
                  [ Tier A workers ]    [ Tier B workers ]
                          │                    │
                          ▼                    ▼
[ Tier C ] ──► normaliser ◄── dedupe ◄── geocoder ◄── trust scorer
   │                                              │
   ▼                                              ▼
[ Tier D ] ────────────────────────────► canonical event bus
                                              │
                                              ▼
                                  Redis stream `events.canonical`
                                              │
                ┌──────────────┬──────────────┴─────────────┬──────────────┐
                ▼              ▼                            ▼              ▼
           Citizen WS     Responder WS                  Ops WS         AAR store
```

Each adapter writes its own raw stream (`raw.nea.psi`, `raw.tg.scdf`,
`raw.lta.traffic`, etc.). The normaliser collapses them into canonical
`Event` / `Advisory` / `Sensor` records. Dedupe runs on `(kind, gh5,
text-hash, 5-min-window)`. Trust score is published as `0.0..1.0` on
every promoted item.

### What's wired today (subset of the above)

```
wired:    A01, A02, A03, A14, Z01, Z02, Z03, R01 (simulated), R02
probed:   A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A15, A16,
          A17, A19, A20, A21, A22, A23, A40, A41, A42, A43
planned:  everything else above
partner:  D01..D11
```

Cross-reference: `frontend_rebuild/docs/audit-gates/SOURCE_AUDIT_2026-05-19.md`
for full probe receipts (HTTP status, sample payloads, CORS headers).

---

## 0.B Mission and the response loop

**Hackathon problem (Mission: Kampung Kaki · Topic: Fast Response):**
"Build a web application that gathers information from different sources
to help Singapore respond faster and smarter during disasters or health
emergencies."

**Our answer in one sentence:** shrink the time between "something may be
happening" and "the right people know what to do."

**The product loop:**

```
detect early  →  verify locally  →  brief clearly
              →  alert geographically  →  coordinate resources
              →  export evidence
```

Every surface in the app slots into one of these six stages. Every data
source from § 0.A slots into one of these six stages too. Anything that
doesn't move the loop forward is decoration and gets cut.

| Loop stage | Citizen surface | Responder surface | Ops surface | Data sources that feed it |
|---|---|---|---|---|
| detect early | Report (3-tap), passive Briefing | Bulletin | Reports queue, Briefing | Z01, A01-A30 (sensors + news + RSS), A40-A43 + C01-C19 (Telegram), B01-B06 (LTA) |
| verify locally | n/a | Verify queue, on-scene ACK | Reports queue triage | Z01 + R02 cross-correlation, multi-source dedupe |
| brief clearly | Local alert detail, Incident guidance | Bulletin item detail | Incident ops detail | AI Host with source chips (B07 AED, D05 hospitals) |
| alert geographically | Alerts subscription + push | Push to subscribed groups | Broadcast composer w/ coverage preview | gh4/5/6 scope routing, no national spam |
| coordinate resources | SOS live tracking | Assignment + case lobby + groups | Dispatch + case oversight + roster | R01 heartbeats, B07 AED, B04 MRT alerts, B11 eldercare, D05 hospital A&E |
| export evidence | n/a | n/a | AAR composer (planned) | full audit log of every state transition |

---

## 0.C Why each role surface makes response faster

This is the "so what" for every interaction in the UI. Tied to the loop
stage and the data source(s) that power it.

### Citizen · first-person Report (3-tap compose, `Z01`)

**Why it speeds response:** the bottleneck in detection is not sensor
coverage, it's _human noticing_. A flooded underpass, smoke from a flat,
a person collapsed on the MRT — none of those trip an NEA gauge or a
DataMall incident. They are seen by a single person, two minutes before
995 gets the first call.

We turn that human noticing into a **provisional pin within 2 seconds**:

- `fileReport()` writes to the shared truth store immediately
- the pin shows on every role's map as a ring marker (low-trust style)
- ops sees it in the Reports queue with `pending` status
- responders within ~500 m see it in their Verify queue
- a single nearby responder ACKing it cross-corroborates with one
  additional witness or one sensor signal → promote to verified event
  → broadcast scope expands from "nearby responders" to "geohash-cell
  citizens"

**Why 3 taps and not a form:** under stress people abandon. The compose
is `category (1 tap) → location auto (0 tap) → optional photo + send (1
tap)`. Description text is optional. We optimise the floor (effort) not
the ceiling (perfect data).

**API tie-in:** corroboration uses A19-A22 RSS, A40-A43 Telegram preview,
A23 Reddit, B06 traffic CCTV (visual confirmation by ops). When `C01-C08`
gov MTProto lands, official broadcasts arrive on the same canonical bus
and auto-verify any matching citizen report within the same 5-min gh5
window.

### Citizen · SOS distress signal (`Z02`)

**Why it speeds response:** 995 is voice-first. Voice-first means a queue,
a script, a dispatcher transcribing address into coordinates, and a
dispatch console issuing a unit. Median pickup is fast but
description-to-dispatch is the slow leg. The SOS button **skips the
description-to-dispatch leg** for cases where category + GPS is enough.

Concretely, when a citizen taps `Need help → medical`:

1. `startSos({category, location})` writes a session, tracking pill
   appears on their screen
2. red SOS pin appears on the ops map + Distress queue + responder maps
3. ops sees the SOS in Dispatch with the available roster pre-ranked by
   distance (uses A11 taxi availability and R01 responder heartbeats)
4. one click `Assign` flips a responder to `en_route` + draws a live
   route line + starts the 600 ms position ticker
5. the citizen's tracking pill updates from `Searching` → `Acknowledged`
   → `En route · ETA` without them doing anything

**Privacy:** responders see masked citizen name, category, approximate
location only. No phone number. No medical history. The audit log
records who saw what when.

**Why this complements 995, not replaces it:** for ambiguous cases
(unconscious person, possible threat) voice is still needed. The SOS
button is the right tool for `I am the casualty, I can locate myself, I
know roughly what's wrong`. For everything else 995 stays primary. The
non-goal in § 0.D is explicit about not issuing dispatch orders.

**API tie-in:** D02 SCDF myResponder integration converts the SOS into a
real CPR/AED-trained citizen ping when partner agreement lands. B07
OneMap AED layer answers `/host nearest aed` immediately. D05 MOH A&E
load picks the best receiving hospital.

### Responder · Verify queue + on-scene ACK (`Z01 → R02`)

**Why it speeds response:** citizen reports without verification are
poison. Either you trust them all (false-alarm flood) or trust none of
them (back to detection bottleneck). The middle path is **convert a
weak signal to a strong signal at sub-2-minute latency** using whoever
is geographically closest and qualified.

Mechanism:

- a responder on duty within ~500 m of a pending report sees it in the
  rail with a count badge
- they tap `Verify`, the row expands with kind, body, photos, trust score
- if they can confirm visually or by witness, `verifyReport()` promotes
  it to a canonical event for everyone
- if they can't, `dismissReport()` removes the pin and downscores the
  reporter

This pattern handles two failure modes at once:

1. **Hoax / malicious reports** (rare but real) — geographic verifier
   sees there's no fire and dismisses
2. **Genuine but stale** (frequent — citizen reports something already
   handled) — verifier confirms it's resolved and bumps status

**API tie-in:** the verifier doesn't have to be human. A03 2h forecast
+ A02 rainfall can auto-verify "flood at Bedok" if rainfall has been
>30 mm/h for 20 min. A26-A30 gov press releases auto-verify any incident
that matches an official advisory in the same gh5 cell. Every auto-
verification carries the source chip in the audit log.

### Responder · Bulletin (`A01-A30`, `C01-C19`, `B01-B06`)

**Why it speeds response:** an off-duty volunteer in Bedok shouldn't
have to flip between SCDF Telegram, CNA, the LTA app, and the NEA app
to know what's happening in their neighbourhood. The Bulletin is a
single deduped, geo-ranked, severity-sorted feed.

The dedupe rule is `(kind, gh5, text-hash, 5-min-window)`. So a fire at
Toa Payoh that fires SCDF Telegram (C01), Mothership Telegram (C09 /
A40), and three Reddit posts (A23) shows as **one** bulletin item with a
`source count: 5` chip, not five separate cards.

**Why this matters for speed:** when a real event happens, signal-to-noise
collapses. The bulletin keeps a responder's eyes on the few items that
matter.

### Responder · Groups (cadres, cells, cases)

**Why it speeds response:** dispatch quality depends on having the right
roster ranked by distance. Groups expose the roster structure:

- **Org groups** (SCDF East District) — paid responders, fastest
- **Capability groups** (Medic Volunteers, Fire Aux, AED Responders) —
  capability-typed volunteers
- **Geo groups** (Bedok cell `w21z2`) — anyone active in that gh5 cell
- **Cases** (active operations) — Discord-style rooms responders join
  to coordinate on a live incident

When ops opens Dispatch, the available roster is filtered by `distance ×
capability × group membership`. Joining a group is not a bureaucratic
act — it's a precondition for being matched to the right calls.

**API tie-in:** D02 SCDF myResponder is the gold standard for the AED
Responders group — those volunteers are pre-trained and pre-cleared.
Without the partner agreement we run them as self-declared with reduced
trust score.

### Responder · Case lobby (Discord-shell + AI Host)

**Why it speeds response:** multi-responder incidents (AYE crash, fire
with 3 units, mass casualty) require coordination beyond status fields.
Voice radio is incumbent. We add a **persistent text channel with an
AI Host** that:

- watchdog-sweeps every 5-30 s depending on severity (§ 7)
- pings the captain if a heartbeat is stale, if a new SOS lands within
  200 m, if a resource flips state (A&E ≥90%), if weather shifts
- answers grounded queries: `/host nearest aed`, `/host hospital load`,
  `/host weather`, `/host route`
- every claim carries a source chip (no chip → no claim)

**Why a chatroom not a checklist:** real ops is messy. People type
faster than they tap. A whiteboard, a voice clip, a slash command, and
a Host answer all land in the same timeline so the after-action report
is one scroll, not a stitched mosaic of 5 tools.

**API tie-in:** all Tier A weather sources feed the Host weather replies.
B07 AED + B11 eldercare + D05 hospital A&E feed resource lookups. C30
WhatsApp Baileys lets the Host post critical broadcasts to ops chats
when push notification fails.

### Ops · Declare + role-preview gate

**Why it speeds response (and prevents harm):** ops can publish a
geo-broadcast that hits 30,000 phones. That power needs a forcing
function against misuse and against badly worded alerts.

The role-preview gate makes the operator click through the **citizen
view**, the **responder view**, and the **ops view** of the draft alert
before publish unlocks. Three tabs. Two seconds. Catches:

- alarmist citizen wording ("EVACUATE NOW" for an L2 flood)
- ambiguous responder geometry ("Bedok area" with no polygon)
- missing source attribution

**API tie-in:** the coverage preview uses cached gh5 device counts. The
sources list auto-attaches matching reports (Z01), sensor readings (A01,
A02), and gov press releases (A26-A30) so the operator sees what
corroborates their declaration before publishing.

### Ops · Dispatch + Broadcast + Distress oversight

**Why it speeds response:** these three surfaces are what ops actually
spends their day on. Dispatch ranks the roster by `(distance, capability,
status)` and writes the assignment in one click. Broadcast targets a
polygon with mandatory coverage preview ("you're about to alert 38,000
residents" → warning chip). Distress oversight shows every active SOS
with its assigned responder and live status.

**API tie-in:** Dispatch ranking uses R01 responder positions, A11 taxi
density as a road-friction proxy, and B01 traffic incidents. Broadcast
delivery uses MQTT gh5 topics today, with C30 WhatsApp + push + SMS
fallback for the resilience guarantees in § 0.D.

---

## 0.D Goals and non-goals

These are measurable. If we can't hit them we ship with a known gap.

**Quantitative goals (carried over from legacy):**

1. Deliver a local alert to affected clients in **< 5 s** on simulated 2G.
2. Keep report submission to **3 taps** from any screen state.
3. Turn citizen reports into provisional yellow pins within **2 s**.
4. Promote incidents only after **official cross-validation OR responder
   verification OR independent corroboration ≥3**.
5. Use **gh5 MQTT topics** for delivery so unaffected users are not
   spammed.
6. Sub-**600 ms** responder heartbeat tick on assignment.
7. Watchdog cadence scales `L1: none / L2: 60s / L3: 30s / L4: 15s /
   L5: 5s` (§ 7).
8. Workspace remains usable when WebGL fails — text-first fallback
   covers every flow.

**Non-goals (carried over, sharpened):**

1. **Not** replacing SGSecure, SCDF, SPF, MOH, PUB, NEA, or LTA.
2. **Not** issuing evacuation orders, medical instructions, dispatch
   orders, or official commands.
3. **Not** exposing exact citizen or responder locations to the public.
4. **Not** depending on a chatbot as the primary crisis interface (Host
   is augment, not gatekeeper).
5. **Not** treating scraped Tier A/C content as official truth without
   a corroborating source.
6. **Not** requiring native iOS or Android apps for the MVP.
7. **Not** building yet another social feed. No likes, streaks, scores,
   leaderboards, or mascots.

---

## 0.E Plug Socket Philosophy

Kampung Kaki is responder-agnostic infrastructure. It works without
privileged access, and gets stronger when agencies plug in.

| Mode | What works | Integration style | Data tiers active |
|---|---|---|---|
| **Public Mode** | public APIs, scrapes, citizen reports | no agreements needed | A + B + Z (citizen reports) |
| **Liaison Mode** | authorised humans inject verified updates via Ops | manual official mirror | Public + a trusted Ops account |
| **Partner Mode** | SCDF / SPF / MOH / PUB / hospitals / NGOs / volunteer groups plug in directly | secure API adapters, private MQTT topics, role-gated dashboards | All tiers including D |

We don't try to replace agency command systems. We sit beside them as a
shared situational map. Section 8 of the roadmap is where partner
agreements land. Everything in Public Mode is functional today.

---

## 0.F Architecture principles

Six rules that don't bend regardless of which features ship next.

1. **Adapters isolate source weirdness.** Each adapter (file per source
   in `backend/adapters/`) handles fetch/scrape/listen/parse and emits a
   canonical record. The core engine never reads HTML.
2. **Events ≠ resources.** Floods, fires, MRT disruptions, SOS calls
   are volatile **events** with TTLs. Hospitals, shelters, AEDs,
   responders are persistent **resources** with state. They live in
   different streams.
3. **Delivery is geographically scoped.** MQTT topics are gh4/5/6. A
   flood in Tampines never wakes Jurong. Push is opt-in per geohash.
4. **Verification is a first-class workflow.** Reports start
   `provisional`. They become `verified` only via official match,
   responder ACK, or N-of-M independent corroboration. The state is
   visible in the UI (ring vs pin).
5. **Degrade toward useful text.** Under load, deck.gl + 3D + AI calls
   are optional. Text alerts, cached briefings, report queues, and the
   audit log are mandatory.
6. **Every state change is auditable.** Ops can export an after-action
   packet with timestamps, sources, confidence changes, and responder
   actions. This is the export-evidence stage of the response loop.

---

## 0.G Event taxonomy (canonical domains and scales)

So we don't end up with 200 ad-hoc kinds. Carried over from legacy.

**Domains** (top-level type of crisis):

```
weather          flood, haze, heatwave, storm, coastal_surge
natural_hazard   earthquake, tsunami, landslide, regional_disaster
public_health    dengue, epidemic, pandemic, respiratory_outbreak, foodborne_outbreak
transport        mrt, traffic, road_closure, crowd_surge
utility          power_outage, water_outage, telecom_blackout
safety           fire, hazmat, building_collapse, civil_incident
security         terror_attack, security_incident, active_violence,
                  suspicious_package, suspicious_activity, public_order, cyberattack
humanitarian     distress, shelter_overflow, supply_shortage
generic          resident, generic   (fallback)
```

**Scale** (geographic blast radius): `site · neighbourhood · district ·
national · regional`.

**Disaster level** (operational posture): `routine · elevated · major ·
severe · catastrophic`.

**Time horizon**: `acute · ongoing · recovery`.

These four axes are orthogonal. A pandemic is `critical / ongoing /
national`. A flash flood is `high / acute / neighbourhood`. A haze wave
is `medium / ongoing / regional`. Severity (§ 5, L1..L5) is derived
from `intensity × disaster_level`.

---

Three roles share one map. Each sees a different slice.

```
citizen  → ask, report, get briefed, see what's near them
responder → see queues, join groups, accept assignments, run cases
ops      → declare events, dispatch, broadcast, audit
```

---

## 1. Status of the build

| Layer | State | Where |
|---|---|---|
| Architecture docs + audits | done | `frontend_rebuild/` |
| Section 1 plan files | done | `frontend_rebuild/src/**/PLAN.md` |
| Section 2 MVP frontend | **running** | `CODEEXP/` |
| Live data adapters (frontend-side) | **wired (NEA PSI + rainfall + 2h forecast)** | `CODEEXP/src/services/live.ts` |
| Real basemap | **wired (OneMap SG via MapLibre)** | `CODEEXP/src/components/map/MapCanvas.tsx` |
| Shared truth store | **wired** | `CODEEXP/src/AppContext.tsx` |
| Telegram MTProto adapter | designed, not implemented | `frontend_rebuild/docs/audit-gates/SOURCE_AUDIT_2026-05-19.md` § C |
| Backend (FastAPI + Redis + Mosquitto) | legacy, partial | `backend/` |
| AAR / export / agency lock | designed | `frontend_rebuild/VISION.md` |

"Wired" means it ships in the current `npm run build`. "Designed" means the
contracts are written but no code yet.

---

## 2. Run it

```
cd CODEEXP
./run.sh           # build + preview on 5173
./run.sh dev       # vite dev on 3000, hot reload
./run.sh share     # build + preview + public cloudflared tunnel
```

Windows: `run.bat` / `run.bat dev` / `run.bat share`.

`run.sh share` prints a `*.trycloudflare.com` URL anyone on the internet
can hit. No signup.

---

## 3. The pivot: one shared truth store

There is one in-memory model. All three role views read and write to it
through `AppContext`. A citizen filing a report appears in the ops queue
and the responder verify queue in the same React tick. This is the
"map tells truth" rule — every UI is a lens on one source.

```
file: CODEEXP/src/AppContext.tsx

interface AppState {
  events:        CanonicalEvent[]      // verified incidents on the map
  reports:       CitizenReport[]       // pending citizen reports
  sosSessions:   DistressSession[]     // live SOS sessions
  responders:    Responder[]           // live position + status
  cases:         CaseRoom[]            // active multi-responder rooms
  chat:          ChatEntry[]           // per-case room chat + Host
  groups:        Group[]               // org/cadre/geo/community groups
  sources:       SourceHealth[]        // adapter freshness
  liveSnapshot:  LiveSnapshot | null   // NEA pull, refreshed every 60s
  tracking:      TrackingState | null  // live process pill state
  ... + actions:
  fileReport, claimReport, verifyReport, dismissReport,
  startSos, assignSos, advanceSos, cancelSos,
  declareIncident, toggleDuty,
  sendChat, askHost,
  joinGroup, leaveGroup, joinCase, leaveCase
}
```

Every cross-role flow described below uses these primitives.

---

## 4. Roles and what each sees

### 4.1 Citizen

Visible: verified public events, public-safe resources, own reports, own
SOS, local briefing.

Hidden: other citizens' SOS coords, responder locations, ops queues,
source internals, raw audit, case interiors.

Actions (dock):

```
Need help  → SOS draft → SOS live (status pipeline)
Report     → 4-step compose → ops queue + responder verify queue
Brief      → viewport-scoped briefing list
Alerts     → subscription matrix (L1..L5 toggles)
```

### 4.2 Responder

Visible: public events, assignments, allowed nearby SOS, own/org context,
joined case interiors, joinable groups.

Hidden: national ops audit, unrelated cases.

Workspaces (left rail):

```
Bulletin       → island-wide active items (events + reports + SOS)
Assignments    → currently assigned SOS, with live tracking
Verify         → reports awaiting verification
Groups         → orgs, capability cadres, geo cells, cases. Join/leave.
Rooms          → joined cases (Discord-shell), General, Org channels
+ Form case    → lasso pattern (drawing toolbox)
```

### 4.3 Ops

Visible: everything authorised — all events, reports, distress, cases,
responders, sources, audit.

Workspaces:

```
Reports         → triage queue
Distress        → distress oversight + dispatch
Cases           → mirror of every case room
Roster          → all responders, status, location
Sources         → live source health
Declare         → 4-step composer + drawing toolbox + role-preview gate
Dispatch        → matchmaker (target × roster × ack)
Broadcast       → polygon target + coverage preview + role preview
```

---

## 5. The five severity levels (L1..L5)

Single scale across all three roles. Operator gets the code; citizen gets
the word.

| Code | Operator label | Citizen label | Token | Example |
|---|---|---|---|---|
| L1 | advisory | Advisory | `surface-2` | fallen tree |
| L2 | notice | Notice | `accent-info` | road accident |
| L3 | warning | Warning | `accent-warning` | major flood |
| L4 | severe | Severe | `accent-critical` | mass casualty |
| L5 | emergency | Emergency | `accent-critical` + chrome banner | pandemic, terror |

Affects: map pin size, label visibility threshold, push delivery scope,
case watchdog cadence.

---

## 6. Cross-role linkage (the actual flows)

Spelled out so it's clear who sees what when.

### 6.1 Citizen Report → everywhere

```
Citizen taps Report
  → fileReport({kind, title, body, location})
  → record lands in `reports[]`, status `pending`
  → appears in TopChrome `Brief (n)` count
  → appears as ring marker on map for ops + responders
  → appears in Ops `Reports` queue (immediate)
  → appears in Responder `Verify` queue (immediate)
  → Responder verifies:
       → claimReport() → status `claimed`
       → verifyReport() → status `verified`, promoted to a new event
       → new event appears on every map
  → Ops can also verify directly from Reports queue
  → Dismissed reports leave audit trail, no map effect
```

### 6.2 Citizen SOS → who gets notified

```
Citizen taps Need help → picks category → sends
  → startSos({citizenName, category, location})
  → record lands in `sosSessions[]`, status `requesting`
  → TrackingPill appears at bottom of citizen viewport
  → red SOS pin appears on map for ops + assigned responders
  → Ops `Distress` queue gets the new entry
  → Ops `Dispatch` opens with this SOS pre-selected
  → Ops picks a responder from available roster → assignSos()
       → responder status → en_route
       → citizen TrackingPill → "responder en route · ETA"
  → Map shows route line from responder to citizen
  → setInterval ticker animates the responder pin along the route
       (real lat/lng, every 600ms, 0.0015° step)
  → advanceSos('arrived') when within 30m
  → advanceSos('resolved') closes the loop
```

The ticker is the live tracking. Real coordinates, simulated movement.
When the backend lands, the ticker is replaced by responder heartbeat
WebSocket messages.

### 6.3 Ops Declare → publish gate

```
Ops opens Declare
  → step 1: title + severity
  → step 2: drawing toolbox engaged on map (polygon/rect/circle/freehand)
       → coverage preview docked under map (cells, devices, residents)
  → step 3: sources auto-attached (nearby reports + live sensors)
  → step 4: ROLE-PREVIEW GATE
       → operator must click through 3 tabs (Citizen / Responder / Ops)
       → publish button is disabled until all seen
  → declareIncident() → event appears for all roles
  → audit row written (will be persisted when backend lands)
```

Within 5 min of publish, ops can edit geometry. After 5 min, only a
follow-up incident or visibility change is allowed.

### 6.4 Case room (Discord shell + AI Host)

```
Cases are persistent rooms. State:
  forming → staging → active → consolidating → resolved → archived

Each case has:
  - a left-rail entry (#case-name)
  - severity chip, watchdog cadence chip (`WD 15s` etc.)
  - roster (status dots: ready/en_route/on_scene/out/offline, captain crown)
  - chat timeline (system + member messages + Host replies)
  - SlashComposer (free text + slash commands + mic PTT)
  - AI Host (see Section 7)

Join flow:
  Responder → Groups workspace → Row marked `case` → Join button
  joinCase(caseId, responderId) → roster updates everywhere live
```

---

## 7. The AI Host

A per-case agent. Spawned at case formation, dies at archive. Lives in the
case room as a roster entry with a dark bubble and a `HOST` glyph.

**Implemented in MVP** (`AppContext.askHost`):

```
/host status        → terse case summary, chips: case_state, roster
/host nearest aed   → nearest AED + load, chips: resource_lookup, route
/host hospital load → CGH/SGH/KTPH live A&E loads
/host weather       → reads live NEA PSI snapshot, attributes source
/host escalate?     → yes/no + rationale
/host help          → command list
```

**Designed, not yet wired** (will land when backend Host worker exists):

```
/host route <m> to <p>      OSRM ETA + path
/host check <m>             live position, last beat
/host suggest formation     role split given roster + protocol
/host new pings?            unabsorbed SOSes nearby
/host playback 5m           summarise last 5 min
/host pause watchdog 10m    captain mute proactive
/host draft aar             begin AAR
```

**Watchdog rules** (proactive Host messages). Cadence scales with severity:

```
L1 advisory   no watchdog
L2 notice     60s sweep
L3 warning    30s sweep + heartbeat enforcement
L4 severe     15s sweep + cross-cell awareness
L5 emergency   5s sweep (cannot pause below 5 min)
```

Triggers:

```
WD1  SOS heartbeat stale > 2 min
WD2  new SOS within 200 m of case centroid
WD3  resource state flip (A&E ≥90%, road close)
WD4  weather shift (lightning <3 km, PSI >200, heavy rain)
WD5  case `active` > 30 min with no resolution
WD6  voice transcript hits protocol trigger (LiveKit phase)
```

**Trust gate**: every Host fact carries a chip linking to the tool that
sourced it. No chip → no claim. "Why I trust this" panel surfaces the
system-prompt invariants.

---

## 8. Map and drawing

**Basemap**: OneMap Singapore grey tile layer via MapLibre GL JS. CORS-
enabled, no API key. Tiles: `https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png`.

**Overlays** (all from the truth store):

```
Event polygons      → severity-coloured fill + dashed line
Event pins          → severity-sized markers, click to open workspace
SOS pins            → red square markers, click to open SOS workspace
Responder pins      → coloured by status (ready/en_route/on_scene/out)
Responder routes    → red dashed line from responder to SOS target
Case halos          → severity ring around case centroid
NEA live overlays   → PSI > 100 promotes to L2..L4 marker
                      Rainfall > 1mm promotes to L1..L3 marker
```

**Drawing toolbox** (ops only, top-right of map):

```
Select · Point · Line · Rectangle · Circle · Polygon · Freehand
Snap-to-cell toggle (gh4/5/6/7) · Edit vertices
Undo · Redo · Clear
```

While drawing:

```
Coverage preview panel docks below map showing:
  cells (count + precision)
  estimated devices (cached cell population)
  estimated residents (gazetteer)
  partial-cell warning + Snap / Keep buttons
```

---

## 9. Source acquisition strategy (the four tiers)

Locked decision 2026-05-19. Every adapter falls into one tier; no source
is skipped because the tier is non-trivial.

```
Tier A — HTTP no auth
  RSS feeds (CNA, ST, Today, Mothership)
  data.gov.sg public APIs (PSI, rainfall, 2h forecast, air-temp, wind,
                            carpark, taxi-availability)
  Telegram public preview (t.me/s/<channel>)
  OneMap public tiles
  Reddit JSON

Tier B — HTTP + key
  LTA DataMall (traffic, MRT)
  OneMap themesvc (AED, schools, hawkers)
  data.gov.sg v2 datasets requiring resource_id auth

Tier C — planted client (a real account running 24/7)
  Telegram MTProto via Telethon (joined to public channels)
  WhatsApp via Baileys (gov.sg broadcast list)
  Facebook Graph (public pages with long-lived token)
  Discord bot (joined to public servers)

Tier D — partner / liaison
  MOU-backed agency APIs (SCDF, SPF, NEA, MOH, PUB private feeds)
```

### 9.1 What's wired in the MVP today

| Source | Tier | State | File |
|---|---|---|---|
| NEA PSI | A | **live** | `CODEEXP/src/services/live.ts → fetchPsi` |
| NEA rainfall | A | **live** | `fetchRainfall` |
| NEA 2hr forecast | A | **live** | `fetch2hForecast` |
| OneMap basemap | A | **live** | `MapCanvas.tsx` |
| Citizen reports intake | — | wired (in-memory) | `AppContext.fileReport` |
| All other sources | A/B/C/D | designed, not wired | `frontend_rebuild/docs/audit-gates/SOURCE_AUDIT_2026-05-19.md` |

Fetched every 60 s. PSI ≥ 100 promotes to an L2-L4 event marker.
Rainfall > 1 mm promotes to an L1-L3 marker. Source health surface
shows the latest pull timestamp.

### 9.2 News + briefing path

Verified live channels (2026-05-19 probe):

```
Telegram public preview (Tier A) — 4 channels confirmed:
  t.me/s/MothershipSG
  t.me/s/moetoday
  t.me/s/asiaonecom
  t.me/s/zaobaosg

Telegram MTProto (Tier C) — primary, designed not implemented:
  authoritative handles to join (resolved at login):
    @scdf_singapore @police_singapore @nea_singapore @moh_singapore
    @govsg @PUBsingapore @LTAsg @SGSecureCommunity

Gov press releases (Tier A) — designed:
  scdf.gov.sg/home/about-us/newsroom
  nea.gov.sg/media/news
  police.gov.sg/media-room
  moh.gov.sg/news-highlights
  pub.gov.sg/news/pressreleases
```

When the Telegram MTProto adapter lands, operator setup (one-time):

```
1. add telethon==1.36.0 to backend/requirements.txt
2. at https://my.telegram.org/auth create an app → copy api_id + api_hash
3. .env:
     TG_API_ID=...
     TG_API_HASH=...
     TG_PHONE=+65XXXXXXXX
     TG_SESSION_PATH=backend/data/telegram.session
4. python -m backend.tools.tg_login (enter SMS code once)
5. login script resolves + joins every handle; prints which resolved
```

---

## 10. Tracking primitives (the live UX kit)

| Primitive | What it does | File |
|---|---|---|
| Tracking pill | Bottom-centre pill above dock for any live time-bound process (SOS, assignment, broadcast delivery). Tap to expand. | `CODEEXP/src/components/primitives/TrackingPill.tsx` |
| Status pipeline | Grab-style horizontal stepper for SOS / assignment lifecycles. | `StatusPipeline.tsx` |
| Severity chip | L1-L5 chip with operator code + citizen label. | `SeverityChip.tsx` |
| Coverage preview | Cells + devices + residents while drawing. | `CoveragePreview.tsx` |
| Role-preview tabs | Citizen/Responder/Ops gate before publish. | `RolePreviewTabs.tsx` |
| Slash composer | Chat input with slash command suggestions + mic + map. | `SlashComposer.tsx` |

---

## 11. Aesthetic rules (carved in token CSS)

`backdrop-filter: none !important` is enforced in `src/index.css`. So is
`--radius-sm: 0px`. The token palette:

```
surface-0  off-white (#F4F4F1)   ground
surface-2  cool grey (#EAE8E3)    cards, hatch fills
surface-3  near-black (#1A1A1A)   ops dark surfaces, drawer header
text-inverse  #F4F4F1
border-strong #1A1A1A

accent-critical #EF4444   L4/L5, SOS, dispatch
accent-warning  #FEF08A   L3, en_route
accent-info     #60A5FA   L2, citizen guidance
accent-success  #4ADE80   ready, verified, on_scene

elev shadows: 4px 4px 0 + 8px 8px 0 + 16px 16px 0 (hard offset, no blur)
```

No glassmorphism. No translucent panels. No animated gradients. No emoji
UI. No mascots. Pulses only twice on first sighting, then static.

---

## 12. What's missing (honest list)

Features designed but not yet built:

```
Auxiliary citizen flow (I can help banner)
Whiteboard inside case lobby (Yjs collaborative canvas)
Voice in case room (record-as-clip phase + LiveKit phase)
Map deck.gl heatmaps (taxi density, foot traffic)
Audit replay scrubber
After-action report composer
Source admin (pause / re-auth / replay)
Agency lock + role grant + hand-off
Find-My precision-finding view (<50m responder view)
Captain controls (assign task, ping, kick, escalate)
Mobile bottom-sheet detents (currently full drawer)
Press-release scraper (`gov_press_release.py` backend)
RSS aggregator (`rss_aggregator.py` backend)
Telegram MTProto worker (`telegram_mtproto.py` backend)
Real backend (FastAPI + Redis + Mosquitto) wired to frontend
```

Sources designed but not wired:

```
LTA DataMall traffic + MRT
OneMap themesvc AED layer
data.gov.sg v2 dengue clusters
MOH outbreak bulletins
PUB water levels
SCDF myResponder integration
gov.sg WhatsApp broadcast
Facebook public agency pages
```

---

## 13. The non-negotiables

These are the rules that don't bend.

1. The map tells truth. Every map object comes from the truth store; no
   decorative pins.
2. Opaque only. No glass, no blur, no translucent panels.
3. Audit before render. Every state-changing action emits an audit row
   first (today: stub; backend: persisted).
4. Role-preview gate before any publish that hits a citizen surface.
5. The AI Host is grounded. Every claim has a source chip.
6. No likes, no streaks, no scores. Responders are not contestants.
7. Cases are rooms. Free text + voice + Host + whiteboard, not a
   rail-with-tabs.
8. Drawing is a primary surface. Toolbox + coverage preview mandatory.
9. Severity is L1..L5. No animal codes. Same axis for all roles.
10. Text-first fallback. Every workspace works without WebGL.

---

## 14. Read order

1. `BLUEPRINT.md` (this file) — current state
2. `frontend_rebuild/DESIGN.md` — full UI/UX choreography per role
3. `frontend_rebuild/VISION.md` — surfaces, tokens, shell states
4. `frontend_rebuild/docs/audit-gates/SOURCE_AUDIT_2026-05-19.md` — sources
5. `CODEEXP/src/AppContext.tsx` — the truth store, in code
6. `CODEEXP/src/components/map/MapCanvas.tsx` — the map, in code
7. `BLUEPRINT.legacy.md` — historical, do not act on

---

## 15. Section roadmap (what ships next)

```
Section 2 (in progress)  CODEEXP shell + real basemap + live NEA + roles wired
Section 3                MapLibre layer formalisation, deck.gl heatmaps,
                          mobile bottom-sheet detents
Section 4                Backend revival — FastAPI + Redis + Mosquitto,
                          gov_press_release, rss_aggregator, telegram_mtproto
Section 5                Case lobby v2 (whiteboard, voice clips), AAR
Section 6                Audit replay, source admin, agency lock
Section 7                LiveKit voice, find-my precision view
Section 8                Partner integrations (SCDF myResponder, MOH)
```

Each section is gated by a written audit document. Nothing is "in
progress" without a section number, a plan file, and an exit gate.
