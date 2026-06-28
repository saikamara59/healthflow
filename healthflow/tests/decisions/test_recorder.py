import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from healthflow.auth.tenant_context import system_context
from healthflow.database.models import Base, DecisionRecord
from healthflow.decisions.recorder import DecisionRecorder

INPUTS = {"zip_code": "10025", "age": 67, "income_level": "medium",
          "medications": ["metformin"], "procedures": []}
PLAN = {"plan_name": "Aetna Prime", "plan_id": "p1"}


def test_returns_none_when_broker_is_none():
    rec = DecisionRecorder()
    result = rec.record_compare_decision(
        broker_id=None, client_id=None, inputs=INPUTS,
        recommended_plan=PLAN, alternatives=[], recommendation_text="x",
        basis="b", model_used="m", duration_ms=1,
    )
    assert result is None
    assert rec._engine is None  # never created an engine


@pytest.fixture
def rec_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'dec.db'}")
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def recorder(rec_engine, monkeypatch):
    r = DecisionRecorder()
    monkeypatch.setattr(r, "_engine", rec_engine)
    return r


def test_writes_row_and_content_round_trips(recorder, rec_engine):
    broker_id = uuid.uuid4()
    decision_id = recorder.record_compare_decision(
        broker_id=broker_id, client_id=None, inputs=INPUTS,
        recommended_plan=PLAN, alternatives=[{"plan_name": "Bronze"}],
        recommendation_text="Aetna Prime is best.", basis="ranked 2 plans",
        model_used="claude-haiku-4-5", duration_ms=900,
    )
    assert isinstance(decision_id, uuid.UUID)
    with system_context("test verify"), Session(rec_engine) as s:
        row = s.execute(select(DecisionRecord).where(DecisionRecord.id == decision_id)).scalar_one()
    assert row.broker_id == broker_id
    assert row.agent_type == "compare"
    assert row.model_used == "claude-haiku-4-5"
    assert row.content["inputs"] == INPUTS
    assert row.content["recommended_plan"] == PLAN
    assert row.content["recommendation_text"] == "Aetna Prime is best."
    assert row.content["alternatives"] == [{"plan_name": "Bronze"}]


def test_write_failure_returns_none_and_does_not_raise(monkeypatch):
    rec = DecisionRecorder()
    class _BoomEngine:
        pass
    monkeypatch.setattr(rec, "_engine", _BoomEngine())  # Session() will fail on this
    result = rec.record_compare_decision(
        broker_id=uuid.uuid4(), client_id=None, inputs=INPUTS,
        recommended_plan=PLAN, alternatives=[], recommendation_text="x",
        basis="b", model_used="m", duration_ms=1,
    )
    assert result is None
