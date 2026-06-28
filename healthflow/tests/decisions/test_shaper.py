import uuid
from datetime import datetime, timezone

from healthflow.database.models import DecisionRecord
from healthflow.decisions.shaper import to_response
from healthflow.models.schemas import DecisionRecordResponse


def _record():
    return DecisionRecord(
        id=uuid.uuid4(),
        broker_id=uuid.uuid4(),
        client_id=None,
        agent_type="compare",
        model_used="claude-haiku-4-5",
        duration_ms=1200,
        content={
            "inputs": {"zip_code": "10025", "age": 67},
            "recommended_plan": {"plan_name": "Aetna Prime"},
            "alternatives": [{"plan_name": "Bronze HSA"}],
            "recommendation_text": "Aetna Prime is the best value.",
            "basis": "Top-ranked of 8 plans compared for a medium-income profile",
        },
        created_at=datetime(2026, 6, 28, 12, 0, tzinfo=timezone.utc),
    )


def test_to_response_maps_all_fields():
    r = _record()
    resp = to_response(r)
    assert isinstance(resp, DecisionRecordResponse)
    assert resp.id == str(r.id)
    assert resp.broker_id == str(r.broker_id)
    assert resp.agent_type == "compare"
    assert resp.model_used == "claude-haiku-4-5"
    assert resp.created_at == "2026-06-28T12:00:00+00:00"
    assert resp.recommended_plan == {"plan_name": "Aetna Prime"}
    assert resp.recommendation_text == "Aetna Prime is the best value."
    assert resp.basis.startswith("Top-ranked of 8")
    assert resp.alternatives == [{"plan_name": "Bronze HSA"}]
    assert resp.inputs == {"zip_code": "10025", "age": 67}


def test_to_response_tolerates_empty_content():
    r = _record()
    r.content = {}
    resp = to_response(r)
    assert resp.recommended_plan == {}
    assert resp.alternatives == []
    assert resp.recommendation_text == ""
