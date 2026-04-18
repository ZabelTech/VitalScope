"""Sync plugins discovered at backend startup."""

import importlib
import pkgutil

from .base import REGISTRY, Plugin, ParamSpec, RunResult  # noqa: F401


def discover() -> dict[str, Plugin]:
    """Import every module in this package so each PLUGIN registers itself."""
    for info in pkgutil.iter_modules(__path__):
        if info.name == "base":
            continue
        importlib.import_module(f"{__name__}.{info.name}")
    return REGISTRY
