import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from healthflow.main import app

client = TestClient(app)
# These tests cover what the route does; who may call it is in test_sign_in_required.py.
pytestmark = pytest.mark.usefixtures("signed_in")


@patch("healthflow.api.routes.build_cost_calculator_agent")
@patch("healthflow.api.routes.build_comparison_agent")
def test_compare_then_calculate_flow(mock_compare_cls, mock_calc_cls):
    """End-to-end: /compare → get session_id → /calculate with session_id"""
    mock_compare = MagicMock()
    mock_compare.recommend.return_value = "Plan A is best."
    mock_compare_cls.return_value = mock_compare

    compare_resp = client.post(
        "/compare",
        json={"zip_code": "10001", "age": 65, "income_level": "low"},
    )
    assert compare_resp.status_code == 200
    session_id = compare_resp.json()["session_id"]

    mock_calc = MagicMock()
    mock_calc.calculate.return_value = ([], "Cheapest plan saves $500.")
    mock_calc_cls.return_value = mock_calc

    calc_resp = client.post(
        "/calculate",
        json={
            "session_id": session_id,
            "usage": {
                "doctor_visits_per_year": 12,
                "prescriptions": [{"name": "Metformin", "fills_per_year": 12}],
                "procedures": [{"name": "Blood work", "count": 4}],
            },
        },
    )
    assert calc_resp.status_code == 200
    data = calc_resp.json()
    assert data["session_id"] == session_id
    assert "recommendation" in data


@patch("healthflow.api.routes.build_cost_calculator_agent")
def test_calculate_standalone_with_full_usage(mock_agent_cls):
    """Standalone /calculate with prescriptions and procedures."""
    mock_agent = MagicMock()
    mock_agent.calculate.return_value = ([], "Recommendation text.")
    mock_agent_cls.return_value = mock_agent

    response = client.post(
        "/calculate",
        json={
            "zip_code": "90210",
            "income_level": "high",
            "usage": {
                "doctor_visits_per_year": 24,
                "prescriptions": [
                    {"name": "Metformin", "fills_per_year": 12},
                    {"name": "Ozempic", "fills_per_year": 12},
                ],
                "procedures": [
                    {"name": "MRI", "count": 2},
                    {"name": "Blood work", "count": 4},
                ],
            },
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "recommendation" in data
    assert "disclaimer" in data


@patch("healthflow.api.routes.build_cost_calculator_agent")
def test_calculate_output_filtered(mock_agent_cls):
    """Verify medical advice is filtered from calculator output."""
    mock_agent = MagicMock()
    mock_agent.calculate.return_value = (
        [],
        "Plan A is cheapest. You should take Metformin twice daily.",
    )
    mock_agent_cls.return_value = mock_agent

    response = client.post(
        "/calculate",
        json={
            "zip_code": "10001",
            "income_level": "low",
            "usage": {"doctor_visits_per_year": 6},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "you should take" not in data["recommendation"].lower()
