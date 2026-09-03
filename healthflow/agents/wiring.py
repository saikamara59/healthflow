"""Construct healthflow-agents implementations with HealthFlow's real audit
and invocation-tracking infrastructure injected.

The four available PydanticAI successor Ports are selected here. AppealAgent
remains on the original implementation because v0.5.0 does not ship an appeal
Port. Always build agents through these factories: bare construction silently
falls back to package stdout logging and bypasses HealthFlow's audit trail and
agent_invocation_log table.
"""
from healthflow_agents import AppealAgent
from healthflow_agents.pydantic_agents import (
    ComparisonAgent,
    CostCalculatorAgent,
    NetworkAgent,
    TranslationAgent,
)
from healthflow_agents.core.safety import Harness

from healthflow.logs.audit import AuditLogger
from healthflow.logs.invocation import invocation


def _injected() -> dict:
    # HealthFlow's AuditLogger and `invocation` singleton satisfy the
    # package's AuditSink / InvocationTracker Protocols as-is.
    return {"audit_sink": AuditLogger(), "invocation_tracker": invocation}


def build_comparison_agent() -> ComparisonAgent:
    return ComparisonAgent(**_injected())


def build_cost_calculator_agent() -> CostCalculatorAgent:
    return CostCalculatorAgent(**_injected())


def build_network_agent() -> NetworkAgent:
    return NetworkAgent(**_injected())


def build_translation_agent() -> TranslationAgent:
    return TranslationAgent(**_injected())


def build_appeal_agent() -> AppealAgent:
    return AppealAgent(**_injected())


def build_harness() -> Harness:
    return Harness(**_injected())
