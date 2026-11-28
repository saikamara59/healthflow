"""Every endpoint requires a signed-in Broker unless it is on the public list.

`require_sign_in` is installed as an app-wide dependency in `healthflow/main.py`,
so a new route is protected by default. Making a route public means adding it to
`PUBLIC_ROUTES` here, where the list stays short, written down, and reviewed.

Routes that already declare `get_current_broker` (directly or through
`require_admin`) enforce sign-in themselves; this guard leaves them alone so the
Broker is looked up once per request. Everything else gets the same check
`get_current_broker` performs, including setting `current_broker_id`, so agent
invocations on routes such as `/compare` are recorded against the Broker.

`healthflow/tests/api/test_sign_in_required.py` calls every registered route
anonymously and fails if one outside this list answers.
"""

from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request, status
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker

# (method, route path template). Keep this list short; each entry needs a reason.
PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset({
    # Liveness for Fly and the uptime check; returns no data.
    ("GET", "/health"),
    # Signing in, staying signed in, and signing out. Logout takes the refresh
    # token, so it must work after the access token has expired.
    ("POST", "/auth/login"),
    ("POST", "/auth/refresh"),
    ("POST", "/auth/logout"),
    # Password recovery for a Broker who cannot sign in.
    ("POST", "/auth/forgot-password"),
    ("POST", "/auth/reset-password"),
    # Account creation. Replaced by accepting an invitation in OVE-176.
    ("POST", "/auth/register"),
    # The React shell for browser page loads in the combined image. It serves
    # index.html only; every API call the page makes is checked on its own.
    ("GET", "/{full_path:path}"),
    # e2e reset helpers. Registered only when HEALTHFLOW_TEST_MODE or
    # HEALTHFLOW_ENABLE_TEST_ROUTES is set, never in a deployment.
    ("POST", "/__test/reset"),
    ("POST", "/__test/activate-broker"),
})

_optional_bearer = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def _not_signed_in() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _uses_get_current_broker(dependant: Dependant) -> bool:
    return dependant.call is get_current_broker or any(
        _uses_get_current_broker(sub) for sub in dependant.dependencies
    )


# APIRoute is not hashable; routes live as long as the app, so their id is stable.
_self_enforcing: dict[int, bool] = {}


def _enforces_sign_in_itself(route: APIRoute) -> bool:
    key = id(route)
    if key not in _self_enforcing:
        # The route's own dependencies, not the app-wide one: that would be this guard.
        _self_enforcing[key] = any(
            _uses_get_current_broker(sub)
            for sub in route.dependant.dependencies
            if sub.call is not require_sign_in
        )
    return _self_enforcing[key]


async def require_sign_in(
    request: Request,
    token: str | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> AsyncIterator[Broker | None]:
    route = request.scope.get("route")
    if not isinstance(route, APIRoute):
        # FastAPI only runs dependencies for its own routes, so this cannot
        # happen today. Refuse rather than guess if that ever changes.
        raise _not_signed_in()
    method = "GET" if request.method == "HEAD" else request.method
    if (method, route.path) in PUBLIC_ROUTES or _enforces_sign_in_itself(route):
        yield None
        return
    if not token:
        raise _not_signed_in()
    # Reuse get_current_broker so token checks and the tenant ContextVar stay in
    # one place. Driving it by hand keeps its set/reset in this request's context.
    session = get_current_broker(token, db)
    broker = await anext(session)
    try:
        # The routes that reach this point are the agent tools, which wait on
        # Claude for seconds. End the sign-in lookup's transaction so its
        # connection goes back to the pool now instead of after the agent
        # answers; the Broker stays set for the request. Nothing else has used
        # this session yet. Inside the try, so a failed commit still resets
        # the Broker ContextVar below.
        await db.commit()
        yield broker
    finally:
        await session.aclose()
