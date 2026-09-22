"""Serve React documents before same-path API routes in combined deployments."""

from pathlib import Path

from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


# These browser routes overlap API GET routes. Other browser routes reach the
# existing catch-all fallback without special handling.
SPA_DOCUMENT_PATHS = {
    "/clients",
    "/organizations",
    "/enrollments",
    "/issues",
    "/appeals",
    "/activity",
    "/history",
    "/feedback",
}
SPA_DOCUMENT_DETAIL_PREFIXES = ("/clients/", "/organizations/")


def is_spa_document_request(request: Request) -> bool:
    accept = request.headers.get("accept", "").lower()
    if request.method != "GET" or "text/html" not in accept or "application/json" in accept:
        return False
    path = request.url.path.rstrip("/") or "/"
    if path in SPA_DOCUMENT_PATHS:
        return True
    return any(
        path.startswith(prefix) and "/" not in path[len(prefix) :]
        for prefix in SPA_DOCUMENT_DETAIL_PREFIXES
    )


class SPADocumentMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, index_html: str | Path):
        super().__init__(app)
        self.index_html = str(index_html)

    async def dispatch(self, request: Request, call_next):
        if is_spa_document_request(request):
            return FileResponse(self.index_html)
        return await call_next(request)
