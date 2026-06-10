# KampungKaki Live Demo Script — "Smoke at Exit B"

Target runtime: 4-5 minutes.

Principle: scenario first, feature narration after. The emergency starts as an
SOS. Reports are supporting witness context, not the trigger.

Cast:
- Mei Ling — Citizen, witness/caller at Nicoll Highway MRT Exit B.
- Elderly man — casualty. He stays the casualty throughout.
- Aisha — Responder, nearby, on duty only after she opts in.
- Nadia — Ops, verifies evidence and coordinates public/private information.
- Pelita / Bekal / Pondok — AI Kaki agents. They are app voices, not human
  characters.

## Script

DIRECTOR: This is not a video. Three real users are on one shared map. Everything you see — reports, responders, alerts, the case itself — moves between them over MQTT, live.

ACTION — Open three live clients: Citizen Mei Ling, Responder Aisha, Ops Nadia.

MEI LING: It is pouring at the MRT exit. An e-bike is smoking at the covered choke point and people are crowding under shelter. I am asthmatic, so first I make sure my aid card is set.

ACTION — Mei Ling opens Profile and sets phone, asthma, inhaler.

AISHA: I am Aisha, a nearby community responder. I start in lepak mode — no mission, no private details, and no false urgency until I choose to go on duty.

ACTION — Aisha sets Medical + Hazard skills, then toggles On duty.

NADIA: I am Nadia in ops. I am not here to improvise heroics — I see reports, responders, cases, and map evidence, then decide what to publish and who to send.

PELITA: Before the emergency escalates, I read the map snapshot the app already refreshed — rain, air, traffic, and public safety layers.

ACTION — Mei Ling asks Pelita: "How is it looking around me right now near the MRT exit?"

ACTION — Aisha opens AED and traffic incident map samples one at a time.

MEI LING: Now it is an emergency. An elderly man near the smoke has collapsed and is not responding properly. I am the witness, he is the casualty, and this needs a Medical SOS.

ACTION — Mei Ling taps Need help → Medical. Details: "Nicoll Highway MRT Exit B: e-bike smoke at the covered walkway. Elderly man collapsed; I am the witness, he is the casualty. Need AED and responders."

MEI LING: Bekal, elderly man collapsed after e-bike smoke at Nicoll Highway MRT Exit B. I am the witness; he is the casualty. Which AED and A&E hospital should bystanders use, and what should I do while Aisha is coming?

ACTION — Bekal answers using AED + hospital skills and pins the map.

DIRECTOR: Now I add disposable witness reports, rain pressure, and AI responder agents. They support the SOS; they are not the emergency trigger.

ACTION — God Mode seeds supporting reports and bot responders, all session-tagged.

DIRECTOR: The same incident now exists in three maps. Mei Ling sees her SOS. Aisha receives a matched page. Nadia sees the smoke reports and the live case forming.

ACTION — Show all three maps. Highlight MQTT fanout.

AISHA: Before I join, I see the category and location but not private medical details. Once I commit, the case room opens and Mei Ling’s aid card becomes useful.

ACTION — Aisha opens the SOS page, shows privacy gate, joins. God Mode swarms bot responders. Mei Ling sees responder approach markers.

AISHA: Mei Ling — on my way from the north exit, about ninety seconds. Your aid card shows asthma, so keep your inhaler close in this smoke. If the elderly man is not breathing normally, start CPR and send someone safe toward the marked AED.

MEI LING: This is the moment that matters. My map does not just say help is coming — I can see responders moving toward us and an AED runner assigned.

NADIA: The SOS is already live. The reports are supporting context, so I verify with the map before I broadcast: access, cameras, rain, AEDs, and emergency hospitals.

ACTION — Nadia opens traffic incident, traffic camera, rainfall, AED, and hospital popups one at a time. Dismiss each before the next.

NADIA: Pondok, ops picture for Exit B: active medical SOS for collapsed elderly casualty, supporting smoke and access reports, on-duty responders. Which responder fits AED support and what facts should I verify before broadcast?

ACTION — Pondok answers from roster + cases + reports. It gives fit/context, not orders.

NADIA: Medical goes to the casualty, the AED runner goes to the nearest device, and a traffic check covers the access road.

ACTION — Nadia dispatches investigation for emergency access road blocked.

NADIA: The smoke and access risk are verified, so I warn people away from the station exit — without exposing the private case room.

ACTION — Ops broadcasts: "Avoid MRT Exit B smoke incident. Keep the covered walkway and access road clear for responders."

ACTION — Citizen receives the alert.

DIRECTOR: Now I break only Aisha’s route to MQTT. The app keeps working locally, but it must not pretend the broker has delivered her arrival.

AISHA: I mark myself on scene while the connection is down. My phone keeps that update queued instead of lying to Mei Ling.

DIRECTOR: Mei Ling still has not received Aisha’s arrival. That restraint is the point — no false acknowledgement before MQTT delivers it.

ACTION — Restore Aisha’s connection.

DIRECTOR: The connection returns. MQTT flushes the queued update, and Mei Ling’s map reconciles to someone on scene.

MEI LING: The alert tells everyone else what to avoid. In my case room I can see who is here — the AED is with the elderly man and responders have him, and I am clear of the smoke. So I tap I’m safe to close my side.

AISHA: The citizen’s safe tap is not enough by itself, and my field confirmation is not enough alone. The case closes only when both are true.

DIRECTOR: Hospitals, AEDs, traffic, cameras, weather, responders, chat, alerts, and state changes all served one story: map evidence plus MQTT coordination.

DIRECTOR: This run is complete. I remove the agents, users, reports, case messages, alerts, presence, and logs it created. The map goes back to how it was.

## Feature Coverage

SOS-first emergency flow, Pelita conditions, Bekal AED/hospital directives, Responder duty/skills, matched paging, pre-join privacy, private case room, responder swarm markers, Ops console, map API popups, Pondok roster/case/report reasoning, public broadcast, MQTT offline queue/reconcile, dual acknowledgement, clean teardown.
