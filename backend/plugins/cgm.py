from ._demo_generators import generate_cgm, run_if_demo
from ._script_runner import run_script_main
from .base import ParamSpec, Plugin, RunResult, register


def _run(params: dict) -> RunResult:
    full = bool(params.get("full_sync"))
    n = run_if_demo(generate_cgm, full=full)
    if n is not None:
        return RunResult(ok=True, message=f"Demo sync: {n} rows", rows_written=n)

    cli: list[str] = []
    if full:
        cli.append("--full")
    elif params.get("days"):
        cli += ["--days", str(int(params["days"]))]
    run_script_main(
        "sync_cgm",
        env={
            "CGM_PROVIDER": params.get("provider", "") or "libre",
            "LIBRE_EMAIL": params.get("email", "") or "",
            "LIBRE_PASSWORD": params.get("password", "") or "",
            "LIBRE_REGION": params.get("region", "") or "eu",
        },
        cli_args=cli,
    )
    return RunResult(ok=True, message="CGM sync complete")


register(Plugin(
    name="cgm",
    label="CGM — Continuous Glucose",
    default_interval_minutes=60,
    description="Glucose readings from LibreLinkUp (Freestyle Libre). Set CGM_PROVIDER=libre.",
    param_schema=[
        ParamSpec("email", "LibreLinkUp Email", "text", required=True, env_var="LIBRE_EMAIL"),
        ParamSpec("password", "LibreLinkUp Password", "secret", required=True, env_var="LIBRE_PASSWORD"),
        ParamSpec("region", "Region (eu/us/au/…)", "text", default="eu", env_var="LIBRE_REGION"),
        ParamSpec("provider", "CGM provider (libre)", "text", default="libre", env_var="CGM_PROVIDER"),
        ParamSpec("days", "Days to sync (blank = incremental)", "int"),
        ParamSpec("full_sync", "Full resync", "bool", default=False),
    ],
    run_fn=_run,
))
