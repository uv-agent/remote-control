from __future__ import annotations

from typing import Any

from uv_agent.plugins import PluginManifest, SetupPlugin

from .service import RemoteControlConfig, RemoteControlService

MANIFEST = PluginManifest(
    id="remote-control",
    version="0.1.0",
    display_name={"en": "Remote Control", "zh": "远程控制"},
    description={
        "en": "Starts a daemon-only web panel for remote uv-agent control.",
        "zh": "启动 daemon 专用的 uv-agent 远程控制 Web 面板。",
    },
    capabilities=("action", "http_server"),
    activation="persistent_only",
    priority=200,
    optional_dependencies=("auth-code",),
    config_schema={
        "type": "object",
        "properties": {
            "host": {"type": "string", "default": "0.0.0.0"},
            "port": {"type": "integer", "minimum": 0, "maximum": 65535, "default": 8788},
            "auth": {
                "type": "object",
                "properties": {
                    "mode": {"type": "string", "enum": ["auth-code", "none"], "default": "auth-code"}
                },
            },
            "session_ttl_s": {"type": "integer", "minimum": 60, "default": 43200},
            "max_attachments": {"type": "integer", "minimum": 1, "default": 10},
            "max_file_bytes": {"type": "integer", "minimum": 1, "default": 52428800},
            "max_message_bytes": {"type": "integer", "minimum": 1, "default": 104857600},
            "sse_ring_max_events": {"type": "integer", "minimum": 100, "default": 2000},
            "sse_ring_max_bytes": {"type": "integer", "minimum": 1048576, "default": 16777216},
        },
    },
)

_SERVICES: dict[int, RemoteControlService] = {}


def plugin() -> SetupPlugin:
    return SetupPlugin(manifest=MANIFEST, setup=setup, stop=stop)


def setup(context) -> None:
    import asyncio

    if not context.host.is_persistent:
        raise RuntimeError("remote-control can only run in a persistent daemon host")
    config = RemoteControlConfig.from_mapping(context.config)
    if config.auth_mode == "auth-code" and not context.actions.resolve("auth_code.verify").get("found"):
        raise RuntimeError(
            "remote-control auth.mode='auth-code' requires the auth-code plugin action auth_code.verify; "
            "set auth.mode='none' only if you provide your own port protection"
        )
    if config.auth_mode == "none":
        context.logger.warning("remote-control auth is explicitly disabled; protect the exposed port yourself")
    loop = asyncio.get_running_loop()
    service = RemoteControlService(config, context=context, loop=loop, logger=context.logger)
    service.start()
    _SERVICES[id(context)] = service

    def status_action(_payload: dict[str, Any], context=None) -> dict[str, Any]:
        service_for_context = _SERVICES.get(id(context)) if context is not None else service
        if service_for_context is None:
            return {"ok": False, "running": False}
        return {"ok": True, "running": True, **service_for_context.status()}

    try:
        context.actions.register(
            "remote_control.status",
            status_action,
            doc="Return the remote-control web server status.",
            schema={"type": "object"},
        )
    except Exception:
        _SERVICES.pop(id(context), None)
        service.stop()
        raise
    context.logger.info("Remote control server started bind=%s:%s url=%s", config.host, service.port, service.url)


def stop(context) -> None:
    service = _SERVICES.pop(id(context), None)
    if service is not None:
        service.stop()
