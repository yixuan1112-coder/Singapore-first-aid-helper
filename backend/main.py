from __future__ import annotations
import asyncio
import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional, Set

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../CODEEXP/.env.local"))

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import store
import seed as seed_module
from models import (
    Responder, CanonicalEvent, DistressSession, CitizenReport,
    CaseRoom, ChatEntry, AppState,
)

app = FastAPI(title="Kampung Kaki Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

connected: Set[WebSocket] = set()


@app.on_event("startup")
async def startup():
    seed_module.seed_all()
    print(f"[boot] Redis available: {store.REDIS_AVAILABLE}")


async def broadcast(event_type: str, payload: Any):
    msg = json.dumps({"type": event_type, "payload": payload})
    dead = set()
    for ws in connected:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    connected.difference_update(dead)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected.add(ws)
    state = _build_state()
    await ws.send_text(json.dumps({"type": "state:full", "payload": state}))
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        connected.discard(ws)


def _build_state() -> dict:
    return {
        "responders": store.list_all("responders"),
        "events": store.list_all("events"),
        "sosSessions": store.list_all("sos"),
        "reports": store.list_all("reports"),
        "cases": store.list_all("cases"),
        "chat": store.list_all("chat"),
    }


@app.get("/api/state")
def get_state():
    return _build_state()


# ── Responders ────────────────────────────────────────────────────────────────

class PatchResponder(BaseModel):
    status: Optional[str] = None
    location: Optional[dict] = None
    assignedSosId: Optional[str] = None
    assignedEventId: Optional[str] = None


@app.get("/api/responders")
def list_responders():
    return store.list_all("responders")


@app.patch("/api/responders/{id}")
async def patch_responder(id: str, body: PatchResponder):
    doc = store.get("responders", id)
    if not doc:
        raise HTTPException(404, "Responder not found")
    if body.status is not None:
        doc["status"] = body.status
    if body.location is not None:
        doc["location"] = body.location
    if body.assignedSosId is not None:
        doc["assignedSosId"] = body.assignedSosId
    if body.assignedEventId is not None:
        doc["assignedEventId"] = body.assignedEventId
    store.put("responders", id, doc)
    await broadcast("responder:updated", doc)
    return doc


# ── Events ────────────────────────────────────────────────────────────────────

class CreateEvent(BaseModel):
    kind: str
    title: str
    severity: int
    location: dict
    area: List[dict] = []
    source: Optional[str] = None


class PatchEvent(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    severity: Optional[int] = None
    assignedResponderIds: Optional[List[str]] = None


@app.get("/api/events")
def list_events():
    return store.list_all("events")


@app.post("/api/events", status_code=201)
async def create_event(body: CreateEvent):
    eid = f"EVT-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "id": eid,
        "kind": body.kind,
        "title": body.title,
        "severity": body.severity,
        "status": "verified",
        "location": body.location,
        "area": body.area,
        "source": body.source or "ops declaration",
        "createdAt": time.time() * 1000,
        "assignedResponderIds": [],
    }
    store.put("events", eid, doc)
    await broadcast("event:created", doc)
    return doc


@app.patch("/api/events/{id}")
async def patch_event(id: str, body: PatchEvent):
    doc = store.get("events", id)
    if not doc:
        raise HTTPException(404, "Event not found")
    if body.status is not None:
        doc["status"] = body.status
        if body.status == "resolved":
            doc["resolvedAt"] = time.time() * 1000
    if body.title is not None:
        doc["title"] = body.title
    if body.severity is not None:
        doc["severity"] = body.severity
    if body.assignedResponderIds is not None:
        doc["assignedResponderIds"] = body.assignedResponderIds
    store.put("events", id, doc)
    await broadcast("event:updated", doc)
    return doc


@app.post("/api/events/{id}/assign")
async def assign_event(id: str, body: dict):
    responder_id = body.get("responderId")
    if not responder_id:
        raise HTTPException(400, "responderId required")
    event = store.get("events", id)
    if not event:
        raise HTTPException(404)
    responder = store.get("responders", responder_id)
    if not responder:
        raise HTTPException(404, "Responder not found")
    ids = event.get("assignedResponderIds", [])
    if responder_id not in ids:
        ids.append(responder_id)
    event["assignedResponderIds"] = ids
    store.put("events", id, event)
    responder["status"] = "en_route"
    responder["assignedEventId"] = id
    store.put("responders", responder_id, responder)
    await broadcast("event:updated", event)
    await broadcast("responder:updated", responder)
    return {"event": event, "responder": responder}


# ── SOS Sessions ──────────────────────────────────────────────────────────────

class CreateSos(BaseModel):
    citizenName: str
    category: str
    location: dict


class PatchSos(BaseModel):
    status: Optional[str] = None
    assignedResponderId: Optional[str] = None


@app.get("/api/sos")
def list_sos():
    return store.list_all("sos")


@app.post("/api/sos", status_code=201)
async def create_sos(body: CreateSos):
    sid = f"SOS-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "id": sid,
        "citizenName": body.citizenName,
        "category": body.category,
        "location": body.location,
        "status": "requesting",
        "assignedResponderId": None,
        "createdAt": time.time() * 1000,
    }
    store.put("sos", sid, doc)
    await broadcast("sos:created", doc)
    return doc


