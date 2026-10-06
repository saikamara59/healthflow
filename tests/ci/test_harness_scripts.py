"""CI harness scripts behave as CI and deploys depend on them to.

The deployed-route smoke check runs against a local stand-in server so its pass
and fail behavior is proven without a real deployment.
"""

import os
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SMOKE = REPO_ROOT / "scripts" / "smoke_deployed_routes.sh"
LOCK = REPO_ROOT / "scripts" / "lock_requirements.sh"
RELEASE_IMAGE = REPO_ROOT / "scripts" / "fly_release_image.sh"
ROLLBACK = REPO_ROOT / "scripts" / "fly_rollback.sh"
RELEASES = (
    '[{"Version": 61, "Status": "failed", "ImageRef": "registry.fly.io/healthflow-demo:deployment-BAD"},'
    ' {"Version": 60, "Status": "complete", "ImageRef": "registry.fly.io/healthflow-demo:deployment-GOOD"},'
    ' {"Version": 59, "Status": "complete", "ImageRef": "registry.fly.io/healthflow-demo:deployment-OLD"}]'
)
SPA = b'<!doctype html><html><body><div id="root"></div></body></html>'


def _serve(broken_path: str | None = None):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - http.server API
            if self.path == broken_path:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"detail":"Not Found"}')
            elif self.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"healthy"}')
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(SPA)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _run_smoke(server) -> subprocess.CompletedProcess:
    env = {**os.environ, "HEALTHFLOW_BASE_URL": f"http://127.0.0.1:{server.server_port}",
           "SMOKE_ATTEMPTS": "2", "SMOKE_RETRY_DELAY": "0"}
    return subprocess.run(["bash", str(SMOKE)], env=env, capture_output=True, text=True, timeout=60)


def test_smoke_check_passes_when_health_and_every_route_serve_the_app():
    server = _serve()
    try:
        result = _run_smoke(server)
    finally:
        server.shutdown()
    assert result.returncode == 0, result.stderr
    assert "OK /health: healthy JSON" in result.stdout
    assert "OK /documents: SPA document" in result.stdout


def test_smoke_check_fails_when_a_route_does_not_serve_the_app():
    server = _serve(broken_path="/clients")
    try:
        result = _run_smoke(server)
    finally:
        server.shutdown()
    assert result.returncode != 0
    assert "Deployed route failed:" in result.stderr
    assert "/clients" in result.stderr


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash is required")
def test_lock_script_refuses_to_run_without_a_token(tmp_path):
    # An empty PATH apart from bash's own directory hides `gh` and `docker`.
    env = {"PATH": str(Path(shutil.which("bash")).parent), "HOME": str(tmp_path)}
    result = subprocess.run(["bash", str(LOCK)], env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 1
    assert "HEALTHFLOW_AGENTS_TOKEN" in result.stderr


def _fake_flyctl(tmp_path: Path) -> tuple[dict, Path]:
    """A flyctl stand-in on PATH that records its arguments and answers `releases`."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "flyctl-calls.txt"
    (tmp_path / "releases.json").write_text(RELEASES)
    flyctl = bin_dir / "flyctl"
    flyctl.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "$*" >> "{calls}"\n'
        f'if [ "$1" = releases ]; then cat "{tmp_path / "releases.json"}"; fi\n'
    )
    flyctl.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FLY_APP": "healthflow-demo"}
    return env, calls


def test_release_image_is_the_newest_completed_release(tmp_path):
    env, calls = _fake_flyctl(tmp_path)
    result = subprocess.run(["bash", str(RELEASE_IMAGE)], env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "registry.fly.io/healthflow-demo:deployment-GOOD"
    assert "--app healthflow-demo" in calls.read_text()


def test_rollback_refuses_without_a_previous_image(tmp_path):
    env, calls = _fake_flyctl(tmp_path)
    result = subprocess.run(["bash", str(ROLLBACK), ""], env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 1
    assert "No previous release" in result.stderr
    assert not calls.exists(), "Nothing may be deployed without a known-good image"


def test_rollback_redeploys_the_previous_image_and_checks_it(tmp_path):
    env, calls = _fake_flyctl(tmp_path)
    server = _serve()
    try:
        env |= {"HEALTHFLOW_BASE_URL": f"http://127.0.0.1:{server.server_port}",
                "SMOKE_ATTEMPTS": "2", "SMOKE_RETRY_DELAY": "0"}
        result = subprocess.run(
            ["bash", str(ROLLBACK), "registry.fly.io/healthflow-demo:deployment-GOOD"],
            env=env, capture_output=True, text=True, timeout=60,
        )
    finally:
        server.shutdown()
    assert result.returncode == 0, result.stderr
    deploy = calls.read_text()
    assert "deploy --app healthflow-demo --image registry.fly.io/healthflow-demo:deployment-GOOD" in deploy
    assert "OK /health: healthy JSON" in result.stdout


NEEDS_DEPLOY = REPO_ROOT / "scripts" / "release_needs_deploy.sh"


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


def _repo_with_two_fly_configs(tmp_path: Path) -> tuple[Path, str]:
    """A repository whose fly.toml changed after the commit that is live on Fly."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "ci@example.com")
    _git(repo, "config", "user.name", "CI")
    (repo / "fly.toml").write_text("app = 'healthflow-demo'\n# known good\n")
    (repo / "app.py").write_text("print('v1')\n")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "live")
    live = _git(repo, "rev-parse", "HEAD")
    (repo / "fly.toml").write_text("app = 'healthflow-demo'\n# broken config\n")
    _git(repo, "commit", "-qam", "bad config")
    return repo, live


