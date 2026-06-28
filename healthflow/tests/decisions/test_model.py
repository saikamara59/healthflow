from healthflow.database.models import DecisionRecord
from healthflow.database.tenant_filter import TENANT_SCOPED_MODELS


def test_decision_record_table_and_columns():
    assert DecisionRecord.__tablename__ == "decision_records"
    cols = DecisionRecord.__table__.columns
    for name in ("id", "broker_id", "client_id", "agent_type",
                 "model_used", "duration_ms", "content", "created_at"):
        assert name in cols, f"missing column {name}"
    assert cols["client_id"].nullable is True
    assert cols["broker_id"].nullable is False


def test_decision_record_is_tenant_scoped():
    assert DecisionRecord in TENANT_SCOPED_MODELS