@app.patch("/api/sos/{id}")
async def patch_sos(id: str, body: PatchSos):
    doc = store.get("sos", id)
    if not doc:
        raise HTTPException(404)
    if body.status is not None:
        doc["status"] = body.status
    if body.assignedResponderId is not None:
        doc["assignedResponderId"] = body.assignedResponderId
        responder = store.get("responders", body.assignedResponderId)
        if responder:
            responder["status"] = "en_route"
            responder["assignedSosId"] = id
            store.put("responders", body.assignedResponderId, responder)
            await broadcast("responder:updated", responder)
    store.put("sos", id, doc)
    await broadcast("sos:updated", doc)
    return doc


# ── Reports ───────────────────────────────────────────────────────────────────

class CreateReport(BaseModel):
    kind: str
    title: str
    body: str
    location: dict
    reporterId: Optional[str] = None


class PatchReport(BaseModel):
    status: str
    claimedBy: Optional[str] = None


@app.get("/api/reports")
def list_reports():
    return store.list_all("reports")


@app.post("/api/reports", status_code=201)
async def create_report(body: CreateReport):
    rid = f"REP-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "id": rid,
        "kind": body.kind,
        "title": body.title,
        "body": body.body,
        "location": body.location,
        "status": "pending",
        "reporterId": body.reporterId,
        "claimedBy": None,
        "createdAt": time.time() * 1000,
    }
    store.put("reports", rid, doc)
    await broadcast("report:created", doc)
    return doc


@app.patch("/api/reports/{id}")
async def patch_report(id: str, body: PatchReport):
    doc = store.get("reports", id)
    if not doc:
        raise HTTPException(404)
    doc["status"] = body.status
    if body.claimedBy:
        doc["claimedBy"] = body.claimedBy
    if body.status == "verified":
        eid = f"EVT-{uuid.uuid4().hex[:6].upper()}"
        event = {
            "id": eid,
            "kind": doc["kind"],
            "title": doc["title"],
            "severity": 2,
            "status": "verified",
            "location": doc["location"],
            "area": [],
            "source": f"citizen report {id}",
            "createdAt": time.time() * 1000,
            "assignedResponderIds": [],
        }
        store.put("events", eid, event)
        await broadcast("event:created", event)
    store.put("reports", id, doc)
    await broadcast("report:updated", doc)
    return doc


# ── Cases ─────────────────────────────────────────────────────────────────────

class CreateCase(BaseModel):
    name: str
    severity: int
    restricted: bool = False
    source: Optional[str] = None


class PatchCase(BaseModel):
    state: Optional[str] = None
    members: Optional[List[str]] = None


class PostChat(BaseModel):
    authorId: str
    authorName: str
    text: str
    isHost: bool = False


@app.get("/api/cases")
def list_cases():
    return store.list_all("cases")


@app.post("/api/cases", status_code=201)
async def create_case(body: CreateCase):
    cid = f"CASE-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "id": cid,
        "name": body.name,
        "severity": body.severity,
        "state": "forming",
        "members": [],
        "restricted": body.restricted,
        "source": body.source or "ops",
        "createdAt": time.time() * 1000,
    }
    store.put("cases", cid, doc)
    await broadcast("case:created", doc)
    return doc


@app.patch("/api/cases/{id}")
async def patch_case(id: str, body: PatchCase):
    doc = store.get("cases", id)
    if not doc:
        raise HTTPException(404)
    if body.state is not None:
        doc["state"] = body.state
    if body.members is not None:
        doc["members"] = body.members
    store.put("cases", id, doc)
    await broadcast("case:updated", doc)
    return doc


@app.post("/api/cases/{id}/chat")
async def post_chat(id: str, body: PostChat):
    case = store.get("cases", id)
    if not case:
        raise HTTPException(404)
    entry = {
        "id": f"MSG-{uuid.uuid4().hex[:8]}",
        "caseId": id,
        "authorId": body.authorId,
        "authorName": body.authorName,
        "text": body.text,
        "ts": time.time() * 1000,
        "isHost": body.isHost,
    }
    store.put("chat", entry["id"], entry)
    await broadcast("chat:message", entry)
    return entry


@app.get("/api/cases/{id}/chat")
def get_case_chat(id: str):
    all_chat = store.list_all("chat")
    return [m for m in all_chat if m.get("caseId") == id]


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8787))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
