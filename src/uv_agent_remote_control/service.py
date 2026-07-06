from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import queue
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import default as email_policy
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import parse_qs, urlsplit

SESSION_COOKIE = "uv_agent_remote_control_session"
SUPPORTED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


@dataclass(frozen=True)
class RemoteControlConfig:
    host: str = "0.0.0.0"
    port: int = 8788
    auth_mode: str = "auth-code"
    session_ttl_s: int = 43200
    max_attachments: int = 10
    max_file_bytes: int = 50 * 1024 * 1024
    max_message_bytes: int = 100 * 1024 * 1024
    sse_ring_max_events: int = 2000
    sse_ring_max_bytes: int = 16 * 1024 * 1024

    @classmethod
    def from_mapping(cls, value: dict[str, Any] | None) -> "RemoteControlConfig":
        data = dict(value or {})
        auth = data.get("auth") if isinstance(data.get("auth"), dict) else {}
        auth_mode = str(auth.get("mode", data.get("mode", "auth-code")) or "auth-code").strip().lower()
        if auth_mode not in {"auth-code", "none"}:
            raise ValueError("remote-control auth.mode must be 'auth-code' or 'none'")
        return cls(
            host=str(data.get("host") or "0.0.0.0").strip() or "0.0.0.0",
            port=_int_range(data.get("port", 8788), "port", minimum=0, maximum=65535),
            auth_mode=auth_mode,
            session_ttl_s=_int_range(data.get("session_ttl_s", 43200), "session_ttl_s", minimum=60, maximum=604800),
            max_attachments=_int_range(data.get("max_attachments", 10), "max_attachments", minimum=1, maximum=100),
            max_file_bytes=_int_range(data.get("max_file_bytes", 50 * 1024 * 1024), "max_file_bytes", minimum=1, maximum=500 * 1024 * 1024),
            max_message_bytes=_int_range(data.get("max_message_bytes", 100 * 1024 * 1024), "max_message_bytes", minimum=1, maximum=1024 * 1024 * 1024),
            sse_ring_max_events=_int_range(data.get("sse_ring_max_events", 2000), "sse_ring_max_events", minimum=100, maximum=100000),
            sse_ring_max_bytes=_int_range(data.get("sse_ring_max_bytes", 16 * 1024 * 1024), "sse_ring_max_bytes", minimum=1024 * 1024, maximum=512 * 1024 * 1024),
        )


class SessionStore:
    def __init__(self, *, ttl_s: int) -> None:
        self.ttl_s = ttl_s
        self._lock = threading.RLock()
        self._sessions: dict[str, float] = {}

    def create(self) -> str:
        session_id = secrets.token_urlsafe(32)
        now = time.time()
        with self._lock:
            self._prune_locked(now)
            self._sessions[session_id] = now + self.ttl_s
        return session_id

    def valid(self, session_id: str) -> bool:
        now = time.time()
        with self._lock:
            self._prune_locked(now)
            expires_at = self._sessions.get(session_id)
            return expires_at is not None and expires_at > now

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def _prune_locked(self, now: float) -> None:
        expired = [session_id for session_id, expires_at in self._sessions.items() if expires_at <= now]
        for session_id in expired:
            self._sessions.pop(session_id, None)


@dataclass(frozen=True)
class HubEvent:
    seq: int
    payload: dict[str, Any]
    size: int


class EventHub:
    def __init__(self, *, max_events: int, max_bytes: int) -> None:
        self.max_events = max_events
        self.max_bytes = max_bytes
        self._lock = threading.RLock()
        self._seq = 0
        self._bytes = 0
        self._ring: deque[HubEvent] = deque()
        self._subscribers: set[queue.Queue[HubEvent]] = set()

    @property
    def last_seq(self) -> int:
        with self._lock:
            return self._seq

    def publish(self, payload: dict[str, Any]) -> HubEvent:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8", errors="replace")
        with self._lock:
            self._seq += 1
            event = HubEvent(seq=self._seq, payload=payload, size=len(body))
            self._ring.append(event)
            self._bytes += event.size
            self._evict_locked()
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            _queue_put_latest(subscriber, event)
        return event

    def replay_after(self, seq: int) -> tuple[list[HubEvent], bool]:
        with self._lock:
            if not self._ring:
                return [], seq <= self._seq
            oldest = self._ring[0].seq
            if seq and seq < oldest - 1:
                return [], False
            return [event for event in self._ring if event.seq > seq], True

    def subscribe(self) -> queue.Queue[HubEvent]:
        subscriber: queue.Queue[HubEvent] = queue.Queue(maxsize=1000)
        with self._lock:
            self._subscribers.add(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: queue.Queue[HubEvent]) -> None:
        with self._lock:
            self._subscribers.discard(subscriber)

    def _evict_locked(self) -> None:
        while self._ring and (len(self._ring) > self.max_events or self._bytes > self.max_bytes):
            removed = self._ring.popleft()
            self._bytes -= removed.size


