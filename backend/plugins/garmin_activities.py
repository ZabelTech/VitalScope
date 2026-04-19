from ._demo_generators import generate_garmin_activities, run_if_demo
from ._script_runner import run_script_main
from .base import ParamSpec, Plugin, RunResult, register


def _run(params: dict) -> RunResult:
    full = bool(params.get("full_sync"))
    n = run_if_demo(generate_garmin_activities, full=full)
    if n is not None:
        return RunResult(ok=True, message=f"Demo sync: {n} rows", rows_written=n)

    cli: list[str] = []
    if full:
        cli.append("--full")
    elif params.get("days"):
        cli += ["--days", str(int(params["days"]))]
    run_script_main(
        "sync_garmin_activities",
        env={
            "GARMIN_EMAIL": params.get("email", "") or "",
            "GARMIN_PASSWORD": params.get("password", "") or "",
        },
        cli_args=cli,
    )
    return RunResult(ok=True, message="Garmin activities sync complete")


register(Plugin(
    name="garmin_activities",
    label="Garmin Connect — Activities",
    default_interval_minutes=720,
    description="Workout and activity history from Garmin.",
    param_schema=[
        ParamSpec("email", "Email", "text", required=True, env_var="GARMIN_EMAIL"),
        ParamSpec("password", "Password", "secret", required=True, env_var="GARMIN_PASSWORD"),
        ParamSpec("days", "Days to sync (blank = incremental)", "int"),
        ParamSpec("full_sync", "Full resync", "bool", default=False),
    ],
    run_fn=_run,
))
