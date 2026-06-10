# KampungKaki Live AI Director

Status: runnable proof

Entry point:

```text
http://localhost:3000/demo
```

Fast verification:

```text
http://localhost:3000/demo?pace=fast
```

Presenter controls live in the reserved caption band below the scaled app:

- **Pause / Resume** freezes narration, cursor motion, and scene progression
  while keeping all role clients and backend state live.
- **Restart clean** terminates the current run, verifies cleanup, then prepares
  a fresh isolated session.
- **Terminate & clean** stops immediately, removes all session-tagged state,
  verifies zero residue, and leaves the single completion audit line.

## The Role

The AI is not a presenter standing outside KampungKaki. It becomes the people
inside it.

The Director creates one disposable live world, opens three simultaneous app
clients, acts as Resident, Responder, and Operations, and tells a single
heartfelt story through their different concerns. It moves a visible cursor
onto the current UI, clicks real controls, narrates the reason for each action,
and lets MQTT propagate the consequences to the other roles.

God Mode supplies the scale that three human characters cannot:

- Eight synthetic responder agents with different skills and locations.
- Three independent field reports.
- One severe-weather operating signal.
- Real retained presence and roster objects.

At the end, every object carrying the demo session ID is tombstoned. One fixed
audit record survives:

```text
AI demo completed at <time>
```

## Before / After

| Before | After |
|---|---|
| Slides describe features | Live roles experience one shared event |
| One browser swaps fake roles | Three app instances remain connected together |
| Generic narration lists UI | Each persona explains concern, evidence, and intent |
| Seed data persists | Every demo write is session-tagged and removed |
| Backend resilience is claimed | A responder update is made offline and reconciled live |
| Bot roster is decorative | Operations assigns a deployed bot to a second incident |
| Automation uses stale globals | The Director clicks current semantic UI controls |

## Story

Working title:

> **The Night Neighbours Became a Network**

Heavy rain is moving across Jalan Besar. Mei Ling sees water rising at an
underpass and files a non-emergency report. A few moments later her uncle
Rahman collapses after helping neighbours move belongings upstairs.

The demo follows five acts:

1. **God Mode builds the world.** AI responders, reports, and weather state
   appear on the real CSOT.
2. **Resident distinguishes concern from emergency.** Mei Ling files a flood
   report, then raises a medical SOS when Rahman collapses.
3. **Responder accepts responsibility.** Aisha declares medical capability,
   goes on duty, joins the private case, and reassures Mei Ling in case chat.
4. **Operations turns noise into truth.** Nadia verifies the flood report,
   assigns a bot to a stalled lift, and broadcasts a grounded warning.
5. **The system survives and cleans itself.** Aisha marks On scene while her
   transport is down; reconnect flushes the CSOT outbox; both sides confirm
   safety; the Director removes the entire world.

Default narration and interaction pacing targets 3-5 minutes.

## What The Audience Sees

### God Mode

- Session ID.
- AI responder count.
- Synthetic report count.
- Session-owned retained-object count.
- Current transport state.
- Final zero-residue receipt.

### Resident

- Aid card setup.
- Non-emergency report path.
- Medical SOS path.
- Help-coming state.
- Private case membership and chat.
- Verified Operations broadcast.
- Citizen safety acknowledgement.

### Responder

- Declared proficiency.
- On-duty choice.
- Location and skill-matched page.
- Privacy boundary before joining.
- Private case details after joining.
- Case chat.
- On-scene update while disconnected.
- Responder safety acknowledgement.

### Operations

- Simultaneous report, SOS, event, and responder state.
- Report verification into a canonical incident.
- AI bot selection for a separate investigation.
- Area broadcast.
- Oversight without re-entering the resident's information.

## Runtime Shape

```text
DirectorStage
  |
  +-- iframe: Resident app --------\
  +-- iframe: Responder app --------+-- MQTT WebSocket -- Mosquitto
  +-- iframe: Operations app -------/                       |
  |                                                         v
  +-- God Mode API -------------------------------> Redis retained mirror
  |
  +-- Qwen scene WAVs
```

