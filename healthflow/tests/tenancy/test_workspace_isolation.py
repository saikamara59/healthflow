import pytest
from sqlalchemy import select

from healthflow.auth.tenant_context import current_broker_id, system_context
from healthflow.database.models import (
    Appointment,
    Broker,
    BrokerPreference,
    Contact,
    Organization,
    Task,
    WorkspaceActivity,
)
from healthflow.database.phi_audit import _AUDITED_MODELS
from healthflow.database.tenant_filter import TENANT_SCOPED_MODELS


def test_workspace_records_require_broker_scoping():
    """Unscoped workspace queries could expose another Broker's records."""
    assert {
        BrokerPreference,
        Organization,
        Contact,
        Task,
        Appointment,
        WorkspaceActivity,
    } <= TENANT_SCOPED_MODELS


def test_phi_bearing_workspace_records_are_audited():
    """Reads and writes of workspace PHI must leave access evidence."""
    assert {
        Organization,
        Contact,
        Task,
        Appointment,
        WorkspaceActivity,
    } <= _AUDITED_MODELS


@pytest.mark.asyncio
async def test_task_queries_show_only_the_current_brokers_records(db_session_factory):
    async with db_session_factory() as session:
        with system_context("seed workspace tenant-isolation test"):
            broker_a = Broker(email="workspace-a@example.com", hashed_password="hash", full_name="A")
            broker_b = Broker(email="workspace-b@example.com", hashed_password="hash", full_name="B")
            session.add_all([broker_a, broker_b])
            await session.flush()
            task_a = Task(broker_id=broker_a.id, title="A's task")
            task_b = Task(broker_id=broker_b.id, title="B's task")
            session.add_all([task_a, task_b])
            await session.commit()

        for broker, expected_task in ((broker_a, task_a), (broker_b, task_b)):
            token = current_broker_id.set(broker.id)
            try:
                result = await session.execute(select(Task))
                assert [task.id for task in result.scalars().all()] == [expected_task.id]
            finally:
                current_broker_id.reset(token)


async def _auth(client, email):
    await client.post('/auth/register', json={
        'email': email, 'password': 'securepass123!', 'full_name': 'Isolation Broker',
    })
    await client.post('/__test/activate-broker', json={'email': email})
    login = await client.post('/auth/login', json={
        'email': email, 'password': 'securepass123!',
    })
    return {'Authorization': f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_workspace_api_never_exposes_or_mutates_another_brokers_records(client):
    owner = await _auth(client, 'matrix-owner@example.com')
    outsider = await _auth(client, 'matrix-outsider@example.com')
    organization = await client.post('/organizations', json={
        'name': 'Private Harbor', 'kind': 'carrier',
    }, headers=owner)
    organization_id = organization.json()['id']
    contact = await client.post(f'/organizations/{organization_id}/contacts', json={
        'full_name': 'Private Dana',
    }, headers=owner)
    contact_id = contact.json()['id']
    task = await client.post('/tasks', json={
        'title': 'Private renewal', 'organization_id': organization_id,
        'contact_id': contact_id, 'due_at': '2030-01-01T10:00:00Z',
    }, headers=owner)
    task_id = task.json()['id']
    appointment = await client.post('/appointments', json={
        'title': 'Private meeting', 'organization_id': organization_id,
        'contact_id': contact_id, 'starts_at': '2030-01-01T10:00:00Z',
        'ends_at': '2030-01-01T11:00:00Z',
    }, headers=owner)
    appointment_id = appointment.json()['id']
    await client.post(f'/tasks/{task_id}/complete', headers=owner)
    await client.put('/workspace/preferences', json={
        'timezone_name': 'America/Chicago',
    }, headers=owner)

    hidden_requests = [
        ('get', f'/organizations/{organization_id}', None),
        ('put', f'/organizations/{organization_id}', {'name': 'Stolen'}),
        ('post', f'/organizations/{organization_id}/archive', None),
        ('post', f'/organizations/{organization_id}/restore', None),
        ('post', f'/organizations/{organization_id}/contacts', {'full_name': 'Intruder'}),
        ('put', f'/organizations/{organization_id}/contacts/{contact_id}', {'full_name': 'Stolen'}),
        ('post', f'/organizations/{organization_id}/contacts/{contact_id}/archive', None),
        ('post', f'/organizations/{organization_id}/contacts/{contact_id}/restore', None),
        ('get', f'/tasks/{task_id}', None),
        ('put', f'/tasks/{task_id}', {'title': 'Stolen'}),
        ('post', f'/tasks/{task_id}/complete', None),
        ('post', f'/tasks/{task_id}/reopen', None),
        ('get', f'/appointments/{appointment_id}', None),
        ('put', f'/appointments/{appointment_id}', {'title': 'Stolen'}),
        ('post', f'/appointments/{appointment_id}/complete', None),
        ('post', f'/appointments/{appointment_id}/cancel', None),
        ('post', f'/appointments/{appointment_id}/restore-scheduled', None),
    ]
    for method, path, payload in hidden_requests:
        response = await client.request(method.upper(), path, json=payload, headers=outsider)
        assert response.status_code == 404, (method, path, response.text)

    for path in (
        '/organizations?include_contacts=true', '/tasks', '/appointments',
        '/workspace/activity', '/workspace/today?local_date=2030-01-01',
        '/workspace/overview', '/workspace/search?q=Private',
    ):
        response = await client.get(path, headers=outsider)
        assert response.status_code == 200, (path, response.text)
        assert 'Private' not in response.text, path
    assert (await client.get('/workspace/preferences', headers=outsider)).json() == {
        'timezone_name': 'UTC', 'is_configured': False,
    }
    for payload in (
        {'title': 'Intruder task', 'organization_id': organization_id},
        {'title': 'Intruder task', 'contact_id': contact_id},
    ):
        assert (await client.post('/tasks', json=payload, headers=outsider)).status_code == 404
    assert (await client.post('/appointments', json={
        'title': 'Intruder meeting', 'starts_at': '2030-01-02T10:00:00Z',
        'ends_at': '2030-01-02T11:00:00Z', 'contact_id': contact_id,
    }, headers=outsider)).status_code == 404
