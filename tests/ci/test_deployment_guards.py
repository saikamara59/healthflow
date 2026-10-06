"""Deployment guards: deploy configuration cannot ship an unsafe HealthFlow.

These read the committed deploy files, so a change that would expose test
routes, bake in a secret, or reopen public uploads fails CI before it ships.
"""

import re
import tomllib
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SECRET_NAMES = re.compile(
    r"(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|PHI_ENCRYPTION_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)",
)
TEST_ONLY_SETTINGS = ("HEALTHFLOW_TEST_MODE", "HEALTHFLOW_ENABLE_TEST_ROUTES", "PHI_ENCRYPTION_ALLOW_PLAINTEXT_READ")


def _fly() -> dict:
    return tomllib.loads((REPO_ROOT / "fly.toml").read_text())


def _workflow(name: str) -> dict:
    return yaml.safe_load((REPO_ROOT / ".github" / "workflows" / name).read_text())


def _truthy(value) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def test_fly_environment_never_enables_test_routes_or_plaintext_phi_reads():
    env = _fly().get("env", {})
    for setting in TEST_ONLY_SETTINGS:
        assert setting not in env, f"fly.toml must not set {setting}"


def test_fly_environment_holds_no_secrets():
    for key, value in _fly().get("env", {}).items():
        assert not SECRET_NAMES.search(key), f"{key} belongs in `fly secrets`, not fly.toml"
        assert not re.search(r"://[^/\s:@]+:[^/\s@]+@", str(value)), f"{key} embeds credentials in a URL"


def test_public_demo_keeps_uploads_disabled():
    # ADR 0001: the shared demo cannot tell whether a visitor's file is synthetic.
    env = _fly().get("env", {})
    if _truthy(env.get("SEED_DEMO", "0")):
        assert not _truthy(env.get("DOCUMENT_UPLOAD_ENABLED", "0")), (
            "SEED_DEMO=1 with DOCUMENT_UPLOAD_ENABLED would accept uploads on the public demo"
        )


def test_fly_serves_only_https_from_the_combined_image():
    config = _fly()
    assert config["http_service"]["force_https"] is True
    assert config["build"]["build-target"] == "combined"


