import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env before any module reads os.getenv (e.g., DATABASE_URL, ANTHROPIC_API_KEY).
# Existing process env wins — useful in docker/CI where vars are passed explicitly.
load_dotenv(override=False)

# The healthflow-agents package resolves the public drug reference DB via this
# env var (its CostEstimator can't path-resolve relative to this repo the way
# the old in-tree healthflow.data.drug_database did).
os.environ.setdefault(
    "HEALTHFLOW_DATA_DB",
    str(Path(__file__).resolve().parent.parent / "healthflow_data.db"),
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from healthflow.api.middleware import EndpointContextMiddleware, HTTPLoggingMiddleware
from healthflow.api.case_middleware import CaseContextMiddleware
from healthflow.api.optional_broker_middleware import OptionalBrokerContextMiddleware

from healthflow.api.routes import router
from healthflow.auth.router import auth_router
from healthflow.auth.admin_router import admin_router
from healthflow.api.drug_router import drug_router
from healthflow.api.client_router import client_router
from healthflow.api.history_router import history_router
from healthflow.feedback.router import feedback_router
from healthflow.agents.temporal_awareness.routes import temporal_router
from healthflow.forensics.routes import forensics_router
from healthflow.decisions.router import decisions_router
from healthflow.workspace.organizations_router import organizations_router
from healthflow.workspace.activity_router import activity_router
from healthflow.workspace.tasks_router import tasks_router
from healthflow.workspace.appointments_router import appointments_router
from healthflow.workspace.dashboard_router import dashboard_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database tables and optional agent telemetry on startup."""
    from healthflow.database.config import async_session_factory, engine
    from healthflow.database.models import Base
    from healthflow.logs.invocation import configure_agent_logfire
    from healthflow.workspace.search_index import backfill_search_index

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session_factory() as session:
        await backfill_search_index(session)
    configure_agent_logfire()
    yield


app = FastAPI(
    title="HealthFlow",
    description="AI-powered Medicare Advantage plan comparison service",
    version="0.2.0",
    lifespan=lifespan,
)

# Explicit CORS allowlist. A wildcard origin must never be paired with
# allow_credentials=True — that combination lets any site make credentialed
# cross-origin requests. Origins come from FRONTEND_BASE_URL (the deployed UI)
# plus the local Vite/CRA dev servers. Extra comma-separated origins can be
# supplied via CORS_EXTRA_ORIGINS.
_cors_origins = [
    os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/"),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]
_cors_origins += [
    o.strip().rstrip("/")
    for o in os.getenv("CORS_EXTRA_ORIGINS", "").split(",")
    if o.strip()
]
ALLOWED_ORIGINS = list(dict.fromkeys(_cors_origins))  # de-dup, preserve order

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(HTTPLoggingMiddleware)
app.add_middleware(EndpointContextMiddleware)
app.add_middleware(CaseContextMiddleware)
app.add_middleware(OptionalBrokerContextMiddleware)

app.include_router(router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(drug_router)
app.include_router(client_router)
app.include_router(history_router)
app.include_router(feedback_router)
app.include_router(temporal_router)
app.include_router(forensics_router)
app.include_router(decisions_router)
app.include_router(organizations_router)
app.include_router(activity_router)
app.include_router(tasks_router)
app.include_router(appointments_router)
app.include_router(dashboard_router)


if (
    os.getenv("HEALTHFLOW_TEST_MODE") == "1"
    or os.getenv("HEALTHFLOW_ENABLE_TEST_ROUTES") == "1"
):
    from healthflow.api.test_router import test_router
    app.include_router(test_router)
    logging.warning("⚠️ test reset endpoint enabled — never run in production")


# ── Static-file serving for combined-container deploys (Fly.io demo) ─────────
# When the built frontend dist exists at /app/frontend/dist (the combined
# Dockerfile stage copies it there), serve it alongside the API. This keeps
# local dev untouched — docker-compose uses separate backend + nginx + vite
# containers, none of which have /app/frontend/dist inside the backend image.
_DIST_DIR = os.getenv("HEALTHFLOW_DIST_DIR", "/app/frontend/dist")
if os.path.isdir(_DIST_DIR):
    from fastapi import Request
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(_DIST_DIR, "assets")),
        name="static-assets",
    )

    # SPA fallback — any GET that didn't match an API route and isn't an asset
    # returns index.html so React Router can handle client-side routing.
    # Registered last so all explicit routes/mounts take priority.
    _INDEX_HTML = os.path.join(_DIST_DIR, "index.html")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str, request: Request):
        # Don't shadow API responses if a route handler raised 404; FastAPI
        # has already returned in that path. This handler only fires for
        # paths with no matching route at all.
        return FileResponse(_INDEX_HTML)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("healthflow.main:app", host="0.0.0.0", port=8000, reload=True)
