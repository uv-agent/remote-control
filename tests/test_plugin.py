from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

import pytest
from uv_agent.plugins import SetupPlugin

from uv_agent_remote_control import MANIFEST, _SERVICES, plugin, setup, stop
from uv_agent_remote_control.service import EventHub, RemoteControlConfig, RemoteControlService

REQUEST_TIMEOUT_S = 5


class EventRecorder:
    def __init__(self) -> None:
        self.subscriptions = []

    def subscribe(self, kinds, handler, *, logger=None, thread_id=None, turn_id=None):
        self.subscriptions.append(handler)

        def unsubscribe() -> None:
            try:
                self.subscriptions.remove(handler)
            except ValueError:
                pass

        return unsubscribe


class ActionCaller:
    def __init__(self, *, found: bool = True) -> None:
        self.calls = []
        self.result = {"ok": True, "verified": True}
        self.found = found
        self.registered = {}

    def resolve(self, action_id):
        return {"found": self.found, "action_id": action_id}

    def register(self, action_id, handler, *, doc="", schema=None):
        self.registered[action_id] = {"handler": handler, "doc": doc, "schema": schema or {}}
        return self.registered[action_id]

    async def call(self, action_id, payload, **_kwargs):
        self.calls.append((action_id, payload))
        return self.result


class BlobRecorder:
    def __init__(self) -> None:
        self.items = []

    @property
    def available(self) -> bool:
        return True

    def put_bytes(self, data, *, mime_type="application/octet-stream", filename="", max_bytes=None):
        assert max_bytes is None or len(data) <= max_bytes
        blob_id = f"blob:sha256:{len(self.items) + 1}"
        self.items.append({"data": data, "mime_type": mime_type, "filename": filename, "blob_id": blob_id})
        return {"blob_id": blob_id, "mime_type": mime_type, "filename": filename, "size_bytes": len(data)}


class ThreadRecorder:
    def __init__(self) -> None:
        self.threads = [{"thread_id": "thr_1", "title": "First", "kind": "thread", "turn_count": 0}]
        self.pages = {"thr_1": []}

    def create_thread(self, title):
        thread_id = f"thr_{len(self.threads) + 1}"
        self.threads.append({"thread_id": thread_id, "title": title, "kind": "thread", "turn_count": 0})
        self.pages[thread_id] = []
        return thread_id

    def metadata(self, thread_id):
        for thread in self.threads:
            if thread["thread_id"] == thread_id:
                return dict(thread)
        raise FileNotFoundError(thread_id)

    def list_threads(self):
        return [dict(thread) for thread in self.threads]

    def event_page(self, thread_id, **_kwargs):
        return {"events": list(self.pages.get(thread_id, [])), "has_more": False}

    def update_title(self, thread_id, title, *, source="plugin"):
        self.metadata(thread_id)
        for thread in self.threads:
            if thread["thread_id"] == thread_id:
                thread["title"] = title


@dataclass
class FakeHandle:
    request_id: str
    thread_id: str
    status: str = "queued"

    def __post_init__(self) -> None:
        self.cancel_event = asyncio.Event()

    async def wait(self):
        return self


