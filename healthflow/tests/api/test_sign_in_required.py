"""Every endpoint requires a signed-in Broker unless it is on the public list (OVE-187).

The rule is enforced by default: a route added later is protected without anyone
remembering to add `Depends(get_current_broker)`. This test walks every route the
app registers, so a new route that answers anonymously fails here.
"""

import re
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.routing import APIRoute
from sqlalchemy.exc import OperationalError
from starlette.requests import Request
from starlette.routing import Mount

from healthflow.auth.sign_in_required import PUBLIC_ROUTES, require_sign_in
from healthflow.auth.tenant_context import current_broker_id
from healthflow.database.config import get_db
from healthflow.main import app
from healthflow.tests.api.test_enrollments import _headers

# Answers that count as a refusal for an anonymous caller.
REFUSED = {401, 403}

# Public routes that exist only in some deployments, so this test process may not see them.
_CONDITIONAL_PUBLIC = {
    ("GET", "/{full_path:path}"),  # SPA fallback, only when the built frontend is present
}


def _sample_path(template: str) -> str:
    """Fill path parameters with plausible values so the request reaches the route."""
    def fill(match: re.Match) -> str:
        name = match.group(1).split(":")[0]
        if name == "zip_code":
            return "10001"
        if match.group(1).endswith(":path"):
            return "anything"
        return str(uuid.uuid4())
    return re.sub(r"\{([^}]+)\}", fill, template)


def _api_routes() -> list[tuple[str, APIRoute]]:
    # Every method a route declares, HEAD and OPTIONS included. FastAPI adds no
    # methods of its own, and CORS preflights never reach routing.
    return [
        (method, route)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in sorted(route.methods)
    ]


@pytest.mark.asyncio
async def test_every_route_outside_the_public_list_refuses_an_anonymous_request(client):
    answered = []
    for method, route in _api_routes():
        if (method, route.path) in PUBLIC_ROUTES:
            continue
        response = await client.request(method, _sample_path(route.path), json={})
        if response.status_code not in REFUSED:
            answered.append(f"{method} {route.path} -> {response.status_code}")

    assert answered == [], "These routes answered without sign-in:\n" + "\n".join(answered)


@pytest.mark.asyncio
async def test_an_expired_or_malformed_token_is_refused_on_an_agent_route(client):
    response = await client.post(
        "/translate",
        headers={"Authorization": "Bearer not-a-real-token"},
        json={"document_text": "Deductible: $500", "question": "What is the deductible?"},
    )

    assert response.status_code == 401


def test_the_public_list_names_only_routes_that_exist():
    registered = {(method, route.path) for method, route in _api_routes()}

    stale = PUBLIC_ROUTES - registered - _CONDITIONAL_PUBLIC

    assert stale == set(), f"Public list entries with no matching route: {sorted(stale)}"


def test_only_api_routes_and_static_assets_are_registered():
    """Docs pages and other non-API routes skip FastAPI dependencies, so they are not allowed by default."""
    others = [
        getattr(route, "path", repr(route))
        for route in app.routes
        if not isinstance(route, APIRoute)
        and not (isinstance(route, Mount) and route.path == "/assets")
    ]

    assert others == []


@pytest.mark.asyncio
async def test_public_routes_still_answer_without_sign_in(client):
    health = await client.get("/health")
    login = await client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-1!"})

    assert health.status_code == 200
    assert login.status_code == 401
    assert login.json()["detail"] != "Not authenticated"


@pytest.mark.asyncio
@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.build_comparison_agent")
async def test_an_agent_call_is_recorded_against_the_signed_in_broker(mock_agent_factory, mock_recorder, client):
    """Without the optional middleware, the sign-in requirement is what sets the Broker for agent routes."""
    agent = MagicMock()
    agent.recommend.return_value = "Plan A is the best value."
    mock_agent_factory.return_value = agent
    mock_recorder.record_compare_decision.return_value = None
    headers = await _headers(client, "sign-in-required-agent@example.com")
    profile = (await client.get("/auth/profile", headers=headers)).json()

    response = await client.post(
        "/compare",
        headers=headers,
        json={"zip_code": "10001", "age": 65, "income_level": "low", "medications": ["Metformin"], "procedures": []},
    )

    assert response.status_code == 200, response.text
    _, kwargs = mock_recorder.record_compare_decision.call_args
    assert str(kwargs["broker_id"]) == profile["id"]


@pytest.mark.asyncio
@patch("healthflow.api.routes.decision_recorder")
@patch("healthflow.api.routes.build_comparison_agent")
async def test_an_agent_call_does_not_hold_a_database_connection(mock_agent_factory, mock_recorder, client):
    """Agent calls wait on Claude for seconds. Holding the sign-in connection that long would exhaust the pool."""
    headers = await _headers(client, "sign-in-required-pool@example.com")
    request_sessions = []
    original_get_db = app.dependency_overrides[get_db]

    async def recording_get_db():
        sessions = original_get_db()
        session = await anext(sessions)
        request_sessions.append(session)
        try:
            yield session
        finally:
            await sessions.aclose()

    in_transaction_during_agent = []

    def recommend(*args, **kwargs):
        in_transaction_during_agent.append(request_sessions[-1].in_transaction())
        return "Plan A is the best value."

    agent = MagicMock()
    agent.recommend.side_effect = recommend
    mock_agent_factory.return_value = agent
    mock_recorder.record_compare_decision.return_value = None
    app.dependency_overrides[get_db] = recording_get_db
    try:
        response = await client.post(
            "/compare",
            headers=headers,
            json={"zip_code": "10001", "age": 65, "income_level": "low", "medications": ["Metformin"], "procedures": []},
        )
    finally:
        app.dependency_overrides[get_db] = original_get_db

    assert response.status_code == 200, response.text
    assert in_transaction_during_agent == [False]


@pytest.mark.asyncio
async def test_a_failed_commit_after_sign_in_still_clears_the_broker(client, db_session_factory):
    """If releasing the sign-in connection fails, the Broker must not stay set for later work.

    Drives the dependency directly: a request runs in a copy of the caller's
    context, so a leaked ContextVar would not be visible from the test client.
    """
    headers = await _headers(client, "sign-in-required-commit@example.com")
    token = headers["Authorization"].removeprefix("Bearer ")
    translate = next(route for route in app.routes if isinstance(route, APIRoute) and route.path == "/translate")
    request = Request({"type": "http", "method": "POST", "path": "/translate", "headers": [], "route": translate})

    async with db_session_factory() as session:
        async def commit():
            raise OperationalError("COMMIT", {}, Exception("connection lost"))

        session.commit = commit
        guard = require_sign_in(request, token, session)
        with pytest.raises(OperationalError):
            await anext(guard)

        assert current_broker_id.get() is None
