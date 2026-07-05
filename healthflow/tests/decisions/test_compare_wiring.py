import uuid
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from healthflow.main import app

client = TestClient(app)
_BODY = {"zip_code": "10001", "age": 65, "income_level": "low",
         "medications": ["Metformin"], "procedures": []}


@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.build_comparison_agent")
def test_compare_threads_decision_id_from_recorder(mock_agent_cls, mock_recorder):
    mock_agent = MagicMock()
    mock_agent.recommend.return_value = "Plan A is the best value."
    mock_agent_cls.return_value = mock_agent
    known = uuid.uuid4()
    mock_recorder.record_compare_decision.return_value = known

    resp = client.post("/compare", json=_BODY)

    assert resp.status_code == 200
    assert resp.json()["decision_id"] == str(known)
    # the handler passes the FILTERED recommendation (with disclaimer appended),
    # so assert the mock text is contained in it
    _, kwargs = mock_recorder.record_compare_decision.call_args
    assert "Plan A is the best value." in kwargs["recommendation_text"]
    assert kwargs["model_used"]  # non-empty model string
    assert "broker_id" in kwargs  # the handler passes broker_id (value comes from context)


@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.build_comparison_agent")
def test_compare_decision_id_null_when_recorder_returns_none(mock_agent_cls, mock_recorder):
    mock_agent = MagicMock()
    mock_agent.recommend.return_value = "Plan A is the best value."
    mock_agent_cls.return_value = mock_agent
    mock_recorder.record_compare_decision.return_value = None

    resp = client.post("/compare", json=_BODY)

    assert resp.status_code == 200
    assert resp.json()["decision_id"] is None
