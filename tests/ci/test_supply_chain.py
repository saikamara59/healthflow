"""Release supply chain: what goes into a HealthFlow build is pinned and reviewed.

These checks read files only, so they run without the private backend dependency.
"""

import re
from datetime import date
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = sorted((REPO_ROOT / ".github" / "workflows").glob("*.yml"))
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
PINNED_PACKAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?==[A-Za-z0-9.+!-]+$")


def _requirement_lines(path: Path) -> list[str]:
    lines = []
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if line and not line.startswith("-r "):
            lines.append(line)
    return lines


def _package_name(requirement: str) -> str:
    name = re.split(r"[\s\[=<>!~@;]", requirement, maxsplit=1)[0]
    return re.sub(r"[-_.]+", "-", name).lower()


def _workflow_steps():
    for workflow in WORKFLOWS:
        jobs = yaml.safe_load(workflow.read_text()).get("jobs", {})
        for job_name, job in jobs.items():
            for step in job.get("steps", []):
                yield workflow.name, job_name, step


def test_every_locked_python_package_is_pinned_exactly():
    lock = _requirement_lines(REPO_ROOT / "requirements.lock")
    assert lock, "requirements.lock is empty"
    for requirement in lock:
        if " @ git+" in requirement:
            continue
        assert PINNED_PACKAGE.match(requirement), f"Not pinned with ==: {requirement}"


def test_git_dependencies_are_pinned_to_a_full_commit():
    for path in (REPO_ROOT / "requirements.txt", REPO_ROOT / "requirements.lock"):
        for requirement in _requirement_lines(path):
            if " @ git+" not in requirement:
                continue
            revision = requirement.rsplit("@", 1)[1]
            assert FULL_SHA.match(revision), f"{path.name}: {requirement} is not pinned to a commit"


def test_lock_covers_every_direct_requirement():
    locked = {_package_name(line) for line in _requirement_lines(REPO_ROOT / "requirements.lock")}
    for requirement in _requirement_lines(REPO_ROOT / "requirements.txt"):
        assert _package_name(requirement) in locked, (
            f"{requirement} is missing from requirements.lock; run scripts/lock_requirements.sh"
        )


def test_builds_install_python_dependencies_from_the_lock():
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert "pip install --no-cache-dir -r requirements.lock" in dockerfile
    installs = [
        step.get("run", "")
        for _, _, step in _workflow_steps()
        if "pip install" in step.get("run", "") and "requirements" in step.get("run", "")
    ]
    assert installs, "No workflow installs Python requirements"
    for command in installs:
        assert "requirements.txt" not in command, f"CI installs unlocked requirements: {command}"


def test_ci_tooling_is_pinned_exactly():
    for requirement in _requirement_lines(REPO_ROOT / "requirements-ci.txt"):
        assert PINNED_PACKAGE.match(requirement), f"Not pinned with ==: {requirement}"
    for requirement in _requirement_lines(REPO_ROOT / "requirements-dev.txt"):
        assert PINNED_PACKAGE.match(requirement), f"Not pinned with ==: {requirement}"


@pytest.mark.parametrize("workflow", WORKFLOWS, ids=lambda path: path.name)
def test_github_actions_are_pinned_to_full_commit_shas(workflow):
    for job_name, job in yaml.safe_load(workflow.read_text()).get("jobs", {}).items():
        for step in job.get("steps", []):
            uses = step.get("uses")
            if uses is None or uses.startswith("./"):
                continue
            reference = uses.rsplit("@", 1)[1] if "@" in uses else ""
            assert FULL_SHA.match(reference), f"{workflow.name}/{job_name}: {uses} is not pinned to a commit"


def test_frontend_installs_use_the_committed_lockfile():
    assert (REPO_ROOT / "frontend" / "package-lock.json").exists()
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert "RUN npm ci" in dockerfile and "npm install" not in dockerfile
    assert "package-lock.json*" not in dockerfile, "The lockfile must be required, not optional"
    for workflow_name, job_name, step in _workflow_steps():
        command = step.get("run", "")
        assert "npm install" not in command, f"{workflow_name}/{job_name} uses npm install instead of npm ci"


def test_docker_base_images_name_an_explicit_version():
    for line in (REPO_ROOT / "Dockerfile").read_text().splitlines():
        if not line.startswith("FROM "):
            continue
        image = line.split()[1]
        if ":" not in image:  # a previous stage, e.g. FROM backend AS combined
            continue
        tag = image.split(":", 1)[1]
        assert tag != "latest" and re.match(r"^\d", tag), f"Base image without a version: {image}"


def test_pip_audit_allowlist_entries_have_a_reason_and_have_not_expired():
    allowlist = REPO_ROOT / "security" / "pip-audit-allowlist.txt"
    for raw in allowlist.read_text().splitlines():
        if not raw.strip() or raw.startswith("#"):
            continue
        vulnerability_id, expires, reason = (part.strip() for part in raw.split("|", 2))
        assert re.match(r"^[A-Z]+-[0-9A-Za-z-]+$", vulnerability_id), raw
        assert len(reason) >= 40, f"{vulnerability_id}: explain why the vulnerability is acceptable"
        assert date.fromisoformat(expires) >= date.today(), (
            f"{vulnerability_id} expired on {expires}; review it again or remove it"
        )


def test_dependabot_keeps_pinned_actions_and_frontend_dependencies_current():
    config = yaml.safe_load((REPO_ROOT / ".github" / "dependabot.yml").read_text())
    ecosystems = {(update["package-ecosystem"], update["directory"]) for update in config["updates"]}
    assert ("github-actions", "/") in ecosystems
    assert ("npm", "/frontend") in ecosystems
