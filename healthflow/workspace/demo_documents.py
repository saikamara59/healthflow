"""Trusted checked-in synthetic fixtures; never an HTTP upload bypass."""
import logging
import os
from pathlib import Path
from uuid import uuid4, uuid5

from fastapi import UploadFile
from sqlalchemy import delete, select

from healthflow.auth.tenant_context import current_broker_id, system_context
from healthflow.database.models import Broker, Client, Document, DocumentEvent, DocumentLink
from healthflow.workspace.document_validation import validate_upload

logger = logging.getLogger(__name__)
DEMO_EMAIL = "demo@healthflow.work"
FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "demo_documents"
FIXTURES = {
    "synthetic-summary-v1": "synthetic-summary.pdf",
    "synthetic-card-v1": "synthetic-card.jpg",
    "synthetic-notice-v1": "synthetic-notice.png",
}
DEMO_FIXTURE_MARKERS = tuple(FIXTURES)


def exact_markers(fixture_ids):
    if not isinstance(fixture_ids, (list, tuple)) or not fixture_ids:
        raise ValueError("Explicit demo fixture markers required")
    if any(not isinstance(marker, str) or marker not in FIXTURES for marker in fixture_ids):
        raise ValueError("Unknown demo fixture")
    return tuple(dict.fromkeys(fixture_ids))


async def _demo_broker(session, broker_id):
    if os.getenv("SEED_DEMO") != "1":
        raise PermissionError("Demo operations require SEED_DEMO=1")
    broker = (await session.scalars(select(Broker).where(Broker.id == broker_id))).one_or_none()
    if broker is None or broker.email != DEMO_EMAIL or broker.role != "broker":
        raise PermissionError("Expected the non-privileged demo Broker")


def _event(document, action, outcome, actor_id=None):
    return DocumentEvent(broker_id=document.broker_id, client_id=document.client_id,
                         document_id=document.id, actor_id=actor_id,
                         actor_kind="broker" if actor_id else "system", action=action, outcome=outcome)


async def seed_demo_documents(session, storage, broker_id, *, fixture_ids=DEMO_FIXTURE_MARKERS) -> int:
    """Commit absent fixtures; archived Documents and Clients remain untouched."""
    markers = exact_markers(fixture_ids)
    await _demo_broker(session, broker_id)
    existing_markers = set((await session.scalars(select(Document.demo_fixture_marker).where(
        Document.broker_id == broker_id, Document.demo_fixture_marker.in_(markers),
    ))).all())
    missing = [marker for marker in markers if marker not in existing_markers]
    if not missing:
        return 0
    clients = (await session.scalars(select(Client).where(Client.broker_id == broker_id))).all()
    client = next((row for row in clients if row.full_name == "Eleanor Rigby"), None)
    if client is None:
        raise ValueError("Seed the synthetic demo Client first")
    if client.archived_at is not None:
        return 0
    created = 0
    for marker in missing:
        with (FIXTURE_ROOT / FIXTURES[marker]).open("rb") as source:
            validated = await validate_upload(UploadFile(file=source, filename=FIXTURES[marker]), 20 * 1024 * 1024)
        document = Document(id=uuid5(broker_id, marker), broker_id=broker_id, client_id=client.id,
                            demo_fixture_marker=marker, display_filename=validated.display_filename,
                            verified_type=validated.verified_type, byte_length=validated.byte_length,
                            object_key=str(uuid4()))
        key = document.object_key
        try:
            storage.put(key, validated.stream, validated.content_type)
            session.add_all([document, _event(document, "seed", "success")])
            await session.commit()
        except BaseException:
            await session.rollback()
            try:
                storage.remove(key)
            except Exception:
                logger.error("demo_seed_cleanup_failed")
            raise
        finally:
            validated.stream.close()
        created += 1
    return created


async def reset_demo_documents(session, storage, broker_id, fixture_ids) -> int:
    """Admin-only exact metadata/object removal; retain historical audit rows.

    The CLI authenticates the admin and sets current_broker_id. A durable
    started event precedes storage removal; failed/interrupted operations can
    be retried with the same markers (remove is idempotent).
    """
    markers = exact_markers(fixture_ids)
    actor_id = current_broker_id.get()
    actor = (await session.scalars(select(Broker).where(Broker.id == actor_id))).one_or_none() if actor_id else None
    if actor is None or actor.role != "admin" or not actor.is_active:
        raise PermissionError("An authenticated active administrator is required")
    with system_context("exact demo Document administrator reset"):
        await _demo_broker(session, broker_id)
        documents = (await session.scalars(select(Document).where(
            Document.broker_id == broker_id, Document.demo_fixture_marker.in_(markers),
        ))).all()
        for document in documents:
            session.add(_event(document, "demo_reset", "started", actor_id))
            await session.commit()
            try:
                storage.remove(document.object_key)
                await session.execute(delete(DocumentLink).where(
                    DocumentLink.broker_id == broker_id, DocumentLink.document_id == document.id,
                ))
                session.add(_event(document, "demo_reset", "success", actor_id))
                await session.delete(document)
                await session.commit()
            except BaseException:
                await session.rollback()
                raise
        return len(documents)
