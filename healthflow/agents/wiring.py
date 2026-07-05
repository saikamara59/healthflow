"""Constructs healthflow-agents package agents with HealthFlow's real audit
and invocation-tracking implementations injected.

Always build agents through these factories — a bare `ComparisonAgent()`
silently falls back to the package's stdout logging, bypassing the audit
trail and the agent_invocation_log table.
"""
from healthflow_agents import (
    AppealAgent,
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
