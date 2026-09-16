"""Today, Overview, Broker time zone, and encrypted-field search APIs."""

from datetime import datetime, timedelta, timezone

import pytest


async def _headers(client, email: str) -> dict[str, str]:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123!", "full_name": "Daily Broker"},
    )
    await client.post("/__test/activate-broker", json={"email": email})
    response = await client.post(
        "/auth/login", json={"email": email, "password": "securepass123!"}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_preferences_default_to_utc_and_reject_invalid_zones(client):
    headers = await _headers(client, "pref-owner@example.com")
    initial = await client.get("/workspace/preferences", headers=headers)
    assert initial.status_code == 200
    assert initial.json() == {"timezone_name": "UTC", "is_configured": False}
    invalid = await client.put(
        "/workspace/preferences", json={"timezone_name": "Not/AZone"}, headers=headers
    )
    assert invalid.status_code == 422
    saved = await client.put(
        "/workspace/preferences", json={"timezone_name": "America/New_York"}, headers=headers
    )
    assert saved.status_code == 200
    assert saved.json() == {"timezone_name": "America/New_York", "is_configured": True}
    assert (await client.get("/workspace/preferences", headers=headers)).json() == saved.json()


@pytest.mark.asyncio
async def test_today_uses_saved_timezone_and_separates_sections(client):
    headers = await _headers(client, "today-owner@example.com")
    pref = await client.put(
        "/workspace/preferences", json={"timezone_name": "America/New_York"},
        headers=headers,
    )
    assert pref.status_code == 200
    for payload in (
        {"title": "Overdue task", "due_at": "2026-09-14T16:00:00-04:00"},
        {"title": "Due today", "due_at": "2026-09-15T16:00:00-04:00"},
        {"title": "Unscheduled task", "due_at": None},
    ):
        assert (await client.post("/tasks", json=payload, headers=headers)).status_code == 201
    for payload in (
        {
            "title": "Today's meeting",
            "starts_at": "2026-09-15T10:00:00-04:00",
            "ends_at": "2026-09-15T10:30:00-04:00",
        },
        {
            "title": "Upcoming meeting",
            "starts_at": "2026-09-21T10:00:00-04:00",
            "ends_at": "2026-09-21T10:30:00-04:00",
        },
    ):
        assert (await client.post("/appointments", json=payload, headers=headers)).status_code == 201

    response = await client.get("/workspace/today?local_date=2026-09-15", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["timezone_name"] == "America/New_York"
    assert [item["title"] for item in body["overdue_tasks"]] == ["Overdue task"]
    assert [item["title"] for item in body["due_today_tasks"]] == ["Due today"]
    assert [item["title"] for item in body["appointments_today"]] == ["Today's meeting"]
    assert [item["title"] for item in body["appointments_next_seven_days"]] == ["Upcoming meeting"]


@pytest.mark.asyncio
async def test_today_marks_task_due_earlier_this_day_as_overdue(client):
    headers = await _headers(client, "today-overdue@example.com")
    due_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    await client.post(
        "/tasks", json={"title": "Past due today", "due_at": due_at.isoformat()},
        headers=headers,
    )
    response = await client.get("/workspace/today", headers=headers)
    assert response.status_code == 200
    assert [task["title"] for task in response.json()["overdue_tasks"]] == ["Past due today"]
    assert response.json()["due_today_tasks"] == []


@pytest.mark.asyncio
async def test_overview_counts_only_current_broker_records(client):
    owner = await _headers(client, "overview-owner@example.com")
    outsider = await _headers(client, "overview-outsider@example.com")
    for headers in (owner, outsider):
        await client.post(
            "/organizations", json={"name": "Org", "kind": "carrier"}, headers=headers
        )
        await client.post("/tasks", json={"title": "Task"}, headers=headers)
    response = await client.get("/workspace/overview", headers=owner)
    assert response.status_code == 200
    assert response.json()["organizations"] == 1
    assert response.json()["open_tasks"] == 1
    assert response.json()["clients"] == 0


@pytest.mark.asyncio
async def test_search_matches_encrypted_names_without_cross_broker_leak(client):
    owner = await _headers(client, "search-owner@example.com")
    outsider = await _headers(client, "search-outsider@example.com")
    owned = await client.post(
        "/organizations", json={"name": "Harbor Health", "kind": "carrier"}, headers=owner
    )
    await client.post(
        "/organizations", json={"name": "Harbor Secret", "kind": "carrier"}, headers=outsider
    )
    archived = await client.post(
        "/organizations", json={"name": "Harbor Old", "kind": "agency"}, headers=owner
    )
    await client.post(f"/organizations/{archived.json()['id']}/archive", headers=owner)
    results = await client.get("/workspace/search?q=HARBOR", headers=owner)
    assert results.status_code == 200
    assert [(item["title"], item["href"]) for item in results.json()] == [
        ("Harbor Health", f"/organizations/{owned.json()['id']}")
    ]
    assert (await client.get("/workspace/search?q=h", headers=owner)).status_code == 422
