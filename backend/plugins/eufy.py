from ._demo_generators import generate_eufy, run_if_demo
from ._script_runner import run_script_main
from .base import ParamSpec, Plugin, RunResult, register


def _run(params: dict) -> RunResult:
    full = bool(params.get("all_history"))
    n = run_if_demo(generate_eufy, full=full)
    if n is not None:
        return RunResult(ok=True, message=f"Demo sync: {n} rows", rows_written=n)

    cli: list[str] = []
    if full:
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
    default_interval_minutes=1,
    description="Weight and body-composition readings from EufyLife.",
    param_schema=[
        ParamSpec("email", "Email", "text", required=True, env_var="EUFY_EMAIL"),
        ParamSpec("password", "Password", "secret", required=True, env_var="EUFY_PASSWORD"),
        ParamSpec("days", "Days to keep (blank = 1)", "int"),
        ParamSpec("all_history", "Keep all history", "bool", default=False),
        ParamSpec("customer_id", "Primary customer ID (optional)", "text"),
    ],
    run_fn=_run,
))
