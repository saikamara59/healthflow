import uuid
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from healthflow.auth.security import create_access_token
from healthflow.main import app

client = TestClient(app)
_BODY = {"zip_code": "10001", "age": 65, "income_level": "low",
         "medications": ["Metformin"], "procedures": []}


@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.ComparisonAgent")
def test_compare_returns_decision_id_when_recorder_captures(mock_agent_cls, mock_recorder):
    mock_agent = MagicMock()
    mock_agent.recommend.return_value = "Plan A is the best value."
    mock_agent_cls.return_value = mock_agent
    known = uuid.uuid4()
    mock_recorder.record_compare_decision.return_value = known

    token = create_access_token({"sub": str(uuid.uuid4()), "type": "access"})
    resp = client.post("/compare", json=_BODY, headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.json()["decision_id"] == str(known)
    _, kwargs = mock_recorder.record_compare_decision.call_args
    assert kwargs["broker_id"] is not None
    assert kwargs["recommendation_text"] == "Plan A is the best value."
    assert kwargs["model_used"]  # non-empty model string


@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.ComparisonAgent")
def test_compare_decision_id_null_when_anonymous(mock_agent_cls, mock_recorder):
    mock_agent = MagicMock()
    mock_agent.recommend.return_value = "Plan A is the best value."
    mock_agent_cls.return_value = mock_agent
    mock_recorder.record_compare_decision.return_value = None

    resp = client.post("/compare", json=_BODY)  # no Authorization header

    assert resp.status_code == 200
    assert resp.json()["decision_id"] is None
    _, kwargs = mock_recorder.record_compare_decision.call_args
    assert kwargs["broker_id"] is None
