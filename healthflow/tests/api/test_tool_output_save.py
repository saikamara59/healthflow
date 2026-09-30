"""Temporary Tool output becomes a protected Document only after confirmation."""

import pytest

from healthflow.api.documents_router import get_document_service
from healthflow.main import app
from healthflow.tests.api.test_enrollments import _client_record, _headers
from healthflow.workspace.document_service import DocumentService
from healthflow.workspace.document_storage import FakeDocumentStorage


@pytest.mark.asyncio
async def test_save_output_requires_confirmation_and_owned_client(client, db_session_factory):
    storage = FakeDocumentStorage()
    app.dependency_overrides[get_document_service] = lambda: DocumentService(
        storage, session_factory=db_session_factory, upload_enabled=True,
    )
    try:
        owner = await _headers(client, 'save-output-owner@example.com')
        other = await _headers(client, 'save-output-other@example.com')
        record = await _client_record(client, owner, 'Synthetic Client')
        payload = {
            'source': 'conversation', 'client_id': record['id'],
            'text': 'Broker: What are the options?\nAsk HealthFlow: Review plan documents.',
        }
        assert (await client.post('/tool-output/documents', json={**payload, 'confirmed': True})).status_code == 401
        assert (await client.post('/tool-output/documents', headers=owner, json=payload)).status_code == 409
        assert not storage._objects
        assert (await client.post('/tool-output/documents', headers=other, json={**payload, 'confirmed': True})).status_code == 404
        assert not storage._objects
        saved = await client.post('/tool-output/documents', headers=owner, json={**payload, 'confirmed': True})
        assert saved.status_code == 201, saved.text
        assert saved.json()['client_id'] == record['id']
        assert saved.json()['verified_type'] == 'docx'
        listed = await client.get(f"/clients/{record['id']}/documents", headers=owner)
        assert [doc['id'] for doc in listed.json()] == [saved.json()['id']]
    finally:
        app.dependency_overrides.pop(get_document_service, None)
