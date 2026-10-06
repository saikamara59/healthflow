"""Authenticated Document metadata/content and bounded multipart intake."""

import os
import re
from datetime import datetime
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.formparsers import MultiPartException
from starlette.responses import JSONResponse

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker, Document
from healthflow.workspace.document_service import DEFAULT_MAX_BYTES, DocumentService, TargetType
from healthflow.workspace.document_storage import LocalDocumentStorage, S3DocumentStorage

documents_router = APIRouter(tags=["documents"])


def configure_documents(app):
    """Resolve deployment configuration once, before startup accepts traffic."""
    enabled = os.getenv("DOCUMENT_UPLOAD_ENABLED", "false").lower() in {"1", "true", "yes"}
    if enabled and os.getenv("SEED_DEMO") == "1":
        raise ValueError("SEED_DEMO=1 is incompatible with DOCUMENT_UPLOAD_ENABLED")
    max_bytes = int(os.getenv("DOCUMENT_MAX_BYTES", str(DEFAULT_MAX_BYTES)))
    if max_bytes < 1:
        raise ValueError("DOCUMENT_MAX_BYTES must be positive")
    storage = None
    if os.getenv("DOCUMENT_STORAGE_BUCKET"):
        storage = S3DocumentStorage.from_environment()
    elif os.getenv("DOCUMENT_STORAGE_DIRECTORY"):
        storage = LocalDocumentStorage(Path(os.environ["DOCUMENT_STORAGE_DIRECTORY"]))
    app.state.document_service = DocumentService(storage, upload_enabled=enabled, max_bytes=max_bytes)
    app.state.document_max_bytes = max_bytes


def get_document_service(request: Request) -> DocumentService:
    # ASGI unit tests may omit lifespan; the fallback must remain fail-closed.
    return getattr(request.app.state, "document_service", DocumentService(None))


class DocumentUploadLimitMiddleware:
    """Count actual receive bytes before multipart parsing/spooling consumes them."""

    def __init__(self, app, max_bytes=None):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if (scope["type"] != "http" or scope["method"] != "POST"
                or not re.fullmatch(r"/clients/[^/]+/documents/?", scope["path"])):
            return await self.app(scope, receive, send)
        maximum = self.max_bytes
        if maximum is None:
            maximum = getattr(scope["app"].state, "document_max_bytes", DEFAULT_MAX_BYTES)
        limit, received, exceeded = maximum + 65536, 0, False

        async def bounded_receive():
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    # Starlette catches this specific exception and closes all
                    # partial upload spools before FastAPI produces its 400.
                    raise MultiPartException("Document request too large")
            return message

        async def bounded_send(message):
            if not exceeded:
                await send(message)

        try:
            await self.app(scope, bounded_receive, bounded_send)
        except MultiPartException:
            if not exceeded:
                raise
        if exceeded:
            await JSONResponse({"detail": "Document request too large"}, status_code=413)(scope, receive, send)


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    client_id: UUID
    display_filename: str
    verified_type: str
    byte_length: int
    created_at: datetime
    archived_at: datetime | None


class LinkRequest(BaseModel):
    target_type: TargetType
    target_id: UUID


class LinkResponse(BaseModel):
    id: UUID
    document_id: UUID
    target_type: TargetType
    target_id: UUID
    created_at: datetime
    ended_at: datetime | None


def _link_response(link):
    kind = next(kind for kind in ("enrollment", "issue", "appeal") if getattr(link, f"{kind}_id") is not None)
    return LinkResponse(id=link.id, document_id=link.document_id, target_type=kind,
                        target_id=getattr(link, f"{kind}_id"), created_at=link.created_at, ended_at=link.ended_at)


@documents_router.get("/documents", response_model=list[DocumentResponse])
async def target_documents(target_type: TargetType, target_id: UUID,
                           broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db),
                           service: DocumentService = Depends(get_document_service)):
    return await service.for_target(db, broker.id, target_type, target_id)


@documents_router.post("/documents/{document_id}/links", response_model=LinkResponse, status_code=201)
async def link_document(document_id: UUID, body: LinkRequest,
                        broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db),
                        service: DocumentService = Depends(get_document_service)):
    return _link_response(await service.link(db, broker.id, document_id, body.target_type, body.target_id))


@documents_router.get("/documents/{document_id}/links", response_model=list[LinkResponse])
async def document_links(document_id: UUID, include_ended: bool = False,
                         broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db),
                         service: DocumentService = Depends(get_document_service)):
    return [_link_response(link) for link in await service.links(db, broker.id, document_id, include_ended)]


@documents_router.delete("/documents/{document_id}/links/{link_id}", status_code=204)
async def unlink_document(document_id: UUID, link_id: UUID,
                          broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db),
                          service: DocumentService = Depends(get_document_service)):
    await service.unlink(db, broker.id, document_id, link_id)
    return Response(status_code=204)


@documents_router.post("/documents/{document_id}/archive", response_model=DocumentResponse)
async def archive_document(document_id: UUID,
                           broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db),
                           service: DocumentService = Depends(get_document_service)):
    return await service.set_archived(db, broker.id, document_id, True)


@documents_router.post("/documents/{document_id}/restore", response_model=DocumentResponse)
async def restore_document(document_id: UUID,
                           broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db),
                           service: DocumentService = Depends(get_document_service)):
    return await service.set_archived(db, broker.id, document_id, False)


@documents_router.get("/documents/capabilities")
async def capabilities(broker: Broker = Depends(get_current_broker),
                       service: DocumentService = Depends(get_document_service)):
    return {"upload_enabled": service.upload_enabled}


@documents_router.post("/clients/{client_id}/documents", response_model=DocumentResponse, status_code=201)
async def upload_document(client_id: UUID, file: UploadFile = File(...),
                          broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db),
                          service: DocumentService = Depends(get_document_service)):
    return await service.upload(db, broker.id, client_id, file)


@documents_router.get("/clients/{client_id}/documents", response_model=list[DocumentResponse])
async def list_documents(client_id: UUID, broker: Broker = Depends(get_current_broker),
                         db: AsyncSession = Depends(get_db),
                         service: DocumentService = Depends(get_document_service)):
    await service.owned_client(db, broker.id, client_id)
    return (await db.execute(select(Document).where(
        Document.broker_id == broker.id, Document.client_id == client_id, Document.archived_at.is_(None),
    ).order_by(Document.created_at.desc()))).scalars().all()


@documents_router.get("/documents/active", response_model=list[DocumentResponse])
async def active_documents(broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(Document).where(
        Document.broker_id == broker.id, Document.archived_at.is_(None),
    ).order_by(Document.created_at.desc()))).scalars().all()


@documents_router.get("/documents/archived", response_model=list[DocumentResponse])
async def archived_documents(broker: Broker = Depends(get_current_broker), db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(Document).where(
        Document.broker_id == broker.id, Document.archived_at.is_not(None),
    ).order_by(Document.created_at.desc()))).scalars().all()


@documents_router.get("/documents/{document_id}/content")
async def open_document(document_id: UUID, broker: Broker = Depends(get_current_broker),
                        db: AsyncSession = Depends(get_db),
                        service: DocumentService = Depends(get_document_service)):
    return await service.open(db, broker.id, document_id)
