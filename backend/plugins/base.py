"""Plugin base class and registry."""

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

ParamType = Literal["text", "secret", "int", "bool"]


@dataclass
class ParamSpec:
    key: str
    label: str
    type: ParamType = "text"
    default: Any = None
    required: bool = False


@dataclass
class RunResult:
    ok: bool
    message: str = ""
    rows_written: int | None = None


@dataclass
class Plugin:
    name: str
    label: str
    default_interval_minutes: int
    param_schema: list[ParamSpec]
    run_fn: Callable[[dict], RunResult]
    description: str = ""

    def run(self, params: dict) -> RunResult:
        return self.run_fn(params)


REGISTRY: dict[str, Plugin] = {}


def register(plugin: Plugin) -> Plugin:
    REGISTRY[plugin.name] = plugin
    return plugin
