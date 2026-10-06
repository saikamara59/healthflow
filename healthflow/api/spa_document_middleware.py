"""Serve React documents before same-path API routes in combined deployments."""

from pathlib import Path

from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


# These browser routes overlap API GET routes. Other browser routes reach the
# existing catch-all fallback without special handling. A test derives the pages
# from App.jsx and fails when a page shares a path with an API route not listed here.
SPA_DOCUMENT_PATHS = {
    "/clients",
    "/organizations",
    "/enrollments",
    "/issues",
    "/appeals",
    "/activity",
    "/history",
    "/feedback",
    "/documents",
    "/approvals",
}
SPA_DOCUMENT_DETAIL_PREFIXES = ("/clients/", "/organizations/")


def is_spa_path(path: str) -> bool:
    """Identify browser routes that would otherwise be shadowed by API routes."""
    path = path.rstrip("/") or "/"
    if path in SPA_DOCUMENT_PATHS:
        return True
    return any(
        path.startswith(prefix) and "/" not in path[len(prefix) :]
        for prefix in SPA_DOCUMENT_DETAIL_PREFIXES
    )


def media_quality(accept: str, media_type: str) -> float:
    """Return the quality of a media type, honoring exact and wildcard ranges."""
    requested_type = media_type.split("/", 1)[0]
    best_specificity = -1
    quality = 0.0
    for item in accept.lower().split(","):
        media_range, *parameters = (part.strip() for part in item.split(";"))
        if media_range == media_type:
            specificity = 2
        elif media_range == f"{requested_type}/*":
            specificity = 1
        elif media_range == "*/*":
            specificity = 0
        else:
            continue
        item_quality = 1.0
        for parameter in parameters:
            name, separator, value = parameter.partition("=")
            if separator and name == "q":
                try:
                    item_quality = float(value)
                except ValueError:
                    item_quality = 0.0
                if not 0.0 <= item_quality <= 1.0:
                    item_quality = 0.0
                break
        if specificity > best_specificity or (
            specificity == best_specificity and item_quality > quality
        ):
            best_specificity = specificity
            quality = item_quality
    return quality


def is_spa_document_request(request: Request) -> bool:
    """Prefer HTML only when GET accepts it more strongly than JSON."""
    if request.method != "GET" or not is_spa_path(request.url.path):
        return False
    accept = request.headers.get("accept", "")
    html_quality = media_quality(accept, "text/html")
    json_quality = media_quality(accept, "application/json")
    return html_quality > 0 and html_quality > json_quality


def _set_representation_headers(response: Response) -> Response:
    """Prevent caching one representation of a shared page/API URL as another."""
    existing_vary = response.headers.get("vary", "")
    if "accept" not in {part.strip().lower() for part in existing_vary.split(",")}:
        response.headers["Vary"] = f"{existing_vary}, Accept" if existing_vary else "Accept"
    response.headers["Cache-Control"] = "private, no-store"
    return response


class SPADocumentMiddleware(BaseHTTPMiddleware):
    """Negotiate browser documents separately from same-path protected APIs."""

    def __init__(self, app, index_html: str | Path):
        """Use the built React document from the combined image."""
        super().__init__(app)
        self.index_html = str(index_html)

    async def dispatch(self, request: Request, call_next):
        """Serve HTML or the API, adding cache-safe headers to either response."""
        if is_spa_document_request(request):
            return _set_representation_headers(FileResponse(self.index_html))
        if request.method == "GET" and is_spa_path(request.url.path):
            return _set_representation_headers(await call_next(request))
        return await call_next(request)
