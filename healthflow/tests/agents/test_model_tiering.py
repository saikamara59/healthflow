"""Each agent is pinned to a Claude model tier matched to its task complexity
(see healthflow/agents/harness.py). These tests lock the tier contract so a
careless edit can't silently move an agent onto a more/less expensive model.

- AppealAgent      -> Opus   (high-stakes regulatory/legal reasoning)
- TranslationAgent -> Sonnet (nuanced extraction from policy text)
- Comparison/Cost/Network -> Haiku (narrating tool-computed structured data)
"""
from unittest.mock import MagicMock, patch

from healthflow.agents import (
    appeal_agent,
    comparison_agent,
    cost_calculator_agent,
    harness,
    network_agent,
    translation_agent,
)
from healthflow.models.schemas import PlanSummary


def test_harness_tier_constants_are_current_ga_ids():
    assert harness.CLAUDE_MODEL_OPUS == "claude-opus-4-8"
    assert harness.CLAUDE_MODEL_SONNET == "claude-sonnet-4-6"
    assert harness.CLAUDE_MODEL_HAIKU == "claude-haiku-4-5"
    # Back-compat default stays on Sonnet for any caller still importing it.
    assert harness.CLAUDE_MODEL == harness.CLAUDE_MODEL_SONNET


def test_appeal_agent_uses_opus():
    assert appeal_agent.CLAUDE_MODEL == harness.CLAUDE_MODEL_OPUS


def test_translation_agent_uses_sonnet():
    assert translation_agent.CLAUDE_MODEL == harness.CLAUDE_MODEL_SONNET


def test_summarize_only_agents_use_haiku():
    assert comparison_agent.CLAUDE_MODEL == harness.CLAUDE_MODEL_HAIKU
    assert cost_calculator_agent.CLAUDE_MODEL == harness.CLAUDE_MODEL_HAIKU
    assert network_agent.CLAUDE_MODEL == harness.CLAUDE_MODEL_HAIKU


@patch("healthflow.agents.comparison_agent.anthropic")
def test_tier_reaches_messages_create(mock_anthropic):
    """Guard against the binding being correct but not actually passed to the
    API call — assert the model kwarg on a representative (Haiku) agent."""
    mock_client = MagicMock()
    mock_anthropic.Anthropic.return_value = mock_client
    mock_client.messages.create.return_value = MagicMock(
        content=[MagicMock(text="Plan A.")]
    )

    plan = PlanSummary(
        plan_name="Aetna Medicare Eagle Plus (HMO)",
        plan_id="H3312-034",
        monthly_premium=0.0,
        annual_deductible=250.0,
        out_of_pocket_max=4500.0,
        star_rating=4.5,
        plan_type="HMO",
        drug_coverage=True,
        estimated_medication_costs={"Metformin": 5.0},
        estimated_procedure_costs={"MRI": 150.0},
    )

    comparison_agent.ComparisonAgent().recommend(
        plans=[plan], age=65, income_level="low"
    )

    call = mock_client.messages.create.call_args
    assert call.kwargs["model"] == "claude-haiku-4-5"
