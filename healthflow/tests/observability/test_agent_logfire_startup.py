"""Logfire receives agent invocation metadata, never patient or model content."""

import asyncio
from unittest.mock import MagicMock

import logfire
import pytest
from anthropic.types import Message, TextBlock, Usage
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from sqlalchemy import create_engine

from healthflow import main
from healthflow.database import config
from healthflow.database.models import AgentInvocationLog
from healthflow.logs import invocation as invocation_module
from healthflow_agents.contracts import PlanSummary
from healthflow_agents.pydantic_agents import ComparisonAgent
from healthflow_agents.pydantic_agents import observability

SENSITIVE_MARKER = "SYNTHETIC-PATIENT-MARKER"


@pytest.fixture
def local_logfire(monkeypatch):
    """Use the real Logfire SDK with an in-memory exporter, never the cloud."""
    exporter = InMemorySpanExporter()
    real_configure = logfire.configure

    def configure_locally(**options):
        options["send_to_logfire"] = False
        options["additional_span_processors"] = [SimpleSpanProcessor(exporter)]
        real_configure(**options)

    monkeypatch.setattr(logfire, "configure", configure_locally)
    monkeypatch.setattr(invocation_module, "_logfire_enabled", False, raising=False)
    monkeypatch.setattr(observability, "_instrumented", False)
    yield exporter
    real_configure(send_to_logfire=False, console=False)


def _invocation_logger(monkeypatch, tmp_path):
    database_path = tmp_path / "invocations.db"
    engine = create_engine(f"sqlite:///{database_path}")
    AgentInvocationLog.__table__.create(engine)
    engine.dispose()
    monkeypatch.setattr(
        config, "DATABASE_URL", f"sqlite+aiosqlite:///{database_path}"
    )
    return invocation_module.InvocationLogger(audit_logger=MagicMock())


def _write_invocation(
    monkeypatch, tmp_path, *, agent="comparison", event_type="recommend", fail=False
):
    logger = _invocation_logger(monkeypatch, tmp_path)

    if fail:
        with pytest.raises(RuntimeError, match=SENSITIVE_MARKER):
            with logger(agent=agent, event_type=event_type, model="claude"):
                raise RuntimeError(SENSITIVE_MARKER)
    else:
        with logger(agent=agent, event_type=event_type, model="claude") as record:
            record.details = {"private_text": SENSITIVE_MARKER}


def _invocation_spans(exporter):
    return [
        span
        for span in exporter.get_finished_spans()
        if span.name == "healthflow agent invocation"
    ]


@pytest.mark.asyncio
async def test_startup_exports_only_allowlisted_agent_metadata(
    monkeypatch, db_engine, tmp_path, local_logfire
):
    monkeypatch.setattr(config, "engine", db_engine)
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")

    async with main.lifespan(main.app):
        logger = _invocation_logger(monkeypatch, tmp_path)
        client = MagicMock()
        client.messages.create.return_value = Message(
            id="msg_stub",
            type="message",
            role="assistant",
            model="claude-haiku-4-5",
            stop_reason="end_turn",
            stop_sequence=None,
            content=[TextBlock(type="text", text=SENSITIVE_MARKER)],
            usage=Usage(input_tokens=10, output_tokens=20),
        )
        plan = PlanSummary(
            plan_name="Sample",
            plan_id="H0001-002",
            monthly_premium=0,
            annual_deductible=0,
            out_of_pocket_max=4000,
            star_rating=4.5,
            plan_type="HMO",
            drug_coverage=True,
        )
        agent = ComparisonAgent(
            client=client,
            audit_sink=MagicMock(),
            invocation_tracker=logger,
        )
        await asyncio.to_thread(
            agent.recommend, [plan], 65, "medium", medications=[SENSITIVE_MARKER]
        )
        with logger(agent=SENSITIVE_MARKER, event_type="recommend", model="claude"):
            pass

    spans = local_logfire.get_finished_spans()
    assert len(spans) == 1
    attributes = dict(spans[0].attributes or {})
    assert attributes["agent"] == "comparison"
    assert attributes["operation"] == "recommend"
    assert attributes["status"] == "succeeded"
    assert isinstance(attributes["duration_ms"], int)
    assert SENSITIVE_MARKER not in str(spans)
    assert not observability.is_configured()


@pytest.mark.asyncio
async def test_failed_agent_exports_status_without_exception_message(
    monkeypatch, db_engine, tmp_path, local_logfire
):
    monkeypatch.setattr(config, "engine", db_engine)
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")

    async with main.lifespan(main.app):
        _write_invocation(monkeypatch, tmp_path, fail=True)

    spans = _invocation_spans(local_logfire)
    assert len(spans) == 1
    attributes = dict(spans[0].attributes or {})
    assert attributes["status"] == "failed"
    assert SENSITIVE_MARKER not in str(attributes)
    assert not observability.is_configured()


@pytest.mark.asyncio
async def test_temporal_plan_invocation_is_visible_without_content(
    monkeypatch, db_engine, tmp_path, local_logfire
):
    monkeypatch.setattr(config, "engine", db_engine)
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")

    async with main.lifespan(main.app):
        _write_invocation(
            monkeypatch,
            tmp_path,
            agent="temporal_awareness",
            event_type="generate_plan",
        )

    spans = _invocation_spans(local_logfire)
    assert len(spans) == 1
    assert spans[0].attributes["agent"] == "temporal_awareness"
    assert SENSITIVE_MARKER not in str(spans)


@pytest.mark.asyncio
async def test_startup_without_token_exports_no_agent_events(
    monkeypatch, db_engine, tmp_path, local_logfire
):
    monkeypatch.setattr(config, "engine", db_engine)
    monkeypatch.setenv("LOGFIRE_TOKEN", "")

    async with main.lifespan(main.app):
        _write_invocation(monkeypatch, tmp_path)

    assert _invocation_spans(local_logfire) == []
    assert not observability.is_configured()


@pytest.mark.asyncio
async def test_logfire_configuration_failure_does_not_block_startup(
    monkeypatch, db_engine, caplog
):
    monkeypatch.setattr(config, "engine", db_engine)
    monkeypatch.setattr(invocation_module, "_logfire_enabled", False, raising=False)
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")

    def reject_configuration(**options):
        raise RuntimeError("test-token")

    monkeypatch.setattr(logfire, "configure", reject_configuration)

    async with main.lifespan(main.app):
        pass

    assert "Logfire agent tracing unavailable" in caplog.text
    assert "test-token" not in caplog.text