def test_dockerfile_bakes_in_no_secrets_or_test_mode():
    for number, line in enumerate((REPO_ROOT / "Dockerfile").read_text().splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith(("ENV ", "ARG ")):
            name = stripped.split()[1].split("=", 1)[0]
            assert not SECRET_NAMES.search(name), f"Dockerfile:{number} bakes {name} into the image"
        for setting in TEST_ONLY_SETTINGS:
            assert setting not in stripped, f"Dockerfile:{number} sets {setting}"


def test_private_dependency_token_only_reaches_the_build_as_a_secret_mount():
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert "--mount=type=secret,id=HEALTHFLOW_AGENTS_TOKEN,required=true" in dockerfile
    assert "ARG HEALTHFLOW_AGENTS_TOKEN" not in dockerfile
    deploy_run = " ".join(step.get("run", "") for step in _workflow("release.yml")["jobs"]["deploy"]["steps"])
    assert "--build-secret HEALTHFLOW_AGENTS_TOKEN=" in deploy_run
    assert "--build-arg" not in deploy_run


def test_shared_compose_requires_real_secrets_and_never_enables_test_mode():
    compose = (REPO_ROOT / "docker-compose.yml").read_text()
    assert "JWT_SECRET=${JWT_SECRET:?" in compose
    assert "PHI_ENCRYPTION_KEY=${PHI_ENCRYPTION_KEY:?" in compose
    for setting in TEST_ONLY_SETTINGS:
        assert setting not in compose, f"docker-compose.yml sets {setting}; only the test override may"


def _triggers(workflow: dict) -> dict:
    return workflow.get(True) or workflow.get("on") or {}  # PyYAML reads the bare key `on` as True


def test_release_runs_only_from_main():
    triggers = _triggers(_workflow("release.yml"))
    assert set(triggers) == {"push"}
    assert triggers["push"]["branches"] == ["main"]
    assert not (REPO_ROOT / ".github" / "workflows" / "fly-deploy.yml").exists(), (
        "A second deploy workflow would bypass the release gates"
    )


def test_deploy_waits_for_ci_and_e2e_on_the_same_commit():
    jobs = _workflow("release.yml")["jobs"]
    assert jobs["ci"]["uses"] == "./.github/workflows/ci.yml"
    assert jobs["e2e"]["uses"] == "./.github/workflows/e2e.yml"
    assert {"ci", "e2e"} <= set(jobs["deploy"]["needs"])
    for name in ("ci.yml", "e2e.yml"):
        triggers = _triggers(_workflow(name))
        assert "workflow_call" in triggers, f"{name} must be callable by the release"
        assert "push" not in triggers, f"{name} on push would run separately from the release gate"


def test_every_deploy_is_smoke_checked_and_rolled_back_when_the_check_fails():
    steps = _workflow("release.yml")["jobs"]["deploy"]["steps"]
    by_id = {step.get("id"): index for index, step in enumerate(steps) if step.get("id")}
    assert by_id["previous"] < by_id["deploy"] < by_id["smoke"] < by_id["rollback"]
    assert "fly_release_image.sh" in steps[by_id["previous"]]["run"]
    assert "smoke_deployed_routes.sh" in steps[by_id["smoke"]]["run"]
    rollback = steps[by_id["rollback"]]
    assert "fly_rollback.sh" in rollback["run"]
    condition = rollback["if"].replace(" ", "")
    assert "failure()" in condition and "steps.deploy.outcome=='success'" in condition, (
        "Roll back only when a deploy went out and then failed its check"
    )


def test_secret_scan_runs_on_every_pull_request_and_release():
    jobs = _workflow("ci.yml")["jobs"]
    scan = jobs["secret-scan"]
    checkout = next(step for step in scan["steps"] if "actions/checkout" in step.get("uses", ""))
    assert checkout["with"]["fetch-depth"] == 0, "The scan must see the full history"
    run = " ".join(step.get("run", "") for step in scan["steps"])
    assert re.search(r'gitleaks"? git ', run), "Scan the git history, not only the checked-out files"
    assert "--redact" in run, "Findings must never print the secret itself"


def test_external_services_are_smoke_checked_nightly():
    workflow = _workflow("nightly-external.yml")
    triggers = _triggers(workflow)
    assert triggers["schedule"], "The live check must run on a schedule"
    assert "workflow_dispatch" in triggers
    run = " ".join(step.get("run", "") for job in workflow["jobs"].values() for step in job["steps"])
    assert "healthflow/tests/integration/" in run
    env = {k: v for job in workflow["jobs"].values() for step in job["steps"] for k, v in (step.get("env") or {}).items()}
    assert str(env.get("LIVE_SMOKE_TESTS")) == "1"


def test_workflows_keep_read_only_tokens_and_avoid_pull_request_target():
    for path in sorted((REPO_ROOT / ".github" / "workflows").glob("*.yml")):
        workflow = yaml.safe_load(path.read_text())
        triggers = _triggers(workflow)
        assert "pull_request_target" not in triggers, f"{path.name} runs untrusted code with secrets"
        assert workflow.get("permissions") == {"contents": "read"}, f"{path.name} must default to read-only"


def test_each_browser_runs_e2e_on_its_own_runner():
    # Splitting by browser gives each project its own 2-core runner instead of
    # sharing one with the Docker stack, and the release still waits for all of them.
    job = _workflow("e2e.yml")["jobs"]["e2e"]
    assert job["strategy"]["fail-fast"] is False, "One browser failing must not cancel the others' results"
    assert sorted(job["strategy"]["matrix"]["browser"]) == ["chromium", "firefox", "webkit"]
    run = " ".join(step.get("run", "") for step in job["steps"])
    assert "--project=${{ matrix.browser }}" in run
    assert "playwright install --with-deps ${{ matrix.browser }}" in run
