from healthflow.database.models import DecisionRecord
from healthflow.models.schemas import DecisionRecordResponse


def to_response(record: DecisionRecord) -> DecisionRecordResponse:
    """Map a (decrypted) DecisionRecord row to the broker-facing response.

    Pure — no I/O. `record.content` is the decrypted dict (the EncryptedJSON
    column decrypts on load). Tolerates a missing/partial content blob.
    """
    content = record.content or {}
    return DecisionRecordResponse(
        id=str(record.id),
        created_at=record.created_at.isoformat(),
        agent_type=record.agent_type,
        model_used=record.model_used,
        broker_id=str(record.broker_id),
        recommended_plan=content.get("recommended_plan", {}),
        recommendation_text=content.get("recommendation_text", ""),
        basis=content.get("basis", ""),
        alternatives=content.get("alternatives", []),
        inputs=content.get("inputs", {}),
    )