The iframes are same-origin but each loads its own React and CSOT runtime. They
share the broker, not in-memory application state.

The Director keeps all three clients alive and changes only the audience's
camera. The one three-up shot makes propagation visible; focused shots make
the story legible.

The voice system and each role receive a short, full-size presentation card
before their first scene. These cards identify the Director, Qwen3-TTS model,
character, role, and active English reference voice, then fully disappear.
Model and role names are not relegated to persistent tiny technical labels.

## AI Agent Model

The show uses a narrow multi-agent model:

| Agent | Allowed concerns | Allowed actions |
|---|---|---|
| Director | Story, pacing, receipts, teardown | Camera, narration, lifecycle API |
| Resident | Safety, privacy, clarity | Profile, report, SOS, chat, acknowledge |
| Responder | Capability, distance, responsibility | Duty, join, chat, arrive, acknowledge |
| Operations | Verification, prioritisation, public action | Verify, dispatch, declare, broadcast |
| Bot responders | Bounded assigned tasks | Roster presence and selected investigations |

This borrows Aiko's skill law: commands are explicit, actions have
postconditions, and an agent does not receive arbitrary mutation access.

The LLM may rewrite narration or choose among legal scene commands before a
run. During a judged performance, the executor stays deterministic. A failed
postcondition stops the story and starts cleanup.

## Voice

Aiko already supplies the local voice stack. The demo assigns a stable English
female reference to each speaking identity:

| Identity | Reference |
|---|---|
| Director | `7_juilliard` |
| Resident, Mei Ling | `3_warm` |
| Responder, Aisha | `2_amateur` |
| Operations, Nadia | `4_classically_trained` |

The runtime is:

- `qwentts.cpp`
- quantized Qwen3-TTS 0.6B Base talker
- quantized 12 Hz tokenizer/codec
- reference WAV plus exact transcript cloning
- 24 kHz mono WAV output

Generate the live scene files:

```bash
npm run demo:voice
```

The browser requests:

```text
/demo/voice/<scene-id>.wav
```

The public demo requires all generated WAV assets; it does not fall back to a
browser voice. The bottom technical strip identifies the active reference and
the Aiko `qwentts.cpp` path while each character speaks.

This is direct immutable scene synthesis. It does not depend on Aiko Library's
downloaded/fill-gap playback modes.

## Backend Resilience Proof

The Director pauses only the Responder transport:

1. MQTT reconnect is disabled for that client.
2. Its WebSocket is destroyed.
3. Aisha clicks On scene.
4. The Responder UI updates optimistically.
5. The Resident correctly does not show arrival yet.
6. Reconnect is enabled.
7. The CSOT demo outbox publishes the latest QoS-1 retained value per topic.
8. The Resident receives `someone is on scene`.

This proves useful offline action and honest remote acknowledgement separately.

## Clean Teardown Contract

Every demo browser receives:

```text
?demoSession=DEMO-...
```

The CSOT layer attaches `demoSessionId` to:

- identities
- users and responders
- presence
- reports, SOS, cases, members, and chat
- incidents and investigations
- notifications and action logs

Cleanup:

1. Disconnects the three role clients.
2. Scans Redis's retained mirror for the session marker.
3. Publishes retained MQTT tombstones.
4. Repeats until three consecutive scans are empty, covering late Last-Will
   presence messages.
5. Verifies zero tagged objects.
6. Overwrites `csot/intel/demo_run/latest` with one completion line.

It does not reset unrelated state.

## Verification

Run:

```bash
npm run demo:proof
```

The proof runner:

- launches the Director in fast mode
- grants a fixed Singapore geolocation
- starts the story
- waits for completion or failure
- captures the final receipt
- queries the backend for residue
- fails unless retained demo objects equal zero

The final screenshot and JSON receipt are written under `tmp/ai-demo/proof/`.

## Guardrails

- The story uses clearly fictional people and health details.
- AI narration cannot invent tool results.
- Other citizens never receive Mei Ling's SOS or aid card.
- Bots are visibly labelled as demo agents.
- No production-wide reset endpoint is used.
- Cleanup failure is a demo failure.
- A successful build is not a substitute for the full live proof.