def _fake_flyctl_capturing_config(tmp_path: Path) -> tuple[dict, Path]:
    env, calls = _fake_flyctl(tmp_path)
    flyctl = Path(env["PATH"].split(":")[0]) / "flyctl"
    flyctl.write_text(flyctl.read_text() + (
        'while [ $# -gt 0 ]; do if [ "$1" = --config ]; then cat "$2" > '
        f'"{tmp_path / "deployed-config.toml"}"; fi; shift; done\n'
    ))
    return env, calls


def _rollback(repo: Path, env: dict, image: str):
    server = _serve()
    try:
        env = env | {"HEALTHFLOW_BASE_URL": f"http://127.0.0.1:{server.server_port}",
                     "SMOKE_ATTEMPTS": "2", "SMOKE_RETRY_DELAY": "0"}
        return subprocess.run(["bash", str(ROLLBACK), image], cwd=repo, env=env,
                              capture_output=True, text=True, timeout=60)
    finally:
        server.shutdown()


def test_rollback_restores_the_fly_config_of_the_commit_that_was_live(tmp_path):
    repo, live = _repo_with_two_fly_configs(tmp_path)
    env, calls = _fake_flyctl_capturing_config(tmp_path)

    result = _rollback(repo, env, f"registry.fly.io/healthflow-demo:git-{live}")

    assert result.returncode == 0, result.stderr
    assert f"--image registry.fly.io/healthflow-demo:git-{live}" in calls.read_text()
    assert "known good" in (tmp_path / "deployed-config.toml").read_text()


def test_rollback_of_an_unlabeled_image_warns_and_keeps_the_current_config(tmp_path):
    repo, _ = _repo_with_two_fly_configs(tmp_path)
    env, calls = _fake_flyctl_capturing_config(tmp_path)

    result = _rollback(repo, env, "registry.fly.io/healthflow-demo:deployment-OLD")

    assert result.returncode == 0, result.stderr
    assert "no commit label" in result.stderr
    assert "--config" not in calls.read_text()


@pytest.mark.parametrize(("change", "expected"), [
    ({"docs/notes.md": "updated"}, "false"),
    ({"app.py": "print('v2')\n"}, "true"),
])
def test_deploy_decision_compares_with_the_commit_live_on_fly(tmp_path, change, expected):
    repo, live = _repo_with_two_fly_configs(tmp_path)
    _git(repo, "reset", "-q", "--hard", live)
    # A shipped change already sits between the live commit and the docs-only push
    # being released, as when a queued release is replaced by a newer one.
    (repo / "app.py").write_text("print('queued')\n") if expected == "true" else None
    for name, content in change.items():
        (repo / name).parent.mkdir(parents=True, exist_ok=True)
        (repo / name).write_text(content)
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "next")
    target = _git(repo, "rev-parse", "HEAD")

    result = subprocess.run(["bash", str(NEEDS_DEPLOY), f"registry.fly.io/healthflow-demo:git-{live}", target],
                            cwd=repo, capture_output=True, text=True, timeout=30)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected


def test_a_shipped_change_behind_a_docs_only_push_still_deploys(tmp_path):
    repo, live = _repo_with_two_fly_configs(tmp_path)  # HEAD changed fly.toml after the live commit
    (repo / "README.md").write_text("docs only\n")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "docs only")

    result = subprocess.run(["bash", str(NEEDS_DEPLOY), f"registry.fly.io/healthflow-demo:git-{live}",
                             _git(repo, "rev-parse", "HEAD")], cwd=repo, capture_output=True, text=True, timeout=30)

    assert result.stdout.strip() == "true"


@pytest.mark.parametrize("deployed_image", ["", "registry.fly.io/healthflow-demo:deployment-OLD",
                                            "registry.fly.io/healthflow-demo:git-" + "0" * 40])
def test_deploy_decision_deploys_when_the_live_commit_is_unknown(tmp_path, deployed_image):
    repo, _ = _repo_with_two_fly_configs(tmp_path)

    result = subprocess.run(["bash", str(NEEDS_DEPLOY), deployed_image, _git(repo, "rev-parse", "HEAD")],
                            cwd=repo, capture_output=True, text=True, timeout=30)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "true"
