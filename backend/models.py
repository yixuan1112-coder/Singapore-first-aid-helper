from __future__ import annotations
from typing import Literal, Optional, List
from pydantic import BaseModel


LngLat = dict  # {"lng": float, "lat": float}

SeverityLevel = Literal[1, 2, 3, 4, 5]
IncidentKind = Literal[
    "flood", "fire", "medical", "hazmat", "weather",
    "structural", "crowd", "security", "generic",
]
ResponderStatus = Literal["ready", "en_route", "on_scene", "out", "offline"]
SosStatus = Literal["requesting", "acknowledged", "en_route", "arrived", "resolved", "cancelled"]
ReportStatus = Literal["pending", "claimed", "verified", "dismissed"]
CaseState = Literal["forming", "staging", "active", "consolidating", "resolved", "archived"]


class Responder(BaseModel):
    id: str
    name: str
    org: str
    role: str
    status: ResponderStatus
    location: dict
    groups: List[str] = []
    unitType: Optional[str] = None
    skills: List[str] = []
    note: Optional[str] = None
    demo: Optional[bool] = None
    covert: Optional[bool] = None
    assignedSosId: Optional[str] = None
    assignedEventId: Optional[str] = None


class CanonicalEvent(BaseModel):
    id: str
    kind: IncidentKind
    title: str
    severity: SeverityLevel
    status: Literal["unverified", "verified", "resolved"]
    location: dict
    area: List[dict] = []
    source: Optional[str] = None
    createdAt: float
    resolvedAt: Optional[float] = None
    assignedResponderIds: List[str] = []


class DistressSession(BaseModel):
    id: str
    citizenName: str
    category: str
    location: dict
    status: SosStatus
    assignedResponderId: Optional[str] = None
    createdAt: float


class CitizenReport(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    location: dict
    status: ReportStatus
    reporterId: Optional[str] = None
    claimedBy: Optional[str] = None
    createdAt: float


class ChatEntry(BaseModel):
    id: str
    caseId: str
    authorId: str
    authorName: str
    text: str
    ts: float
    isHost: bool = False


class CaseRoom(BaseModel):
    id: str
    name: str
    severity: SeverityLevel
    state: CaseState
    members: List[str] = []
    restricted: bool = False
    source: Optional[str] = None
    createdAt: float


class AppState(BaseModel):
    responders: List[Responder] = []
    events: List[CanonicalEvent] = []
    sosSessions: List[DistressSession] = []
    reports: List[CitizenReport] = []
    cases: List[CaseRoom] = []
    chat: List[ChatEntry] = []
