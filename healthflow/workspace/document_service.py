"""Broker-scoped private Documents and durable file-access events."""

import asyncio
import logging
from urllib.parse import quote
from typing import Literal
from uuid import UUID, uuid4

import anyio
from fastapi import HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from healthflow.database.config import async_session_factory
from healthflow.database.models import Appeal, Client, Document, DocumentEvent, DocumentLink, Enrollment, Issue, _utcnow
from healthflow.workspace.document_storage import DocumentStorage
from healthflow.workspace.linking import lock_document_target
from healthflow.workspace.document_validation import (
    CONTENT_TYPES, DocumentTooLarge, InvalidDocumentType, validate_upload,
)

logger = logging.getLogger(__name__)
DEFAULT_MAX_BYTES = 20 * 1024 * 1024
TargetType = Literal["enrollment", "issue", "appeal"]


def _active_link_conflict(error: IntegrityError, target_type: TargetType) -> bool:
    """Only the specific active association index is a duplicate Link."""
    expected = f"uq_document_links_active_{target_type}"
    original = error.orig
    for cause in (original, getattr(original, "__cause__", None)):
        if cause is None:
            continue
        name = getattr(cause, "constraint_name", None)
        diagnostic = getattr(cause, "diag", None)
        if name == expected or getattr(diagnostic, "constraint_name", None) == expected:
            return True
    return str(original) == (
        f"UNIQUE constraint failed: document_links.document_id, document_links.{target_type}_id"
    )


class AuditedDocumentResponse(StreamingResponse):
    """Completion means ASGI send finished, never proof of client consumption."""

    def __init__(self, body, finish, **kwargs):
        self.storage_body = body
        self.finish = finish

        async def chunks():
            while chunk := await run_in_threadpool(body.read, 65536):
                yield chunk

        super().__init__(chunks(), **kwargs)

    async def __call__(self, scope, receive, send):
        completed = False

        async def observed_send(message):
            nonlocal completed
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                completed = True

        try:
            await super().__call__(scope, receive, observed_send)
        finally:
            # Starlette may cancel the stream task on disconnect. Final audit
            # uses its own session, independent of request dependency teardown.
            with anyio.CancelScope(shield=True):
                try:
                    await run_in_threadpool(self.storage_body.close)
                except Exception:
                    logger.error("document_body_close_failed")
                await self.finish("completed" if completed else "failed")


