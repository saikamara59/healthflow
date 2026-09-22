"""The combined Fly image must serve browser deep links before overlapping API routes."""

import json
import os
import subprocess
import sys
import textwrap


def test_combined_app_routes_documents_to_react_and_json_to_api(tmp_path):
    """Exercise the real combined-app middleware and overlapping API paths."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>HealthFlow app</title>")

    # Import the real combined app in a fresh process. main.py installs its
    # static-file routes at import time only when the built dist is present.
    probe = textwrap.dedent(
        """
        import asyncio
        import json
        import os
        from pathlib import Path
        from httpx import ASGITransport, AsyncClient
        from healthflow.main import app
        from healthflow.logs import server as server_log_module

        async def main():
            server_log_module._cached_logger = server_log_module.ServerLogger(
                log_dir=os.environ["HEALTHFLOW_TEST_LOG_DIR"]
            )
            cases = [
                ("GET", "/", "text/html"),
                ("GET", "/enrollments", "text/html"),
                ("GET", "/issues", "text/html"),
                ("GET", "/clients/new", "text/html"),
                ("GET", "/clients/00000000-0000-0000-0000-000000000001", "text/html"),
                ("GET", "/organizations/00000000-0000-0000-0000-000000000001", "text/html"),
                ("GET", "/enrollments", "text/html;q=0"),
                ("GET", "/enrollments", "text/html, application/json;q=0"),
                ("GET", "/enrollments", "text/html;q=0.9, application/json;q=1"),
                ("GET", "/enrollments", "text/html;q=1, application/json;q=0.9"),
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
                    responses.append([
                        response.status_code,
                        response.headers.get("content-type", ""),
                        response.text,
                        response.headers.get("vary", ""),
                        response.headers.get("cache-control", ""),
                    ])
            log_file = Path(os.environ["HEALTHFLOW_TEST_LOG_DIR"]) / "server.log"
            logs = [json.loads(line) for line in log_file.read_text().splitlines()]
            print(json.dumps({"responses": responses, "logs": logs}))

        asyncio.run(main())
        """
    )
    env = {
        **os.environ,
        "HEALTHFLOW_DIST_DIR": str(dist),
        "HEALTHFLOW_TEST_LOG_DIR": str(tmp_path / "logs"),
    }
    result = subprocess.run(
        [sys.executable, "-c", probe],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    output = json.loads(result.stdout)
    responses = output["responses"]
    for index in (0, 1, 2, 3, 4, 5, 7, 9):
        status, content_type, body, vary, cache_control = responses[index]
        assert status == 200
        assert content_type.startswith("text/html")
        assert "HealthFlow app" in body
        if index:
            assert "accept" in vary.lower()
            assert "no-store" in cache_control.lower()
    for index in (6, 8, 10, 11, 12, 13, 14):
        status, content_type, _, vary, _ = responses[index]
        assert status == 401
        assert content_type.startswith("application/json")
        if index in (6, 8, 10, 11, 12):
            assert "accept" in vary.lower()
    assert responses[15][0] == 200
    assert responses[15][1].startswith("application/json")
    assert any(
        entry["method"] == "GET" and entry["path"] == "/enrollments" and entry["status"] == 200
        for entry in output["logs"]
    )
