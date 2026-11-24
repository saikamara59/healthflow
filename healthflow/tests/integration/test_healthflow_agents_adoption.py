"""HealthFlow's deployment contract for the healthflow-agents successor Ports."""

import importlib.metadata
import json
from pathlib import Path
import os
import subprocess
import sys
import unittest
from unittest.mock import patch


REPO_ROOT = Path(__file__).parents[3]


class HealthflowAgentsDependencyTests(unittest.TestCase):
    def test_runtime_dependency_pins_the_verified_v050_release_commit(self):
        requirements = (REPO_ROOT / "requirements.txt").read_text().splitlines()

        # Pinned to the commit v0.5.0 points at: a tag can be moved, a commit cannot.
        self.assertIn(
            "healthflow-agents[pydantic-ai] @ "
            "git+https://github.com/saikamara59/healthflow-agents.git"
            "@0a8390a79458609cd14db6cdf953bd98b55e49b3  # v0.5.0",
            requirements,
        )

    def test_installed_v050_tag_resolves_to_verified_release_commit(self):
        direct_url = importlib.metadata.distribution("healthflow-agents").read_text(
            "direct_url.json"
        )

        self.assertIsNotNone(direct_url)
        metadata = json.loads(direct_url)
        self.assertEqual(metadata["vcs_info"]["vcs"], "git")
        self.assertEqual(
            metadata["vcs_info"]["commit_id"], "0a8390a79458609cd14db6cdf953bd98b55e49b3"
        )

    def test_fly_build_uses_ephemeral_github_credential_for_private_dependency(self):
        dockerfile = (REPO_ROOT / "Dockerfile").read_text()
        deploy_workflow = (
            REPO_ROOT / ".github" / "workflows" / "release.yml"
        ).read_text()

        self.assertIn(
            "--mount=type=secret,id=HEALTHFLOW_AGENTS_TOKEN,required=true",
            dockerfile,
        )
        self.assertIn("GIT_CONFIG_KEY_0=credential.helper", dockerfile)
        self.assertIn(
            "password=$(cat /run/secrets/HEALTHFLOW_AGENTS_TOKEN)", dockerfile
        )
        self.assertIn(
            "--build-secret HEALTHFLOW_AGENTS_TOKEN="
            "${{ secrets.HEALTHFLOW_AGENTS_TOKEN }}",
            deploy_workflow,
        )

    def test_e2e_compose_builds_receive_private_dependency_secret(self):
        import yaml

        compose = yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text())
        test_compose = yaml.safe_load(
            (REPO_ROOT / "docker-compose.test.yml").read_text()
        )

        self.assertEqual(
            compose["secrets"]["HEALTHFLOW_AGENTS_TOKEN"],
            {"environment": "HEALTHFLOW_AGENTS_TOKEN"},
        )
        self.assertIn(
            "HEALTHFLOW_AGENTS_TOKEN",
            compose["services"]["backend"]["build"]["secrets"],
        )
        self.assertIn(
            "HEALTHFLOW_AGENTS_TOKEN",
            test_compose["services"]["seed"]["build"]["secrets"],
        )


class HealthflowAgentsFactoryTests(unittest.TestCase):
    def test_factories_select_successor_ports_and_retain_original_appeal_agent(self):
        test_environment = {
            "ANTHROPIC_API_KEY": "test-key",
            "PHI_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        }
        with patch.dict(os.environ, test_environment):
            from healthflow.agents.wiring import (
                build_appeal_agent,
                build_comparison_agent,
                build_cost_calculator_agent,
                build_network_agent,
                build_translation_agent,
            )
            from healthflow_agents import AppealAgent as OriginalAppealAgent
            from healthflow_agents.pydantic_agents import (
                ComparisonAgent as PydanticComparisonAgent,
                CostCalculatorAgent as PydanticCostCalculatorAgent,
                NetworkAgent as PydanticNetworkAgent,
                TranslationAgent as PydanticTranslationAgent,
            )

            agents = (
                build_comparison_agent(),
                build_cost_calculator_agent(),
                build_network_agent(),
                build_translation_agent(),
                build_appeal_agent(),
            )

        self.assertIs(type(agents[0]), PydanticComparisonAgent)
        self.assertIs(type(agents[1]), PydanticCostCalculatorAgent)
        self.assertIs(type(agents[2]), PydanticNetworkAgent)
        self.assertIs(type(agents[3]), PydanticTranslationAgent)
        self.assertIs(type(agents[4]), OriginalAppealAgent)

    def test_factories_preserve_healthflow_compliance_record_injections(self):
        test_environment = {
            "ANTHROPIC_API_KEY": "test-key",
            "PHI_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        }
        with patch.dict(os.environ, test_environment):
            from healthflow.agents.wiring import (
                build_appeal_agent,
                build_comparison_agent,
                build_cost_calculator_agent,
                build_network_agent,
                build_translation_agent,
            )
            from healthflow.logs.audit import AuditLogger
            from healthflow.logs.invocation import invocation

            agents = (
                build_comparison_agent(),
                build_cost_calculator_agent(),
                build_network_agent(),
                build_translation_agent(),
                build_appeal_agent(),
            )

        for agent in agents:
            self.assertIsInstance(agent.audit, AuditLogger)
            self.assertIs(agent.invocations, invocation)

    def test_constructing_ports_does_not_enable_logfire(self):
        code = """
from healthflow.agents.wiring import (
    build_comparison_agent,
    build_cost_calculator_agent,
    build_network_agent,
    build_translation_agent,
)
from healthflow_agents.pydantic_agents.observability import is_configured

build_comparison_agent()
build_cost_calculator_agent()
build_network_agent()
build_translation_agent()
print(str(is_configured()).lower())
"""
        environment = os.environ.copy()
        environment.update(
            {
                "ANTHROPIC_API_KEY": "test-key",
                "PHI_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            }
        )

        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=REPO_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=True,
        )

        self.assertEqual(result.stdout.strip(), "false")


if __name__ == "__main__":
    unittest.main()
