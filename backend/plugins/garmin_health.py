from .base import ParamSpec, Plugin, RunResult, register
from ._script_runner import run_script_main


def _run(params: dict) -> RunResult:
    cli: list[str] = []
    if params.get("full_sync"):
        cli.append("--full")
    elif params.get("days"):
        cli += ["--days", str(int(params["days"]))]
    run_script_main(
        "sync_garmin",
        env={
            "GARMIN_EMAIL": params.get("email", "") or "",
            "GARMIN_PASSWORD": params.get("password", "") or "",
        },
        cli_args=cli,
    )
    return RunResult(ok=True, message="Garmin health sync complete")


register(Plugin(
    name="garmin_health",
    label="Garmin Connect — Health",
    default_interval_minutes=360,
    description="Heart rate, HRV, sleep, stress, body battery, steps.",
    param_schema=[
        ParamSpec("email", "Email", "text", required=True, env_var="GARMIN_EMAIL"),
        ParamSpec("password", "Password", "secret", required=True, env_var="GARMIN_PASSWORD"),
        ParamSpec("days", "Days to sync (blank = incremental)", "int"),
        ParamSpec("full_sync", "Full resync", "bool", default=False),
    ],
    run_fn=_run,
))
