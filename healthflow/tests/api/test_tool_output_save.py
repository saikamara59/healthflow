"""Draft Appeal and Explain Coverage output becomes a protected Document only after confirmation."""

from io import BytesIO
from zipfile import ZipFile

import pytest

from healthflow.api.documents_router import get_document_service
from healthflow.main import app
from healthflow.tests.api.test_enrollments import _client_record, _headers
from healthflow.workspace.document_service import DocumentService
from healthflow.workspace.document_storage import FakeDocumentStorage
from healthflow.workspace.tool_output_router import MAX_OUTPUT_LENGTH, _docx


@pytest.fixture
def storage(db_session_factory):
    storage = FakeDocumentStorage()
    app.dependency_overrides[get_document_service] = lambda: DocumentService(
        storage, session_factory=db_session_factory, upload_enabled=True,
    )
    yield storage
    app.dependency_overrides.pop(get_document_service, None)


def _payload(client_id: str, **overrides) -> dict:
    return {
        "source": "draft_appeal",
        "client_id": client_id,
        "text": "Dear Reviewer,\nPlease reconsider the MRI denial.",
        "confirmed": True,
        **overrides,
    }


@pytest.mark.asyncio
async def test_saving_output_requires_a_signed_in_broker(client, storage):
    owner = await _headers(client, "save-output-anon@example.com")
    record = await _client_record(client, owner, "Synthetic Client")

    response = await client.post("/tool-output/documents", json=_payload(record["id"]))

    assert response.status_code == 401
    assert not storage._objects


@pytest.mark.asyncio
async def test_unconfirmed_output_is_not_saved(client, storage):
    owner = await _headers(client, "save-output-unconfirmed@example.com")
    record = await _client_record(client, owner, "Synthetic Client")

    response = await client.post(
        "/tool-output/documents", headers=owner, json=_payload(record["id"], confirmed=False),
    )

    assert response.status_code == 409
    assert not storage._objects


@pytest.mark.asyncio
async def test_output_cannot_be_saved_to_another_brokers_client(client, storage):
    owner = await _headers(client, "save-output-owner@example.com")
    other = await _headers(client, "save-output-other@example.com")
    record = await _client_record(client, owner, "Synthetic Client")

    response = await client.post("/tool-output/documents", headers=other, json=_payload(record["id"]))

    assert response.status_code == 404
    assert not storage._objects


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["draft_appeal", "explain_coverage"])
async def test_confirmed_output_is_saved_as_a_word_document_on_the_client(client, storage, source):
    owner = await _headers(client, f"save-output-{source}@example.com")
    record = await _client_record(client, owner, "Synthetic Client")

    saved = await client.post(
        "/tool-output/documents", headers=owner, json=_payload(record["id"], source=source),
    )

    assert saved.status_code == 201, saved.text
    assert saved.json()["client_id"] == record["id"]
    assert saved.json()["verified_type"] == "docx"
    listed = await client.get(f"/clients/{record['id']}/documents", headers=owner)
    assert [doc["id"] for doc in listed.json()] == [saved.json()["id"]]


@pytest.mark.asyncio
async def test_ask_conversations_are_not_a_save_source_yet(client, storage):
    owner = await _headers(client, "save-output-conversation@example.com")
    record = await _client_record(client, owner, "Synthetic Client")

    response = await client.post(
        "/tool-output/documents", headers=owner, json=_payload(record["id"], source="conversation"),
    )

    assert response.status_code == 422
    assert not storage._objects


@pytest.mark.asyncio
async def test_output_over_the_length_limit_is_rejected(client, storage):
    owner = await _headers(client, "save-output-long@example.com")
    record = await _client_record(client, owner, "Synthetic Client")

    response = await client.post(
        "/tool-output/documents", headers=owner,
        json=_payload(record["id"], text="x" * (MAX_OUTPUT_LENGTH + 1)),
    )

    assert response.status_code == 422
    assert not storage._objects


@pytest.mark.asyncio
async def test_output_with_characters_xml_forbids_still_saves(client, storage):
    owner = await _headers(client, "save-output-control@example.com")
    record = await _client_record(client, owner, "Synthetic Client")

    saved = await client.post(
        "/tool-output/documents", headers=owner,
        json=_payload(record["id"], text="Reason code\x00 CO-50\x0b\x1f approved ￾"),
    )

    assert saved.status_code == 201, saved.text


def test_word_document_keeps_the_text_and_drops_forbidden_characters():
    content = _docx("Draft Appeal output", "Line <one> & \x00more\nLine two\tend")

    with ZipFile(BytesIO(content)) as archive:
        document = archive.read("word/document.xml").decode()

    assert "Line &lt;one&gt; &amp; more" in document
    assert "Line two\tend" in document
    assert "\x00" not in document
