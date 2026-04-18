"""Shared helper: run a legacy sync_*.py main() with spoofed argv + env."""

import importlib
import os
import sys
from contextlib import contextmanager
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


@contextmanager
def _patched_env(env: dict[str, str], argv: list[str]):
    old_env = {k: os.environ.get(k) for k in env}
    old_argv = sys.argv
    os.environ.update({k: v for k, v in env.items() if v is not None})
    sys.argv = argv
    try:
        yield
    finally:
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        sys.argv = old_argv


def run_script_main(module_name: str, env: dict[str, str], cli_args: list[str]) -> None:
    """Import (once) and call `module.main()` with the given env + argv."""
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    mod = importlib.import_module(module_name)
    with _patched_env(env, [module_name] + cli_args):
        mod.main()