class LoopThread:
    def __enter__(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        return self.loop

    def __exit__(self, *_exc):
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(timeout=2)
        self.loop.close()


def make_context(tmp_path: Path):
    start_calls = []

    async def start_turn(**kwargs):
        start_calls.append(dict(kwargs))
        return FakeHandle(request_id=f"req_{len(start_calls)}", thread_id=kwargs["thread_id"])

    context = SimpleNamespace(
        config={},
        host=SimpleNamespace(invocation="daemon", lifetime="persistent", is_persistent=True),
        logger=logging.getLogger("test.remote-control"),
        events=EventRecorder(),
        actions=ActionCaller(),
        blobs=BlobRecorder(),
        threads=ThreadRecorder(),
        project_root=tmp_path,
        start_turn=start_turn,
    )
    context.start_calls = start_calls
    return context


def make_setup_context(tmp_path: Path, *, config=None, action_found=True):
    context = make_context(tmp_path)
    context.config = dict(config or {})
    context.actions = ActionCaller(found=action_found)
    return context


def loopback_config(**kwargs) -> RemoteControlConfig:
    return RemoteControlConfig(host="127.0.0.1", port=0, **kwargs)


def test_plugin_entrypoint_manifest() -> None:
    loaded = plugin()

    assert isinstance(loaded, SetupPlugin)
    assert loaded.manifest is MANIFEST
    assert loaded.manifest.id == "remote-control"
    assert loaded.manifest.activation == "persistent_only"
    assert loaded.manifest.priority == 200
    assert loaded.manifest.optional_dependencies == ("auth-code",)


def test_config_defaults_to_auth_code_and_requires_explicit_none() -> None:
    assert RemoteControlConfig.from_mapping({}).auth_mode == "auth-code"
    assert RemoteControlConfig.from_mapping({"auth": {"mode": "none"}}).auth_mode == "none"

    with pytest.raises(ValueError, match="auth.mode"):
        RemoteControlConfig.from_mapping({"auth": {"mode": "invalid"}})


def test_setup_requires_auth_code_action_by_default(tmp_path: Path) -> None:
    context = make_setup_context(tmp_path, config={"host": "127.0.0.1", "port": 0}, action_found=False)

    with pytest.raises(RuntimeError, match="auth_code.verify"):
        setup(context)

    assert id(context) not in _SERVICES


def test_setup_auth_none_does_not_require_auth_code_action(tmp_path: Path) -> None:
    context = make_setup_context(
        tmp_path,
        config={"host": "127.0.0.1", "port": 0, "auth": {"mode": "none"}},
        action_found=False,
    )

    async def run() -> None:
        setup(context)
        try:
            assert id(context) in _SERVICES
            assert "remote_control.status" in context.actions.registered
        finally:
            stop(context)

    asyncio.run(run())


def test_event_hub_replay_reports_evicted_gap() -> None:
    hub = EventHub(max_events=2, max_bytes=1024 * 1024)
    hub.publish({"n": 1})
    hub.publish({"n": 2})
    hub.publish({"n": 3})
    hub.publish({"n": 4})

    replay, ok = hub.replay_after(1)
    assert replay == []
    assert ok is False
    replay, ok = hub.replay_after(2)
    assert [event.payload["n"] for event in replay] == [3, 4]
    assert ok is True


def test_service_auth_none_serves_threads(tmp_path: Path) -> None:
    context = make_context(tmp_path)
    with LoopThread() as loop:
        service = RemoteControlService(loopback_config(auth_mode="none"), context=context, loop=loop)
        service.start()
        try:
            status = read_json(f"{service.url}/api/auth/status")
            threads = read_json(f"{service.url}/api/threads")

            assert status["authenticated"] is True
            assert threads["threads"][0]["thread_id"] == "thr_1"
        finally:
            service.stop()


def test_service_serves_vite_chunk_assets(tmp_path: Path) -> None:
    context = make_context(tmp_path)
    with LoopThread() as loop:
        service = RemoteControlService(loopback_config(auth_mode="none"), context=context, loop=loop)
        service.start()
        try:
            index = urlopen(f"{service.url}/", timeout=REQUEST_TIMEOUT_S).read().decode("utf-8")
            match = re.search(r'href="/(chunks/[^"]+\.js)"', index)
            assert match is not None

            response = urlopen(f"{service.url}/{match.group(1)}", timeout=REQUEST_TIMEOUT_S)
            assert response.headers.get_content_type() == "application/javascript"
            assert response.read(32)
        finally:
            service.stop()


def test_service_capabilities_reports_tui_coverage(tmp_path: Path) -> None:
    context = make_context(tmp_path)
    with LoopThread() as loop:
        service = RemoteControlService(loopback_config(auth_mode="none"), context=context, loop=loop)
        service.start()
        try:
            capabilities = read_json(f"{service.url}/api/capabilities")

            assert capabilities["host"]["persistent"] is True
            assert capabilities["limits"]["max_attachments"] == 10
            by_id = {item["id"]: item for item in capabilities["tui_features"]}
            assert by_id["threads"]["status"] == "available"
            assert by_id["composer"]["status"] == "available"
            assert by_id["models"]["status"] == "needs_core_api"
            assert by_id["mcp"]["status"] == "needs_core_api"
        finally:
            service.stop()


def test_service_capabilities_uses_core_agent_summary(tmp_path: Path) -> None:
    context = make_context(tmp_path)
    context.agent = SimpleNamespace(
        model_levels=lambda: {
            "available": True,
            "default_level": "medium",
            "levels": [{"id": "medium", "model": "gpt-5", "provider": "openai"}],
        },
        picker_summary=lambda picker_ids, **_kwargs: {
            "mcp": {"available": True, "items": [{"value": "@mcp:demo"}], "total": 1},
            "skills": {"available": True, "items": [{"value": "@skill://user/demo"}], "total": 1},
        },
    )
    with LoopThread() as loop:
        service = RemoteControlService(loopback_config(auth_mode="none"), context=context, loop=loop)
        service.start()
        try:
            capabilities = read_json(f"{service.url}/api/capabilities")

            by_id = {item["id"]: item for item in capabilities["tui_features"]}
            assert by_id["models"]["status"] == "available"
            assert by_id["mcp"]["status"] == "available"
            assert by_id["skills"]["status"] == "available"
            assert capabilities["core"]["models"]["levels"][0]["model"] == "gpt-5"
        finally:
            service.stop()


def test_service_auth_code_sets_session_cookie(tmp_path: Path) -> None:
    context = make_context(tmp_path)
    with LoopThread() as loop:
        service = RemoteControlService(loopback_config(auth_mode="auth-code"), context=context, loop=loop)
        service.start()
        opener = build_opener(HTTPCookieProcessor())
        try:
            with pytest.raises(HTTPError) as unauthorized:
                opener.open(f"{service.url}/api/threads", timeout=REQUEST_TIMEOUT_S)
            assert unauthorized.value.code == 401

            response = opener.open(
                Request(
                    f"{service.url}/api/auth/verify",
                    data=json.dumps({"code": "A7K2Q9"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                ),
                timeout=REQUEST_TIMEOUT_S,
            )
            assert json.loads(response.read().decode("utf-8"))["verified"] is True
            threads = json.loads(opener.open(f"{service.url}/api/threads", timeout=REQUEST_TIMEOUT_S).read().decode("utf-8"))

            assert context.actions.calls == [("auth_code.verify", {"code": "A7K2Q9"})]
            assert threads["threads"][0]["thread_id"] == "thr_1"
        finally:
            service.stop()


def test_service_submit_multipart_uploads_attachments_and_starts_turn(tmp_path: Path) -> None:
    context = make_context(tmp_path)
    payload = {
        "thread_id": "thr_1",
        "text": "read [File report.txt] and inspect [Image #1]",
        "attachments": [
            {
                "part": "file_0",
                "kind": "file",
                "token": "[File report.txt]",
                "filename": "report.txt",
                "mime_type": "text/plain",
            },
            {
                "part": "file_1",
                "kind": "image",
                "token": "[Image #1]",
                "slot": 1,
                "filename": "clip.png",
                "mime_type": "image/png",
            },
        ],
    }
    body, content_type = multipart(
        {"payload": json.dumps(payload)},
        {
            "file_0": ("report.txt", "text/plain", b"hello"),
            "file_1": ("clip.png", "image/png", b"\x89PNG\r\n\x1a\n"),
        },
    )

    with LoopThread() as loop:
        service = RemoteControlService(loopback_config(auth_mode="none"), context=context, loop=loop)
        service.start()
        try:
            result = read_json(
                f"{service.url}/api/turns",
                data=body,
                headers={"Content-Type": content_type},
                method="POST",
            )

            assert result["ok"] is True
            assert result["request_id"] == "req_1"
            assert [item["filename"] for item in context.blobs.items] == ["report.txt", "clip.png"]
            call = context.start_calls[0]
            assert call["thread_id"] == "thr_1"
            assert call["text"] == payload["text"]
            assert call["attachments"][0]["blob_id"] == "blob:sha256:1"
            assert call["attachments"][1]["slot"] == 1
        finally:
            service.stop()


def read_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None, method: str = "GET"):
    response = urlopen(Request(url, data=data, headers=headers or {}, method=method), timeout=REQUEST_TIMEOUT_S)
    return json.loads(response.read().decode("utf-8"))


def multipart(fields: dict[str, str], files: dict[str, tuple[str, str, bytes]]) -> tuple[bytes, str]:
    boundary = "----uv-agent-remote-control-test"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    for name, (filename, mime_type, data) in files.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8"),
                f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"),
                data,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"
