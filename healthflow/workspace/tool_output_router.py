"""Save Draft Appeal or Explain Coverage output as a protected Document.

Tool output is temporary. It becomes a Document only when the Broker picks the
related Client, reviews the text, and confirms. The text is never sent to a model
here, so the pseudonym rule for Ask HealthFlow (ADR 0004) does not apply.
"""

import re
from io import BytesIO
from typing import Literal
from uuid import UUID
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.api.documents_router import DocumentResponse, get_document_service
from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker
from healthflow.workspace.document_service import DocumentService

output_router = APIRouter(prefix="/tool-output", tags=["tool-output"])

# The frontend reads the same limit so a Broker never reaches a save that must fail.
MAX_OUTPUT_LENGTH = 20_000

LABELS = {
    "draft_appeal": "Draft Appeal output",
    "explain_coverage": "Explain Coverage output",
}

# XML 1.0 allows tab, newline, carriage return, and most of the rest of Unicode.
# Anything else (NUL, other control characters, U+FFFE/U+FFFF, lone surrogates)
# makes document.xml malformed, so the Document validator would reject the file.
_XML_FORBIDDEN = re.compile("[^\t\n\r\x20-퟿-�\U00010000-\U0010ffff]")


class SaveOutputRequest(BaseModel):
    source: Literal["draft_appeal", "explain_coverage"]
    client_id: UUID
    text: str = Field(min_length=1, max_length=MAX_OUTPUT_LENGTH)
    confirmed: bool = False


def _docx(title: str, text: str) -> bytes:
    """Build a minimal Word Document. The Document service still validates every byte."""
    lines = [title, "", *_XML_FORBIDDEN.sub("", text).splitlines()]
    paragraphs = "".join(
        '<w:p><w:r><w:t xml:space="preserve">' + escape(line or " ") + "</w:t></w:r></w:p>"
        for line in lines
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>" + paragraphs + "</w:body></w:document>"
    )
    relationships = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/></Relationships>'
    )
    stream = BytesIO()
    with ZipFile(stream, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document)
    return stream.getvalue()


@output_router.post("/documents", response_model=DocumentResponse, status_code=201)
async def save_output_document(
    data: SaveOutputRequest,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
    service: DocumentService = Depends(get_document_service),
):
    if not data.confirmed:
        raise HTTPException(409, "Review and confirm before saving a Document")
    if not data.text.strip():
        raise HTTPException(422, "Document text cannot be blank")
    file = UploadFile(
        file=BytesIO(_docx(LABELS[data.source], data.text)),
        filename=f"{data.source.replace('_', '-')}.docx",
    )
    try:
        # DocumentService checks the Broker owns the Client, validates the file,
        # stores it privately, and records the upload in the Document audit log.
        return await service.upload(db, broker.id, data.client_id, file)
    finally:
        await file.close()
