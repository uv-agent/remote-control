from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class WebBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if os.environ.get("UV_AGENT_REMOTE_CONTROL_SKIP_WEB_BUILD") == "1":
            return

        root = Path(self.root)
        npm = shutil.which("npm")
        if npm is None:
            raise RuntimeError("npm is required to build uv-agent-remote-control web assets")

        node_modules = root / "node_modules"
        if not node_modules.exists() or not (node_modules / "misans").exists():
            subprocess.run([npm, "ci"], cwd=root, check=True)
        subprocess.run([npm, "run", "web:build"], cwd=root, check=True)


def get_build_hook() -> type[WebBuildHook]:
    return WebBuildHook
