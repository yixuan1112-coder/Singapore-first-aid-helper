"""
Seed data matching AppContext initial state.
Called once on first backend start (or when Redis is empty).
"""
import time
import store
from models import Responder, CanonicalEvent, DistressSession, CitizenReport, CaseRoom, ChatEntry


def seed_all():
    if store.is_seeded():
        return

    now = time.time() * 1000

    responders = [
        Responder(id="R-BRAVO-9", name="Bravo-9", org="SCDF", role="medic", status="en_route",
                  location={"lng": 103.82, "lat": 1.29}, groups=["G-SCDF-EAST"],
                  unitType="professional", demo=True,
                  note="Demo SCDF professional unit. Volunteers can see movement but cannot join official-only case work."),
        Responder(id="R-CHARLIE-3", name="Charlie-3", org="Volunteer", role="fire", status="ready",
                  location={"lng": 103.788, "lat": 1.278}, groups=["G-FIRE-VOL"], unitType="volunteer"),
        Responder(id="R-ECHO-1", name="Echo-1", org="Volunteer", role="medic", status="ready",
                  location={"lng": 103.85, "lat": 1.3}, groups=["G-MEDIC-VOL"], unitType="volunteer"),
        Responder(id="R-DELTA-1", name="Delta-1", org="SCDF", role="medic", status="ready",
                  location={"lng": 103.86, "lat": 1.31}, groups=["G-SCDF-EAST"],
                  unitType="professional", demo=True, note="Demo SCDF ambulance responder."),
        Responder(id="R-SPF-12", name="SPF Patrol-12", org="SPF", role="aux", status="en_route",
                  location={"lng": 103.87, "lat": 1.32}, unitType="professional", covert=True,
                  demo=True, note="Demo SPF movement."),
        Responder(id="R-SAF-ENG-6", name="SAF Eng-6", org="SAF", role="search", status="ready",
                  location={"lng": 103.84, "lat": 1.315}, unitType="professional", demo=True,
                  note="Demo SAF engineer support unit."),
        Responder(id="R-SCDF-HAZMAT", name="SCDF HazMat-3", org="SCDF", role="fire", status="ready",
                  location={"lng": 103.81, "lat": 1.285}, groups=["G-SCDF-EAST"],
                  unitType="professional", demo=True, note="Demo SCDF hazmat/fire unit."),
    ]

    events = [
        CanonicalEvent(id="EVT-001", kind="flood", title="Bedok Canal overflow · L3",
                       severity=3, status="verified",
                       location={"lng": 103.918, "lat": 1.318},
                       area=[{"lng": 103.912, "lat": 1.314}, {"lng": 103.924, "lat": 1.314},
                             {"lng": 103.924, "lat": 1.322}, {"lng": 103.912, "lat": 1.322}],
                       source="NEA rainfall + 3 corroborating reports", createdAt=now - 3600000),
        CanonicalEvent(id="EVT-002", kind="fire", title="Toa Payoh HDB fire · L4",
                       severity=4, status="verified",
                       location={"lng": 103.848, "lat": 1.334},
                       source="SCDF dispatch", createdAt=now - 1800000),
        CanonicalEvent(id="EVT-003", kind="medical", title="Jurong East MRT medical · L2",
                       severity=2, status="verified",
                       location={"lng": 103.742, "lat": 1.333},
                       source="Citizen report + SCDF", createdAt=now - 900000),
    ]

    sos_sessions = [
        DistressSession(id="SOS-029", citizenName="Citizen A", category="Medical",
                        location={"lng": 103.742, "lat": 1.333},
                        status="requesting", createdAt=now - 300000),
    ]

    reports = [
        CitizenReport(id="REP-4920", kind="medical", title="Person collapsed near MRT",
                      body="Elderly man collapsed near Jurong East MRT exit B.",
                      location={"lng": 103.742, "lat": 1.333}, status="pending",
                      createdAt=now - 600000),
        CitizenReport(id="REP-4921", kind="fire", title="Smoke from Toa Payoh block",
                      body="Thick smoke coming from level 8 of Block 85.",
                      location={"lng": 103.848, "lat": 1.334}, status="verified",
                      createdAt=now - 1800000),
    ]

    cases = [
        CaseRoom(id="CASE-ALPHA-09", name="ALPHA-09", severity=4, state="active",
                 members=["R-BRAVO-9", "R-ECHO-1"], restricted=True,
                 source="ops", createdAt=now - 3600000),
    ]

    for r in responders:
        store.put("responders", r.id, r.model_dump())
    for e in events:
        store.put("events", e.id, e.model_dump())
    for s in sos_sessions:
        store.put("sos", s.id, s.model_dump())
    for rp in reports:
        store.put("reports", rp.id, rp.model_dump())
    for c in cases:
        store.put("cases", c.id, c.model_dump())

    store.mark_seeded()
    print(f"[seed] Seeded {len(responders)} responders, {len(events)} events, "
          f"{len(sos_sessions)} SOS, {len(reports)} reports, {len(cases)} cases.")
