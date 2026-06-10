"""
Redis-backed state store with in-memory fallback.
If Redis is not available, state lives in a plain dict (single-process only).
"""
from __future__ import annotations
import json
import os
from typing import Any, Dict, List, Optional

try:
    import redis
    _redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    _rc = redis.Redis.from_url(_redis_url, decode_responses=True)
    _rc.ping()
    REDIS_AVAILABLE = True
except Exception:
    _rc = None
    REDIS_AVAILABLE = False

_mem: Dict[str, Any] = {}


def _key(collection: str, id: str) -> str:
    return f"kk:{collection}:{id}"


def _idx_key(collection: str) -> str:
    return f"kk:idx:{collection}"


def get(collection: str, id: str) -> Optional[dict]:
    if REDIS_AVAILABLE:
        raw = _rc.get(_key(collection, id))
        return json.loads(raw) if raw else None
    return _mem.get(_key(collection, id))


def put(collection: str, id: str, doc: dict) -> None:
    if REDIS_AVAILABLE:
        _rc.set(_key(collection, id), json.dumps(doc))
        _rc.sadd(_idx_key(collection), id)
    else:
        _mem[_key(collection, id)] = doc
        _mem.setdefault(_idx_key(collection), set()).add(id)


def delete(collection: str, id: str) -> None:
    if REDIS_AVAILABLE:
        _rc.delete(_key(collection, id))
        _rc.srem(_idx_key(collection), id)
    else:
        _mem.pop(_key(collection, id), None)
        if _idx_key(collection) in _mem:
            _mem[_idx_key(collection)].discard(id)


def list_all(collection: str) -> List[dict]:
    if REDIS_AVAILABLE:
        ids = _rc.smembers(_idx_key(collection))
        if not ids:
            return []
        pipe = _rc.pipeline()
        for id in ids:
            pipe.get(_key(collection, id))
        return [json.loads(r) for r in pipe.execute() if r]
    idx = _mem.get(_idx_key(collection), set())
    return [_mem[_key(collection, i)] for i in idx if _key(collection, i) in _mem]


def clear_collection(collection: str) -> None:
    if REDIS_AVAILABLE:
        ids = _rc.smembers(_idx_key(collection))
        for id in ids:
            _rc.delete(_key(collection, id))
        _rc.delete(_idx_key(collection))
    else:
        idx = _mem.pop(_idx_key(collection), set())
        for id in idx:
            _mem.pop(_key(collection, id), None)


def is_seeded() -> bool:
    if REDIS_AVAILABLE:
        return _rc.exists("kk:seeded") == 1
    return _mem.get("kk:seeded", False)


def mark_seeded() -> None:
    if REDIS_AVAILABLE:
        _rc.set("kk:seeded", "1")
    else:
        _mem["kk:seeded"] = True
