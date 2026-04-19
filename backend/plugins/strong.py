from ._demo_generators import generate_strong, run_if_demo
from ._script_runner import run_script_main
from .base import ParamSpec, Plugin, RunResult, register


def _run(params: dict) -> RunResult:
    full = bool(params.get("full_sync"))
    n = run_if_demo(generate_strong, full=full)
    if n is not None:
        return RunResult(ok=True, message=f"Demo sync: {n} rows", rows_written=n)

    cli = ["--full"] if full else []
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
        ParamSpec("email", "Email", "text", required=True, env_var="STRONG_EMAIL"),
        ParamSpec("password", "Password", "secret", required=True, env_var="STRONG_PASSWORD"),
        ParamSpec("full_sync", "Full resync", "bool", default=False),
    ],
    run_fn=_run,
))
