"""
KampungKaki CSOT bridge — the real backend spine.

Responsibilities (per docs/ARCHITECTURE.md §2.4, §4):
  1. Identity     — POST /api/join issues a unique userId + session and
                    publishes the user as a retained CSOT object. This is what
                    replaces the faked single SELF_ID; every browser is a
                    distinct person.
  2. Durability   — mirrors every retained `csot/#` message into Redis, and on
                    startup replays Redis -> MQTT so a cold/empty broker is
                    repopulated (retained messages survive a broker restart).
  3. Presence     — exposes the retained `csot/presence/#` topics (clients own
                    them via MQTT Last-Will, this just reads the snapshot).

The broker (Mosquitto) is the transport; this process is the durable
read/write side and the identity authority. Clients talk MQTT-over-WebSockets
to the broker directly for state, and HTTPS to this bridge for join.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid

import paho.mqtt.client as mqtt
import redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
PORT = int(os.getenv("PORT", "8787"))
RETAINED_HASH = "kk:retained"  # topic -> payload mirror of all retained CSOT

rc = redis.Redis.from_url(REDIS_URL, decode_responses=True)

app = FastAPI(title="KampungKaki CSOT bridge", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ── MQTT mirror client ────────────────────────────────────────────────────────
_client = mqtt.Client(
    client_id=f"kk-bridge-{uuid.uuid4().hex[:6]}",
    protocol=mqtt.MQTTv5,
    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
)


def _on_connect(client, userdata, flags, reason_code, properties=None):
    print(f"[bridge] connected to mqtt://{MQTT_HOST}:{MQTT_PORT} ({reason_code})")
    client.subscribe("csot/#", qos=1)
    # Cold-start replay: push every durable object back as a retained message
    # so a freshly restarted broker immediately serves current state.
    mirror = rc.hgetall(RETAINED_HASH)
    for topic, payload in mirror.items():
        if payload:
            client.publish(topic, payload, qos=1, retain=True)
    print(f"[bridge] replayed {len(mirror)} retained objects from Redis")


def _on_message(client, userdata, msg):
    payload = msg.payload.decode() if msg.payload else ""
    if payload:
        rc.hset(RETAINED_HASH, msg.topic, payload)
    else:
        rc.hdel(RETAINED_HASH, msg.topic)  # empty retained payload = tombstone


_client.on_connect = _on_connect
_client.on_message = _on_message
_demo_lifecycle_lock = threading.RLock()


def _mqtt_loop():
    while True:
        try:
            _client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
            _client.loop_forever()
        except Exception as exc:  # broker not up yet / network blip
            print(f"[bridge] mqtt reconnect in 2s: {exc}")
            time.sleep(2)


threading.Thread(target=_mqtt_loop, daemon=True).start()


def publish(topic: str, obj: dict, retain: bool = True) -> None:
    _client.publish(topic, json.dumps(obj), qos=1, retain=retain)


# ── identity ──────────────────────────────────────────────────────────────────
class JoinReq(BaseModel):
    name: str
    role: str
    demoSessionId: str | None = None


@app.post("/api/join")
def join(body: JoinReq):
    role = body.role if body.role in ("citizen", "responder", "ops") else "citizen"
    uid = f"U-{role[:3].upper()}-{uuid.uuid4().hex[:5].upper()}"
    session = uuid.uuid4().hex
    user = {
        "id": uid,
        "name": (body.name or "").strip() or "Anon",
        "role": role,
        "joinedAt": int(time.time() * 1000),
    }
    if body.demoSessionId:
        user["demoSessionId"] = body.demoSessionId
    publish(f"csot/network/user/{uid}", user)        # retained identity object
    rc.hset("kk:sessions", session, uid)
    return {"userId": uid, "session": session, "name": user["name"], "role": role}


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "mqttConnected": _client.is_connected(),
        "retainedObjects": rc.hlen(RETAINED_HASH),
    }


@app.get("/api/presence")
def presence():
    out = {}
    for topic, payload in rc.hgetall(RETAINED_HASH).items():
        if topic.startswith("csot/presence/"):
            try:
                out[topic] = json.loads(payload)
            except Exception:
                pass
    return out


# ── live AI demo lifecycle ───────────────────────────────────────────────────
# Every demo-created object carries demoSessionId. Cleanup removes exactly those
# retained objects and leaves the rest of the broker untouched. The single
# surviving audit record is written without that marker.

class DemoStartReq(BaseModel):
    title: str = "KampungKaki live AI demo"


def demo_id() -> str:
    return f"DEMO-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"


def demo_obj(session_id: str, **values):
    return {**values, "demoSessionId": session_id}


def delete_retained(topic: str) -> None:
    info = _client.publish(topic, "", qos=1, retain=True)
    info.wait_for_publish(timeout=3)
    rc.hdel(RETAINED_HASH, topic)


def retained_for_demo(session_id: str) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for topic, payload in rc.hgetall(RETAINED_HASH).items():
        try:
            obj = json.loads(payload)
        except Exception:
            continue
        if isinstance(obj, dict) and obj.get("demoSessionId") == session_id:
            found[topic] = obj
    return found


def retained_demo_session_ids() -> set[str]:
    session_ids: set[str] = set()
    for payload in rc.hgetall(RETAINED_HASH).values():
        try:
            obj = json.loads(payload)
        except Exception:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("demoSessionId"), str):
            session_ids.add(obj["demoSessionId"])
    return session_ids


def remove_demo_session_objects(session_id: str) -> set[str]:
    removed_topics: set[str] = set()
    # Disconnecting clients can publish their final presence/LWT a fraction
    # after the first tombstone pass. Require several quiet scans so cleanup is
    # stable rather than merely momentarily empty.
    quiet_scans = 0
    for _ in range(12):
        objects = retained_for_demo(session_id)
        if not objects:
            quiet_scans += 1
            if quiet_scans >= 3:
                break
        else:
            quiet_scans = 0
            for topic in objects:
                removed_topics.add(topic)
                delete_retained(topic)
        time.sleep(0.15)
    return removed_topics


def demo_user_ids_from(objects: dict[str, dict]) -> set[str]:
    user_ids: set[str] = set()
    for topic, obj in objects.items():
        if topic.startswith("csot/network/user/") and isinstance(obj.get("id"), str):
            user_ids.add(obj["id"])
    return user_ids


def remove_presence_for_user_ids(user_ids: set[str]) -> set[str]:
    removed_topics: set[str] = set()
    if not user_ids:
        return removed_topics
    roles = ("citizen", "responder", "ops")
    # Presence can be published by MQTT LWT a fraction after the client closes.
    # Delete by user id, not only by demoSessionId, so even untagged presence from
    # the MQTT client is cleaned with the rest of the disposable performance.
    for _ in range(8):
        found = False
        for user_id in user_ids:
            for role in roles:
                topic = f"csot/presence/{role}/{user_id}"
                if rc.hexists(RETAINED_HASH, topic):
                    found = True
                    removed_topics.add(topic)
                    delete_retained(topic)
        if not found:
            break
        time.sleep(0.15)
    return removed_topics


@app.post("/api/demo/start")
def start_demo(body: DemoStartReq):
    with _demo_lifecycle_lock:
        # The live Director is a singleton performance. A browser or process can
        # die before its finally-cleanup runs, so every new performance first
        # removes abandoned demo-tagged worlds. Normal application state and the
        # one untagged completion audit line are untouched.
        abandoned_sessions = sorted(retained_demo_session_ids())
        removed_abandoned = 0
        for abandoned_id in abandoned_sessions:
            removed_abandoned += len(remove_demo_session_objects(abandoned_id))

        session_id = demo_id()
        now = int(time.time() * 1000)
        publish(
            f"csot/intel/demo_session/{session_id}",
            demo_obj(
                session_id,
                id=session_id,
                title=body.title,
                status="running",
                startedAt=now,
            ),
        )
        return {
            "ok": True,
            "sessionId": session_id,
            "startedAt": now,
            "abandonedSessionsRemoved": len(abandoned_sessions),
            "abandonedObjectsRemoved": removed_abandoned,
        }


@app.post("/api/demo/{session_id}/seed")
def seed_demo(session_id: str):
    now = int(time.time() * 1000)
    centre = {"lng": 103.8644, "lat": 1.3022}
    bots = [
        ("Mariam · Medical Lead", "Medic", "medic", ["medical"]),
        ("Wei Jian · AED Runner", "Volunteer", "medic", ["medical", "aed"]),
        ("Siti · Crowd Guide", "Volunteer", "aux", ["hazard", "medical"]),
        ("Kumar · Access Spotter", "LTA", "search", ["hazard"]),
        ("Farah · Fire Auxiliary", "SCDF", "fire", ["fire"]),
        ("Daniel · First Aid Support", "Volunteer", "medic", ["medical"]),
        ("Hafiz · Traffic Access", "LTA", "aux", ["hazard"]),
        ("Nurul · Triage Support", "Volunteer", "medic", ["medical", "other"]),
    ]
    bot_ids = []
    for index, (name, org, role, skills) in enumerate(bots, start=1):
        bot_id = f"BOT-{session_id[-4:]}-{index:02d}"
        bot_ids.append(bot_id)
        loc = {
            "lng": centre["lng"] + ((index % 4) - 1.5) * 0.0022,
            "lat": centre["lat"] + ((index // 4) - 0.5) * 0.0020,
        }
        publish(
            f"csot/network/user/{bot_id}",
            demo_obj(
                session_id,
                id=bot_id,
                username=name,
                displayName=name,
                phone="",
                primaryRole="responder",
                address="",
                skills=skills,
                available=True,
            ),
        )
        publish(
            f"csot/operations/responder/{bot_id}",
            demo_obj(
                session_id,
                id=bot_id,
                name=name,
                org=org,
                role=role,
                status="ready",
                location=loc,
                groups=["AI-DEMO-RESPONSE"],
                unitType="volunteer" if org == "Volunteer" else "professional",
                onDuty=True,
                proficiencies=skills,
                demo=True,
                note="AI demo responder",
            ),
        )
        publish(
            f"csot/presence/responder/{bot_id}",
            demo_obj(
                session_id,
                userId=bot_id,
                role="responder",
                name=name,
                online=True,
                at=now,
                synthetic=True,
            ),
        )

    reports = [
        ("Fire", "Smoke at MRT Exit B", "An e-bike is burning near the covered walkway; thick smoke is building at the choke point.", 103.8640, 1.3009),
        ("Hazard", "Crowd bottleneck at covered walkway", "Rain is keeping people under shelter, so evacuees are not dispersing from the exit.", 103.8667, 1.3034),
        ("Hazard", "Emergency access road blocked", "Bystanders and stopped vehicles are narrowing the ambulance approach road.", 103.8615, 1.3042),
    ]
    for index, (kind, title, body, lng, lat) in enumerate(reports, start=1):
        owner_id = f"BOT-CIT-{session_id[-4:]}-{index:02d}"
        report_id = f"REP-{session_id[-4:]}-{index:02d}"
        publish(
            f"csot/intake/report/{owner_id}/{report_id}",
            demo_obj(
                session_id,
                id=report_id,
                kind=kind.lower(),
                title=title,
                body=body,
                location={"lng": lng, "lat": lat},
                ownerId=owner_id,
                reporterTrust=0.58 + index * 0.08,
                status="pending",
                createdAt=now + index,
                auditTrail=["Synthetic demo report created by God Mode."],
            ),
        )

    event_id = f"EV-{session_id[-4:]}-RAIN"
    publish(
        f"csot/incidents/event/{event_id}",
        demo_obj(
            session_id,
            id=event_id,
            kind="weather",
            title="Rain tightening the station-exit bottleneck",
            severity=3,
            status="verified",
            location=centre,
            source="God Mode · synthetic demo feed",
            createdAt=now,
            liveValue="Scenario feed",
        ),
    )
    log_id = f"LOG-{session_id[-4:]}-SEED"
    publish(
        f"csot/presentation/log/ops/{log_id}",
        demo_obj(
            session_id,
            id=log_id,
            actorId="godmode",
            actorRole="system",
            action="godmode.mass_scenario_deployed",
            targetId=session_id,
            message=f"God Mode deployed {len(bot_ids)} AI responders, 3 station-exit field reports, and a weather signal.",
            severity=3,
            createdAt=now,
            visibleTo=["ops"],
        ),
    )
    return {
        "ok": True,
        "sessionId": session_id,
        "responders": len(bot_ids),
        "reports": len(reports),
        "events": 1,
        "botIds": bot_ids,
    }


@app.post("/api/demo/{session_id}/swarm")
def swarm_demo(session_id: str):
    objects = retained_for_demo(session_id)
    sos_items = [
        (topic, obj)
        for topic, obj in objects.items()
        if topic.startswith("csot/intake/sos/") and obj.get("status") not in ("resolved", "cancelled")
    ]
    if not sos_items:
        return {"ok": False, "error": "no_live_sos"}

    sos_topic, sos = sorted(sos_items, key=lambda item: item[1].get("startedAt", 0))[-1]
    sos_id = sos["id"]
    target = sos.get("location") or {"lng": 103.8644, "lat": 1.3022}
    bots = [
        obj
        for topic, obj in sorted(objects.items())
        if topic.startswith("csot/operations/responder/") and obj.get("demo")
    ][:6]
    if not bots:
        return {"ok": False, "error": "no_demo_responders"}

    existing_members = [
        obj
        for topic, obj in objects.items()
        if topic.startswith(f"csot/case/{sos_id}/member/")
    ]
    now = int(time.time() * 1000)

    def publish_swarm_step(step: int, total: int) -> None:
        # Stop if cleanup has already tombstoned this demo session.
        if f"csot/intel/demo_session/{session_id}" not in retained_for_demo(session_id):
            return
        frac = min(0.92, step / total)
        offsets = [
            (-0.0100, 0.0060),
            (-0.0065, -0.0075),
            (0.0080, 0.0050),
            (0.0100, -0.0040),
            (-0.0030, 0.0100),
            (0.0045, -0.0090),
        ]
        for index, bot in enumerate(bots):
            dx, dy = offsets[index % len(offsets)]
            lng = target["lng"] + dx * (1 - frac)
            lat = target["lat"] + dy * (1 - frac)
            eta = max(1, int((total - step + index % 3 + 1)))
            member = demo_obj(
                session_id,
                id=bot["id"],
                name=bot["name"],
                role="responder",
                proficiencies=bot.get("proficiencies", []),
                location={"lng": lng, "lat": lat},
                status="en_route",
                eta=f"{eta} min",
                joinedAt=now + index,
            )
            publish(f"csot/case/{sos_id}/member/{bot['id']}", member)
            publish(
                f"csot/operations/responder/{bot['id']}",
                {**bot, "status": "en_route", "assignedSosId": sos_id, "location": member["location"]},
            )

    def run_swarm() -> None:
        total = 6
        for step in range(total + 1):
            publish_swarm_step(step, total)
            time.sleep(1.0)

    publish(
        sos_topic,
        {
            **sos,
            "status": "active",
            "memberCount": len(existing_members) + len(bots),
        },
    )
    threading.Thread(target=run_swarm, daemon=True).start()
    return {
        "ok": True,
        "sessionId": session_id,
        "sosId": sos_id,
        "responders": len(bots),
        "roles": [bot.get("name") for bot in bots],
    }


@app.get("/api/demo/{session_id}/status")
def demo_status(session_id: str):
    objects = retained_for_demo(session_id)
    by_cluster: dict[str, int] = {}
    for topic in objects:
        parts = topic.split("/")
        cluster = parts[1] if len(parts) > 1 else "other"
        by_cluster[cluster] = by_cluster.get(cluster, 0) + 1
    return {
        "ok": True,
        "sessionId": session_id,
        "retainedObjects": len(objects),
        "byCluster": by_cluster,
        "topics": sorted(objects),
    }


@app.post("/api/demo/{session_id}/cleanup")
def cleanup_demo(session_id: str):
    with _demo_lifecycle_lock:
        demo_user_ids = demo_user_ids_from(retained_for_demo(session_id))
        removed_topics = remove_demo_session_objects(session_id)
        removed_topics.update(remove_presence_for_user_ids(demo_user_ids))
        completed_at = int(time.time() * 1000)
        line = f"AI demo completed at {time.strftime('%Y-%m-%d %H:%M:%S %Z')}"
        publish(
            "csot/intel/demo_run/latest",
            {
                "id": "DEMO-RUN-LATEST",
                "message": line,
                "completedDemoId": session_id,
                "completedAt": completed_at,
            },
        )
        return {
            "ok": True,
            "sessionId": session_id,
            "removedObjects": len(removed_topics),
            "residue": len(retained_for_demo(session_id)),
            "audit": line,
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("bridge:app", host="0.0.0.0", port=PORT)