class DocumentService:
    def __init__(self, storage: DocumentStorage | None, *, session_factory=async_session_factory,
                 upload_enabled=False, max_bytes=DEFAULT_MAX_BYTES):
        self.storage = storage
        self.session_factory = session_factory
        self.upload_enabled = upload_enabled
        self.max_bytes = max_bytes

    @staticmethod
    def event(broker_id, client_id, document_id, action, outcome):
        return DocumentEvent(broker_id=broker_id, actor_id=broker_id, actor_kind="broker",
                             client_id=client_id, document_id=document_id,
                             action=action, outcome=outcome)

    async def _outcome(self, broker_id, client_id, document_id, outcome):
        try:
            async with self.session_factory() as session:
                session.add(self.event(broker_id, client_id, document_id, "open", outcome))
                await session.commit()
        except Exception:
            # Protected bytes may already have been sent. The durable started
            # row remains an attempt, not a completion. Never log exceptions
            # that can carry filenames, provider credentials, or response data.
            logger.error("document_outcome_audit_failed document_id=%s outcome=%s", document_id, outcome)

    async def owned_client(self, db, broker_id, client_id):
        client = (await db.execute(select(Client).where(
            Client.id == client_id, Client.broker_id == broker_id,
        ))).scalar_one_or_none()
        if client is None:
            raise HTTPException(404, "Client not found")
        return client

    async def owned_document(self, db, broker_id, document_id, *, lock=False):
        statement = select(Document).join(Client, Document.client_id == Client.id).where(
            Document.id == document_id, Document.broker_id == broker_id, Client.broker_id == broker_id,
        )
        if lock:
            statement = statement.with_for_update(of=Document)
        document = (await db.execute(statement)).scalar_one_or_none()
        if document is None:
            raise HTTPException(404, "Document not found")
        return document

    async def target_client(self, db, broker_id, target_type: TargetType, target_id):
        if target_type == "appeal":
            statement = select(Client).join(Issue, Issue.client_id == Client.id).join(
                Appeal, Appeal.issue_id == Issue.id,
            ).where(Appeal.id == target_id, Appeal.broker_id == broker_id, Issue.broker_id == broker_id)
        else:
            model = {"enrollment": Enrollment, "issue": Issue}[target_type]
            statement = select(Client).join(model, model.client_id == Client.id).where(
                model.id == target_id, model.broker_id == broker_id,
            )
        client = (await db.execute(statement.where(Client.broker_id == broker_id))).scalar_one_or_none()
        if client is None:
            raise HTTPException(404, "Document not found")
        return client

    async def _commit_transition(self, db, *, target_type=None):
        try:
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            if target_type and _active_link_conflict(error, target_type):
                raise HTTPException(409, "Document already linked to this record") from None
            raise HTTPException(503, "Document update unavailable; retry later") from None
        except Exception:
            await db.rollback()
            raise HTTPException(503, "Document update unavailable; retry later") from None

    async def link(self, db, broker_id, document_id, target_type: TargetType, target_id):
        await lock_document_target(db, broker_id, target_type, target_id)
        document = await self.owned_document(db, broker_id, document_id, lock=True)
        client = await self.target_client(db, broker_id, target_type, target_id)
        if client.id != document.client_id:
            raise HTTPException(404, "Document not found")
        if client.archived_at is not None:
            raise HTTPException(409, "Restore Client before linking Documents")
        if document.archived_at is not None:
            raise HTTPException(409, "Restore Document before linking")
        link = DocumentLink(broker_id=broker_id, client_id=document.client_id, document_id=document.id,
                            **{f"{target_type}_id": target_id})
        db.add(link)
        db.add(self.event(broker_id, document.client_id, document.id, "link", "success"))
        await self._commit_transition(db, target_type=target_type)
        return link

    async def unlink(self, db, broker_id, document_id, link_id):
        document = await self.owned_document(db, broker_id, document_id, lock=True)
        link = (await db.execute(select(DocumentLink).where(
            DocumentLink.id == link_id, DocumentLink.document_id == document.id,
            DocumentLink.broker_id == broker_id, DocumentLink.client_id == document.client_id,
        ))).scalar_one_or_none()
        if link is None:
            raise HTTPException(404, "Document not found")
        if link.ended_at is None:
            link.ended_at = _utcnow()
            db.add(self.event(broker_id, document.client_id, document.id, "unlink", "success"))
            await self._commit_transition(db)

    async def set_archived(self, db, broker_id, document_id, archived: bool):
        document = await self.owned_document(db, broker_id, document_id, lock=True)
        if (document.archived_at is not None) != archived:
            document.archived_at = _utcnow() if archived else None
            db.add(self.event(broker_id, document.client_id, document.id,
                              "archive" if archived else "restore", "success"))
            await self._commit_transition(db)
        return document

    async def links(self, db, broker_id, document_id, include_ended=False):
        document = await self.owned_document(db, broker_id, document_id)
        if not include_ended and document.archived_at is not None:
            return []
        statement = select(DocumentLink).where(
            DocumentLink.document_id == document.id, DocumentLink.broker_id == broker_id,
            DocumentLink.client_id == document.client_id,
        )
        if not include_ended:
            statement = statement.where(DocumentLink.ended_at.is_(None))
        return (await db.execute(statement.order_by(DocumentLink.created_at, DocumentLink.id))).scalars().all()

    async def for_target(self, db, broker_id, target_type: TargetType, target_id):
        client = await self.target_client(db, broker_id, target_type, target_id)
        return (await db.execute(select(Document).join(
            DocumentLink, DocumentLink.document_id == Document.id,
        ).where(
            Document.broker_id == broker_id, Document.client_id == client.id, Document.archived_at.is_(None),
            DocumentLink.broker_id == broker_id, DocumentLink.client_id == client.id,
            DocumentLink.ended_at.is_(None), getattr(DocumentLink, f"{target_type}_id") == target_id,
        ).order_by(Document.created_at.desc()))).scalars().all()

    async def upload(self, db: AsyncSession, broker_id: UUID, client_id: UUID,
                     file: UploadFile) -> Document:
        if not self.upload_enabled:
            raise HTTPException(503, "Document uploads are disabled")
        client = await self.owned_client(db, broker_id, client_id)
        if client.archived_at is not None:
            raise HTTPException(409, "Restore Client before uploading Documents")
        if self.storage is None:
            raise HTTPException(503, "Document storage unavailable")
        try:
            # Task 4's validator is async for UploadFile reads but its parsers
            # and temp-file I/O are synchronous. Run the whole owned operation
            # in a worker, including its private event loop, off the API loop.
            validated = await run_in_threadpool(lambda: asyncio.run(validate_upload(file, self.max_bytes)))
        except DocumentTooLarge:
            raise HTTPException(413, "Document too large") from None
        except InvalidDocumentType:
            raise HTTPException(422, "Unsupported or malformed Document") from None
        key = str(uuid4())
        document = Document(id=uuid4(), broker_id=broker_id, client_id=client_id,
                            display_filename=validated.display_filename,
                            verified_type=validated.verified_type, byte_length=validated.byte_length,
                            object_key=key)
        try:
            await run_in_threadpool(self.storage.put, key, validated.stream, validated.content_type)
            db.add(document)
            db.add(self.event(broker_id, client_id, document.id, "upload", "success"))
            await db.commit()
        except BaseException as error:
            with anyio.CancelScope(shield=True):
                try:
                    await db.rollback()
                except Exception:
                    logger.error("document_upload_rollback_failed document_id=%s", document.id)
                try:
                    # Even a failed PUT may have left an object behind.
                    await run_in_threadpool(self.storage.remove, key)
                except Exception:
                    logger.error("document_cleanup_failed object_key=%s", key)
            if not isinstance(error, Exception):
                raise
            raise HTTPException(503, "Document upload unavailable; retry later") from None
        finally:
            validated.stream.close()
        return document

    async def open(self, db: AsyncSession, broker_id: UUID, document_id: UUID) -> StreamingResponse:
        try:
            document = await self.owned_document(db, broker_id, document_id)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            # Release the request's read-audit transaction before the independent
            # durable write (required for SQLite). Never look up foreign metadata.
            await db.rollback()
            await self._outcome(broker_id, None, document_id, "denied")
            raise
        client_id, key = document.client_id, document.object_key
        kind, filename = document.verified_type, document.display_filename
        db.add(self.event(broker_id, client_id, document_id, "open", "started"))
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            raise HTTPException(503, "Document audit unavailable; retry later") from None
        try:
            if self.storage is None:
                raise OSError("Storage unavailable")
            body = await run_in_threadpool(self.storage.get, key)
        except Exception:
            await self._outcome(broker_id, client_id, document_id, "failed")
            raise HTTPException(503, "Document content unavailable; retry later") from None
        disposition = "inline" if kind in {"pdf", "jpeg", "png"} else "attachment"
        return AuditedDocumentResponse(
            body, lambda outcome: self._outcome(broker_id, client_id, document_id, outcome),
            media_type=CONTENT_TYPES[kind], headers={
                "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename, safe='')}",
                "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
            },
        )
