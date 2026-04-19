from .base import ParamSpec, Plugin, RunResult, register
from ._script_runner import run_script_main


def _run(params: dict) -> RunResult:
    cli: list[str] = []
    if params.get("all_history"):
        cli.append("--all")
    elif params.get("days"):
        cli += ["--days", str(int(params["days"]))]
    if params.get("customer_id"):
        cli += ["--customer-id", str(params["customer_id"])]
    run_script_main(
        "sync_eufy",
        env={
            "EUFY_EMAIL": params.get("email", "") or "",
            "EUFY_PASSWORD": params.get("password", "") or "",
        },
        cli_args=cli,
    )
    return RunResult(ok=True, message="Eufy sync complete")


register(Plugin(
    name="eufy",
    label="EufyLife — Body Composition",
    default_interval_minutes=1440,
    description="Weight and body-composition readings from EufyLife.",
    baseline_first_run_seconds=120,
    param_schema=[
        ParamSpec("email", "Email", "text", required=True),
        ParamSpec("password", "Password", "secret", required=True),
        ParamSpec("days", "Days to keep (blank = 1)", "int"),
        ParamSpec("all_history", "Keep all history", "bool", default=False),
        ParamSpec("customer_id", "Primary customer ID (optional)", "text"),
    ],
    run_fn=_run,
))
