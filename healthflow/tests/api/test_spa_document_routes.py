"""The combined Fly image must serve browser deep links before overlapping API routes."""

import json
import os
import subprocess
import sys
import textwrap


def test_combined_app_routes_documents_to_react_and_json_to_api(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>HealthFlow app</title>")

    # Import the real combined app in a fresh process. main.py installs its
    # static-file routes at import time only when the built dist is present.
    probe = textwrap.dedent(
        """
        import asyncio
        import json
        from httpx import ASGITransport, AsyncClient
        from healthflow.main import app

        async def main():
            cases = [
                ("GET", "/", "text/html"),
                ("GET", "/enrollments", "text/html"),
                ("GET", "/issues", "text/html"),
                ("GET", "/clients/new", "text/html"),
                ("GET", "/clients/00000000-0000-0000-0000-000000000001", "text/html"),
                ("GET", "/organizations/00000000-0000-0000-0000-000000000001", "text/html"),
                ("GET", "/enrollments", "application/json"),
                ("GET", "/enrollments", "application/json, text/html"),
                ("GET", "/enrollments", "*/*"),
                ("POST", "/enrollments", "text/html"),
                ("GET", "/enrollments/00000000-0000-0000-0000-000000000001", "text/html"),
                ("GET", "/health", "text/html"),
            ]
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                responses = []
                for method, path, accept in cases:
                    response = await client.request(method, path, headers={"accept": accept})
                    responses.append([response.status_code, response.headers.get("content-type", ""), response.text])
            print(json.dumps(responses))

        asyncio.run(main())
        """
    )
    env = {**os.environ, "HEALTHFLOW_DIST_DIR": str(dist)}
    result = subprocess.run(
        [sys.executable, "-c", probe],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    responses = json.loads(result.stdout)
    for status, content_type, body in responses[0:6]:
        assert status == 200
        assert content_type.startswith("text/html")
        assert "HealthFlow app" in body
    for status, content_type, _ in responses[6:11]:
        assert status == 401
        assert content_type.startswith("application/json")
    assert responses[11][0] == 200
    assert responses[11][1].startswith("application/json")
