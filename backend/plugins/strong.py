from .base import ParamSpec, Plugin, RunResult, register
from ._script_runner import run_script_main


def _run(params: dict) -> RunResult:
    cli = ["--full"] if params.get("full_sync") else []
    run_script_main(
        "sync_strong",
        env={
            "STRONG_EMAIL": params.get("email", "") or "",
            "STRONG_PASSWORD": params.get("password", "") or "",
        },
        cli_args=cli,
    )
    return RunResult(ok=True, message="Strong sync complete")


register(Plugin(
    name="strong",
    label="Strong — Workouts",
    default_interval_minutes=720,
    description="Strength training workouts from the Strong app.",
    param_schema=[
        ParamSpec("email", "Email", "text", required=True),
        ParamSpec("password", "Password", "secret", required=True),
        ParamSpec("full_sync", "Full resync", "bool", default=False),
    ],
    run_fn=_run,
))
