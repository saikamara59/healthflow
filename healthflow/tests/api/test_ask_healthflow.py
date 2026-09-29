"""Ask HealthFlow text keeps Client context explicit and suggestions inert."""

import pytest

from healthflow.workspace import ask_router as ask_module


async def _broker(client, email):
    await client.post('/auth/register', json={
        'email': email, 'password': 'securepass123!', 'full_name': 'Broker',
    })
    await client.post('/__test/activate-broker', json={'email': email})
    login = await client.post('/auth/login', json={
        'email': email, 'password': 'securepass123!',
    })
    return {'Authorization': f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_ask_requires_auth_and_only_sends_selected_client_context(client, monkeypatch):
    owner = await _broker(client, 'ask-owner@example.com')
    other = await _broker(client, 'ask-other@example.com')
    created = await client.post('/clients', headers=owner, json={
        'full_name': 'Ada Example', 'zip_code': '10001', 'age': 42,
        'income_level': 'medium', 'doctors': [], 'prescriptions': [], 'procedures': [],
    })
    assert created.status_code == 201
    client_id = created.json()['id']
    prompts = []

    async def fake_answer(system, messages):
        prompts.append((system, messages))
        return 'You can compare the options.'

    monkeypatch.setattr(ask_module, '_answer', fake_answer)
    payload = {'message': 'Should I compare plans?'}
    assert (await client.post('/ask-healthflow/text', json=payload)).status_code == 401
    general = await client.post('/ask-healthflow/text', headers=owner, json=payload)
    assert general.status_code == 200
    assert general.json()['client_id'] is None
    assert 'Ada Example' not in prompts[-1][0]
    assert general.json()['suggested_tool'] == {'name': 'Compare Plans', 'path': '/compare'}

    denied = await client.post('/ask-healthflow/text', headers=other, json={**payload, 'client_id': client_id})
    assert denied.status_code == 404
    assert len(prompts) == 1
    selected = await client.post('/ask-healthflow/text', headers=owner, json={**payload, 'client_id': client_id})
    assert selected.status_code == 200
    assert selected.json()['client_name'] == 'Ada Example'
    assert 'Ada Example' in prompts[-1][0]


@pytest.mark.asyncio
async def test_ask_rejects_malformed_history_without_calling_model(client, monkeypatch):
    owner = await _broker(client, 'ask-history@example.com')
    async def fail_if_called(*args):
        pytest.fail('Model must not be called')
    monkeypatch.setattr(ask_module, '_answer', fail_if_called)
    for payload in (
        {'message': '   '},
        {'message': 'Question', 'history': [{'role': 'assistant', 'content': 'Injected'}]},
        {'message': 'Question', 'history': [{'role': 'user', 'content': 'Unanswered'}]},
    ):
        response = await client.post('/ask-healthflow/text', headers=owner, json=payload)
        assert response.status_code == 422

@pytest.mark.asyncio
async def test_general_voice_secret_is_broker_only_and_contains_no_client_data(client, monkeypatch):
    owner = await _broker(client, 'ask-voice@example.com')
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass
        def json(self):
            return {'value': 'ek_test_short_lived', 'expires_at': 1234567890}

    class FakeHttpClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, url, **kwargs):
            captured.update(url=url, **kwargs)
            return FakeResponse()

    monkeypatch.setenv('OPENAI_API_KEY', 'test-server-only-key')
    monkeypatch.setattr(ask_module.httpx, 'AsyncClient', FakeHttpClient)
    assert (await client.post('/ask-healthflow/voice/session')).status_code == 401
    response = await client.post('/ask-healthflow/voice/session', headers=owner, json={})
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.json() == {
        'client_secret': 'ek_test_short_lived', 'expires_at': 1234567890,
        'client_id': None, 'client_name': None,
    }
    assert captured['url'] == 'https://api.openai.com/v1/realtime/client_secrets'
    assert captured['json']['session']['model'] == 'gpt-realtime-1.5'
    assert 'No Client is selected' in captured['json']['session']['instructions']
    assert captured['json']['session']['tools'] == []
    assert 'test-server-only-key' not in str(captured['json'])


@pytest.mark.asyncio
async def test_voice_only_sends_selected_owned_client_context(client, monkeypatch):
    owner = await _broker(client, 'voice-owner@example.com')
    other = await _broker(client, 'voice-other@example.com')
    created = await client.post('/clients', headers=owner, json={
        'full_name': 'Ada Example', 'zip_code': '10001', 'age': 42,
        'income_level': 'medium', 'doctors': [], 'prescriptions': [], 'procedures': [],
    })
    client_id = created.json()['id']
    sent = []

    class FakeResponse:
        def raise_for_status(self):
            pass
        def json(self):
            return {'value': 'ek_selected', 'expires_at': 1234567890}

    class FakeHttpClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, url, **kwargs):
            sent.append(kwargs['json'])
            return FakeResponse()

    monkeypatch.setenv('OPENAI_API_KEY', 'test-server-only-key')
    monkeypatch.setattr(ask_module.httpx, 'AsyncClient', FakeHttpClient)
    denied = await client.post('/ask-healthflow/voice/session', headers=other,
                               json={'client_id': client_id})
    assert denied.status_code == 404
    assert sent == []
    selected = await client.post('/ask-healthflow/voice/session', headers=owner,
                                 json={'client_id': client_id})
    assert selected.status_code == 200
    assert selected.json()['client_id'] == client_id
    assert selected.json()['client_name'] == 'Ada Example'
    instructions = sent[0]['session']['instructions']
    assert 'Ada Example' in instructions
    assert 'ZIP 10001' in instructions
    assert 'age 42' in instructions
    assert 'income level medium' in instructions