class RemoteControlService:
    def __init__(self, config: RemoteControlConfig, *, context, loop: asyncio.AbstractEventLoop, logger: logging.Logger | None = None) -> None:
        self.config = config
        self.context = context
        self.loop = loop
        self.logger = logger or logging.getLogger(__name__)
        self.sessions = SessionStore(ttl_s=config.session_ttl_s)
        self.events = EventHub(max_events=config.sse_ring_max_events, max_bytes=config.sse_ring_max_bytes)
        self._lock = threading.RLock()
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._url = ""
        self._unsubscribe = None

    @property
    def url(self) -> str:
        return self._url

    @property
    def port(self) -> int:
        with self._lock:
            if self._httpd is None:
                return self.config.port
            return int(self._httpd.server_address[1])

    def status(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "host": self.config.host,
            "port": self.port,
            "auth_mode": self.config.auth_mode,
            "last_seq": self.events.last_seq,
        }

    def capabilities(self) -> dict[str, Any]:
        has_threads = self.context.threads is not None
        can_submit = getattr(self.context, "can_submit_turn", None)
        has_submit = bool(can_submit) if can_submit is not None else callable(getattr(self.context, "start_turn", None))
        has_blobs = bool(getattr(self.context.blobs, "available", False))
        host = getattr(self.context, "host", None)
        core = self.core_summary()
        models = core.get("models") if isinstance(core.get("models"), dict) else {}
        pickers = core.get("pickers") if isinstance(core.get("pickers"), dict) else {}
        model_levels = models.get("levels") if isinstance(models.get("levels"), list) else []
        mcp = pickers.get("mcp") if isinstance(pickers.get("mcp"), dict) else {}
        skills = pickers.get("skills") if isinstance(pickers.get("skills"), dict) else {}
        return {
            "ok": True,
            "host": {
                "invocation": str(getattr(host, "invocation", "") or ""),
                "lifetime": str(getattr(host, "lifetime", "") or ""),
                "persistent": bool(getattr(host, "is_persistent", False)),
            },
            "limits": {
                "max_attachments": self.config.max_attachments,
                "max_file_bytes": self.config.max_file_bytes,
                "max_message_bytes": self.config.max_message_bytes,
                "sse_ring_max_events": self.config.sse_ring_max_events,
                "sse_ring_max_bytes": self.config.sse_ring_max_bytes,
            },
            "tui_features": [
                _feature("threads", "线程", "available" if has_threads else "unavailable", "最近任务、历史事件和标题管理"),
                _feature("transcript", "转录", "available" if has_threads else "unavailable", "用户、助手、工具、系统和附件事件"),
                _feature("composer", "输入框", "available" if has_submit else "unavailable", "多行输入、档位、冲突策略和提交"),
                _feature("attachments", "附件", "available" if has_blobs and has_submit else "unavailable", "图片上下文和文件素材"),
                _feature("status", "状态", "available", "连接状态、会话保护和远程入口"),
                _feature("models", "模型", _model_feature_status(core, model_levels), _model_feature_detail(core, model_levels)),
                _feature("mcp", "MCP", _picker_feature_status(core, mcp), _picker_feature_detail(core, mcp, label="MCP")),
                _feature("skills", "技能", _picker_feature_status(core, skills), _picker_feature_detail(core, skills, label="技能")),
            ],
            "core": core,
        }

    def core_summary(self) -> dict[str, Any]:
        agent = getattr(self.context, "agent", None)
        if agent is None:
            return {
                "agent_api": False,
                "models": {"available": False, "default_level": "", "levels": []},
                "pickers": {},
            }
        return {
            "agent_api": True,
            "models": _safe_call(getattr(agent, "model_levels", None), default={"available": False, "default_level": "", "levels": []}),
            "pickers": _safe_call(getattr(agent, "picker_summary", None), ["mcp", "skills"], limit=30, default={}),
        }

    def start(self) -> None:
        with self._lock:
            if self._httpd is not None:
                return
            if self.context.threads is None:
                raise RuntimeError("remote-control requires plugin thread access")
            if not self.context.blobs.available:
                raise RuntimeError("remote-control requires plugin blob access")
            handler = self._handler_class()
            httpd = ThreadingHTTPServer((self.config.host, self.config.port), handler)
            httpd.daemon_threads = True
            self._httpd = httpd
            host, port = httpd.server_address[:2]
            self._url = f"http://{_display_host(str(host))}:{port}"
            self._unsubscribe = self.context.events.subscribe("*", self._on_plugin_event, logger=self.logger)
            self._thread = threading.Thread(target=httpd.serve_forever, name="uv-agent-remote-control-http", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        with self._lock:
            httpd = self._httpd
            thread = self._thread
            unsubscribe = self._unsubscribe
            self._httpd = None
            self._thread = None
            self._unsubscribe = None
            self._url = ""
        if unsubscribe is not None:
            unsubscribe()
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)

    def _on_plugin_event(self, event: dict[str, Any]) -> None:
        event_type = str(event.get("type") or "")
        if event_type == "thread.event_stored":
            stored = event.get("event") if isinstance(event.get("event"), dict) else {}
            self.events.publish(
                {
                    "kind": "stored_event",
                    "thread_id": event.get("thread_id") or stored.get("thread_id"),
                    "event": stored,
                }
            )
            return
        if event_type.startswith("plugin."):
            return
        self.events.publish({"kind": "live_event", "thread_id": event.get("thread_id"), "event": dict(event)})

    def _run_async(self, coro, *, timeout: float = 30.0) -> Any:
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return future.result(timeout=timeout)

    def _submit_turn(self, payload: dict[str, Any], files: dict[str, dict[str, Any]]) -> dict[str, Any]:
        text = str(payload.get("text") or "")
        if not text.strip():
            raise ValueError("message text is required")
        attachments_meta = payload.get("attachments") or []
        if not isinstance(attachments_meta, list):
            raise ValueError("attachments must be a list")
        if len(attachments_meta) > self.config.max_attachments:
            raise ValueError(f"too many attachments: {len(attachments_meta)}")
        total_bytes = sum(len(item["data"]) for item in files.values())
        if total_bytes > self.config.max_message_bytes:
            raise ValueError("message attachments are too large")

        thread_id = str(payload.get("thread_id") or "").strip()
        title = str(payload.get("title") or "").strip()
        if not thread_id:
            thread_id = self.context.threads.create_thread(title or _title_from_text(text))
        else:
            self.context.threads.metadata(thread_id)

        turn_attachments = self._prepare_attachments(text, attachments_meta, files)
        handle = self._run_async(
            self.context.start_turn(
                text=text,
                thread_id=thread_id,
                level=str(payload.get("level") or "") or None,
                attachments=turn_attachments,
                conflict=str(payload.get("conflict") or "queue"),
            ),
            timeout=10.0,
        )
        request_id = str(getattr(handle, "request_id", "") or "")
        self.events.publish(
            {
                "kind": "turn_submitted",
                "thread_id": thread_id,
                "request_id": request_id,
                "status": str(getattr(handle, "status", "queued")),
            }
        )
        return {"ok": True, "thread_id": thread_id, "request_id": request_id, "status": str(getattr(handle, "status", "queued"))}

    def _prepare_attachments(self, text: str, attachments_meta: list[Any], files: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        for index, raw in enumerate(attachments_meta):
            if not isinstance(raw, dict):
                raise ValueError("attachment metadata must be an object")
            part_name = str(raw.get("part") or raw.get("part_name") or f"file_{index}")
            file_item = files.get(part_name)
            if file_item is None:
                raise ValueError(f"missing attachment file part: {part_name}")
            data = file_item["data"]
            if len(data) > self.config.max_file_bytes:
                raise ValueError(f"attachment is too large: {file_item['filename']}")
            filename = _safe_filename(str(raw.get("filename") or file_item["filename"] or f"attachment-{index + 1}"))
            mime_type = str(raw.get("mime_type") or file_item["mime_type"] or "application/octet-stream")
            kind = str(raw.get("kind") or ("image" if mime_type in SUPPORTED_IMAGE_MIME_TYPES else "file")).lower()
            token = str(raw.get("token") or "")
            if _unquoted_token_count(text, token) != 1:
                raise ValueError(f"attachment token must appear exactly once outside quotes: {token!r}")
            if kind == "image":
                if mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
                    raise ValueError(f"unsupported image attachment type: {mime_type}")
                slot = int(raw.get("slot") or _image_slot_from_token(token) or 0)
                if slot <= 0 or token != f"[Image #{slot}]":
                    raise ValueError(f"invalid image token: {token!r}")
            elif kind == "file":
                if not token.startswith("[File ") or not token.endswith("]") or " id=" in token:
                    raise ValueError(f"invalid file token: {token!r}")
                slot = None
            else:
                raise ValueError(f"unsupported attachment kind: {kind}")
            ref = self.context.blobs.put_bytes(data, mime_type=mime_type, filename=filename, max_bytes=self.config.max_file_bytes)
            item = {
                "kind": kind,
                "token": token,
                "blob_id": ref["blob_id"],
                "filename": filename,
                "mime_type": mime_type,
            }
            if slot is not None:
                item["slot"] = slot
            prepared.append(item)
        return prepared

    def _verify_auth_code(self, code: str) -> dict[str, Any]:
        return self._run_async(self.context.actions.call("auth_code.verify", {"code": code}), timeout=10.0)

    def _handler_class(self) -> type[BaseHTTPRequestHandler]:
        service = self

        class RemoteControlRequestHandler(BaseHTTPRequestHandler):
            server_version = "UvAgentRemoteControl/1"

            def do_GET(self) -> None:  # noqa: N802
                self._guard(self._handle_get)

            def do_POST(self) -> None:  # noqa: N802
                self._guard(self._handle_post)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _guard(self, handler) -> None:
                try:
                    handler()
                except ConnectionError:
                    return
                except ValueError as exc:
                    self._send_json({"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                except FileNotFoundError as exc:
                    self._send_json({"ok": False, "error": str(exc)}, status=HTTPStatus.NOT_FOUND)
                except LookupError as exc:
                    self._send_json({"ok": False, "error": str(exc)}, status=HTTPStatus.SERVICE_UNAVAILABLE)
                except TimeoutError:
                    self._send_json({"ok": False, "error": "operation timed out"}, status=HTTPStatus.GATEWAY_TIMEOUT)
                except Exception as exc:
                    service.logger.exception("Remote control request failed")
                    self._send_json({"ok": False, "error": str(exc) or repr(exc), "error_type": exc.__class__.__name__}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

            def _handle_get(self) -> None:
                parsed = urlsplit(self.path)
                if parsed.path == "/healthz":
                    self._send_bytes(HTTPStatus.OK, b"ok\n", content_type="text/plain; charset=utf-8")
                    return
                if parsed.path == "/api/auth/status":
                    self._send_json({"ok": True, "auth_mode": service.config.auth_mode, "authenticated": self._authenticated()})
                    return
                if parsed.path.startswith("/api/"):
                    if not self._require_auth():
                        return
                    if parsed.path == "/api/config":
                        self._send_json({"ok": True, **service.status(), "project": self._project_info()})
                        return
                    if parsed.path == "/api/capabilities":
                        self._send_json(service.capabilities())
                        return
                    if parsed.path == "/api/environment":
                        self._send_json({"ok": True, "core": service.core_summary(), "remote": service.status(), "project": self._project_info()})
                        return
                    if parsed.path == "/api/threads":
                        self._send_json({"ok": True, "project": self._project_info(), "threads": service.context.threads.list_threads()})
                        return
                    if parsed.path == "/api/events":
                        self._handle_sse(parsed)
                        return
                    thread_id, suffix = _thread_route(parsed.path)
                    if thread_id and suffix == "":
                        page = service.context.threads.event_page(thread_id, after_event_id=0, limit=_query_int(parsed.query, "limit", 500))
                        self._send_json({"ok": True, "thread": service.context.threads.metadata(thread_id), **page})
                        return
                    if thread_id and suffix == "/events":
                        params = parse_qs(parsed.query, keep_blank_values=True)
                        limit = _query_int(parsed.query, "limit", 200)
                        after = _optional_int(params.get("after", [""])[0])
                        before = _optional_int(params.get("before", [""])[0])
                        page = service.context.threads.event_page(thread_id, after_event_id=after, before_event_id=before, limit=limit)
                        self._send_json({"ok": True, **page})
                        return
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                self._send_static(parsed.path)

            def _handle_post(self) -> None:
                parsed = urlsplit(self.path)
                if parsed.path == "/api/auth/verify":
                    payload = self._read_json()
                    result = service._verify_auth_code(str(payload.get("code") or ""))
                    if not result.get("ok") or not result.get("verified"):
                        self._send_json({"ok": False, "verified": False, "reason": result.get("reason") or "invalid"}, status=HTTPStatus.UNAUTHORIZED)
                        return
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Set-Cookie", f"{SESSION_COOKIE}={service.sessions.create()}; HttpOnly; SameSite=Lax; Path=/; Max-Age={service.config.session_ttl_s}")
                    body = json.dumps({"ok": True, "verified": True}, separators=(",", ":")).encode("utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if not self._require_auth():
                    return
                if parsed.path == "/api/auth/logout":
                    self._logout()
                    return
                if parsed.path == "/api/threads":
                    payload = self._read_json()
                    title = str(payload.get("title") or "New thread")
                    thread_id = service.context.threads.create_thread(title)
                    self._send_json({"ok": True, "thread_id": thread_id, "thread": service.context.threads.metadata(thread_id)})
                    return
                if parsed.path == "/api/turns":
                    payload, files = self._read_payload_and_files()
                    self._send_json(service._submit_turn(payload, files))
                    return
                thread_id, suffix = _thread_route(parsed.path)
                if thread_id and suffix == "/submit":
                    payload, files = self._read_payload_and_files()
                    payload["thread_id"] = thread_id
                    self._send_json(service._submit_turn(payload, files))
                    return
                if thread_id and suffix == "/title":
                    payload = self._read_json()
                    title = str(payload.get("title") or "").strip()
                    if not title:
                        raise ValueError("title is required")
                    service.context.threads.update_title(thread_id, title, source="remote-control")
                    self._send_json({"ok": True})
                    return
                self.send_error(HTTPStatus.NOT_FOUND)

            def _authenticated(self) -> bool:
                if service.config.auth_mode == "none":
                    return True
                cookie = SimpleCookie()
                cookie.load(str(self.headers.get("Cookie") or ""))
                morsel = cookie.get(SESSION_COOKIE)
                return morsel is not None and service.sessions.valid(morsel.value)

            def _require_auth(self) -> bool:
                if self._authenticated():
                    return True
                self._send_json({"ok": False, "error": "unauthorized"}, status=HTTPStatus.UNAUTHORIZED)
                return False

            def _logout(self) -> None:
                cookie = SimpleCookie()
                cookie.load(str(self.headers.get("Cookie") or ""))
                morsel = cookie.get(SESSION_COOKIE)
                if morsel is not None:
                    service.sessions.delete(morsel.value)
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
                body = b'{"ok":true}'
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _handle_sse(self, parsed) -> None:
                params = parse_qs(parsed.query, keep_blank_values=True)
                after = _optional_int(params.get("after", [""])[0])
                if after is None:
                    after = _optional_int(str(self.headers.get("Last-Event-ID") or ""))
                after = after or 0
                replay, ok = service.events.replay_after(after)
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                if not ok:
                    self._write_sse(service.events.last_seq, {"kind": "sync_required", "reason": "event_cache_evicted"})
                for item in replay:
                    self._write_sse(item.seq, item.payload)
                subscriber = service.events.subscribe()
                try:
                    while True:
                        try:
                            item = subscriber.get(timeout=15.0)
                        except queue.Empty:
                            try:
                                self.wfile.write(b": heartbeat\n\n")
                                self.wfile.flush()
                            except ConnectionError:
                                return
                            continue
                        try:
                            self._write_sse(item.seq, item.payload)
                        except ConnectionError:
                            return
                finally:
                    service.events.unsubscribe(subscriber)

            def _write_sse(self, seq: int, payload: dict[str, Any]) -> None:
                body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                self.wfile.write(f"id: {seq}\n".encode("utf-8"))
                self.wfile.write(b"event: message\n")
                for line in body.splitlines() or [""]:
                    self.wfile.write(f"data: {line}\n".encode("utf-8"))
                self.wfile.write(b"\n")
                self.wfile.flush()

            def _read_payload_and_files(self) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
                content_type = str(self.headers.get("Content-Type") or "")
                if content_type.startswith("multipart/form-data"):
                    return _parse_multipart(self.rfile.read(_content_length(self)), content_type)
                return self._read_json(), {}

            def _read_json(self) -> dict[str, Any]:
                body = self.rfile.read(_content_length(self))
                if not body:
                    return {}
                value = json.loads(body.decode("utf-8"))
                if not isinstance(value, dict):
                    raise ValueError("JSON body must be an object")
                return value

            def _project_info(self) -> dict[str, str]:
                root = service.context.project_root
                return {"name": root.name or "project", "path": str(root)}

            def _send_static(self, path: str) -> None:
                request_path = urlsplit(path).path
                safe = PurePosixPath(request_path.lstrip("/"))
                if request_path in {"", "/", "/remote"}:
                    parts = ("index.html",)
                else:
                    parts = safe.parts
                if any(part in {"", ".", ".."} for part in parts):
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                if len(parts) == 1 and parts[0] in {"index.html", "app.js", "styles.css"}:
                    resource = resources.files("uv_agent_remote_control") / "web" / parts[0]
                elif len(parts) == 2 and parts[0] == "chunks" and parts[1].endswith(".js"):
                    resource = resources.files("uv_agent_remote_control") / "web" / "chunks" / parts[1]
                else:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                data = resource.read_bytes()
                name = parts[-1]
                content_type = {
                    "index.html": "text/html; charset=utf-8",
                    "app.js": "application/javascript; charset=utf-8",
                    "styles.css": "text/css; charset=utf-8",
                }.get(name, "application/javascript; charset=utf-8")
                self._send_bytes(HTTPStatus.OK, data, content_type=content_type)

            def _send_json(self, payload: dict[str, Any], *, status: HTTPStatus = HTTPStatus.OK) -> None:
                body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                self._send_bytes(status, body, content_type="application/json; charset=utf-8")

            def _send_bytes(self, status: HTTPStatus, body: bytes, *, content_type: str) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "no-cache")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        return RemoteControlRequestHandler


def _parse_multipart(body: bytes, content_type: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    raw = b"Content-Type: " + content_type.encode("utf-8") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    message = BytesParser(policy=email_policy).parsebytes(raw)
    payload: dict[str, Any] = {}
    files: dict[str, dict[str, Any]] = {}
    for part in message.iter_parts():
        disposition = part.get("Content-Disposition", "")
        if "form-data" not in disposition:
            continue
        params = dict(part.get_params(header="content-disposition") or [])
        name = str(params.get("name") or "")
        filename = str(params.get("filename") or "")
        data = part.get_payload(decode=True) or b""
        if name == "payload":
            payload = json.loads(data.decode(part.get_content_charset() or "utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("payload must be an object")
            continue
        if not name:
            continue
        mime_type = part.get_content_type() or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        files[name] = {"filename": filename, "mime_type": mime_type, "data": data}
    return payload, files


def _thread_route(path: str) -> tuple[str | None, str]:
    prefix = "/api/threads/"
    if not path.startswith(prefix):
        return None, ""
    rest = path[len(prefix) :]
    thread_id, separator, suffix = rest.partition("/")
    return thread_id, f"/{suffix}" if separator else ""


def _queue_put_latest(target: queue.Queue[HubEvent], event: HubEvent) -> None:
    try:
        target.put_nowait(event)
        return
    except queue.Full:
        try:
            target.get_nowait()
        except queue.Empty:
            pass
    try:
        target.put_nowait(event)
    except queue.Full:
        pass


def _content_length(handler: BaseHTTPRequestHandler) -> int:
    return max(0, int(handler.headers.get("Content-Length") or 0))


def _query_int(query: str, name: str, default_value: int) -> int:
    values = parse_qs(query, keep_blank_values=True).get(name)
    if not values:
        return default_value
    value = _optional_int(values[0])
    return value if value is not None else default_value


def _optional_int(value: Any) -> int | None:
    try:
        text = str(value or "").strip()
        return int(text) if text else None
    except (TypeError, ValueError):
        return None


def _int_range(value: Any, label: str, *, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"remote-control config {label} must be an integer") from exc
    if number < minimum or number > maximum:
        raise ValueError(f"remote-control config {label} must be between {minimum} and {maximum}")
    return number


def _display_host(host: str) -> str:
    if host in {"0.0.0.0", "::"}:
        return "127.0.0.1"
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


def _feature(feature_id: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"id": feature_id, "label": label, "status": status, "detail": detail}


def _safe_call(fn, *args, default=None, **kwargs):
    if not callable(fn):
        return default
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        return {"available": False, "error_type": exc.__class__.__name__, "message": str(exc) or repr(exc)}


def _model_feature_status(core: dict[str, Any], levels: list[Any]) -> str:
    models = core.get("models") if isinstance(core.get("models"), dict) else {}
    if not core.get("agent_api"):
        return "unavailable"
    if levels:
        return "available"
    if models.get("available"):
        return "available"
    return "unavailable"


def _model_feature_detail(core: dict[str, Any], levels: list[Any]) -> str:
    if not core.get("agent_api"):
        return "Core 未提供模型档位摘要"
    default_level = ""
    models = core.get("models") if isinstance(core.get("models"), dict) else {}
    if isinstance(models, dict):
        default_level = str(models.get("default_level") or "")
    if levels:
        suffix = f"，默认 {default_level}" if default_level else ""
        return f"已同步 {len(levels)} 个模型档位{suffix}"
    return "Core 已接入，当前没有可展示档位"


def _picker_feature_status(core: dict[str, Any], picker: dict[str, Any]) -> str:
    if not core.get("agent_api"):
        return "unavailable"
    if picker.get("available"):
        return "available"
    return "unavailable"


def _picker_feature_detail(core: dict[str, Any], picker: dict[str, Any], *, label: str) -> str:
    if not core.get("agent_api"):
        return f"Core 未提供 {label} 摘要"
    if picker.get("available"):
        total = int(picker.get("total") or len(picker.get("items") or []))
        return f"{label} 插入源已接入，{total} 个条目"
    return f"{label} 插入源未注册或未启用"


def _title_from_text(text: str) -> str:
    compact = " ".join(text.strip().split())
    return compact[:48] or "New thread"


def _safe_filename(value: str) -> str:
    name = value.replace("\\", "/").rsplit("/", 1)[-1].strip()
    return name[:160] or "attachment"


def _image_slot_from_token(token: str) -> int | None:
    if not token.startswith("[Image #") or not token.endswith("]"):
        return None
    return _optional_int(token[len("[Image #") : -1])


def _unquoted_token_count(text: str, token: str) -> int:
    if not token:
        return 0
    count = 0
    start = 0
    while True:
        index = text.find(token, start)
        if index < 0:
            return count
        end = index + len(token)
        if not _is_immediately_quoted(text, index, end):
            count += 1
        start = end


def _is_immediately_quoted(text: str, start: int, end: int) -> bool:
    if start <= 0 or end >= len(text):
        return False
    return (text[start - 1], text[end]) in {('"', '"'), ("'", "'"), ("“", "”"), ("‘", "’")}
