"""Today, Overview, Broker time zone, and encrypted-field search APIs."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select, text

from healthflow.database.models import PhiAccessLog, WorkspaceSearchToken
from healthflow.workspace.search_index import backfill_search_index


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
    for name in ("/etc/passwd", "../UTC"):
        malformed = await client.put(
            "/workspace/preferences", json={"timezone_name": name}, headers=headers
        )
        assert malformed.status_code == 422
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
async def test_archived_client_work_remains_in_today_with_history_marker(client):
    headers = await _headers(client, "archived-today@example.com")
    created = await client.post("/clients", json={
        "full_name": "Eleanor Rigby", "zip_code": "10001", "age": 68,
        "income_level": "medium", "doctors": [], "prescriptions": [], "procedures": [],
    }, headers=headers)
    assert created.status_code == 201
    client_id = created.json()["id"]
    task = await client.post("/tasks", json={
        "title": "Renew coverage", "client_id": client_id,
        "due_at": "2026-09-15T16:00:00+00:00",
    }, headers=headers)
    appointment = await client.post("/appointments", json={
        "title": "Review options", "client_id": client_id,
        "starts_at": "2026-09-15T10:00:00+00:00",
        "ends_at": "2026-09-15T10:30:00+00:00",
    }, headers=headers)
    assert task.status_code == appointment.status_code == 201

    assert (await client.post(f"/clients/{client_id}/archive", headers=headers)).status_code == 200
    archived = (await client.get("/workspace/today?local_date=2026-09-15", headers=headers)).json()
    assert [(item["id"], item["client_archived"]) for item in archived["due_today_tasks"]] == [
        (task.json()["id"], True)
    ]
    assert [(item["id"], item["client_archived"]) for item in archived["appointments_today"]] == [
        (appointment.json()["id"], True)
    ]
    assert (await client.get("/tasks", headers=headers)).json()[0]["client_archived"] is True
    assert (await client.get("/appointments", headers=headers)).json()[0]["client_archived"] is True
    assert (await client.post(f"/clients/{client_id}/restore", headers=headers)).status_code == 200
    restored = (await client.get("/workspace/today?local_date=2026-09-15", headers=headers)).json()
    assert restored["due_today_tasks"][0]["client_archived"] is False
    assert restored["appointments_today"][0]["client_archived"] is False


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
async def test_overview_shows_only_active_clients_and_restores_them(client):
    headers = await _headers(client, "overview-archive@example.com")
    client_ids = []
    for name in ("Active Client", "Archived Client"):
        response = await client.post("/clients", json={
            "full_name": name, "zip_code": "10001", "age": 68,
            "income_level": "medium", "doctors": [], "prescriptions": [], "procedures": [],
        }, headers=headers)
        assert response.status_code == 201
        client_ids.append(response.json()["id"])

    archived_id = client_ids[1]
    assert (await client.post(f"/clients/{archived_id}/archive", headers=headers)).status_code == 200
    archived_view = (await client.get("/workspace/overview", headers=headers)).json()
    assert archived_view["clients"] == 1
    assert [item["id"] for item in archived_view["recent_clients"]] == [client_ids[0]]

    assert (await client.post(f"/clients/{archived_id}/restore", headers=headers)).status_code == 200
    restored_view = (await client.get("/workspace/overview", headers=headers)).json()
    assert restored_view["clients"] == 2
    assert {item["id"] for item in restored_view["recent_clients"]} == set(client_ids)


@pytest.mark.asyncio
async def test_overview_returns_only_five_recent_clients_without_listing_the_book(client):
    owner = await _headers(client, "overview-recent-owner@example.com")
    outsider = await _headers(client, "overview-recent-outsider@example.com")
    for index in range(7):
        response = await client.post("/clients", json={
            "full_name": f"Recent Client {index}", "zip_code": "10001", "age": 40,
            "income_level": "medium", "doctors": [], "prescriptions": [], "procedures": [],
        }, headers=owner)
        assert response.status_code == 201
    await client.post("/clients", json={
        "full_name": "Other Broker", "zip_code": "10001", "age": 40,
        "income_level": "medium", "doctors": [], "prescriptions": [], "procedures": [],
    }, headers=outsider)
    result = await client.get("/workspace/overview", headers=owner)
    assert result.status_code == 200
    assert result.json()["clients"] == 7
    assert len(result.json()["recent_clients"]) == 5
    assert {entry["full_name"] for entry in result.json()["recent_clients"]} == {
        f"Recent Client {index}" for index in range(2, 7)
    }


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


@pytest.mark.asyncio
async def test_archived_search_matches_do_not_exhaust_candidate_limit(client):
    headers = await _headers(client, "search-archived-candidates@example.com")
    for index in range(27):
        archived = await client.post(
            "/organizations", json={"name": f"Harbor Old {index}", "kind": "agency"},
            headers=headers,
        )
        assert archived.status_code == 201
        await client.post(f"/organizations/{archived.json()['id']}/archive", headers=headers)
    active = await client.post(
        "/organizations", json={"name": "Harbor Active", "kind": "carrier"}, headers=headers
    )
    result = await client.get("/workspace/search?q=Harbor&limit=1", headers=headers)
    assert result.status_code == 200
    assert [item["id"] for item in result.json()] == [active.json()["id"]]


@pytest.mark.asyncio
async def test_search_index_tracks_renames_and_bounds_phi_reads(client, db_session):
    headers = await _headers(client, "search-index@example.com")
    for index in range(12):
        assert (await client.post(
            "/organizations", json={"name": f"Unrelated {index}", "kind": "carrier"},
            headers=headers,
        )).status_code == 201
    target = await client.post(
        "/organizations", json={"name": "Harbor Health", "kind": "carrier"}, headers=headers
    )
    target_id = target.json()["id"]

    found = await client.get("/workspace/search?q=Harbor", headers=headers)
    assert [item["id"] for item in found.json()] == [target_id]
    audit = (await db_session.execute(
        select(PhiAccessLog).where(PhiAccessLog.endpoint == "GET /workspace/search")
    )).scalars().all()
    organization_reads = [entry for entry in audit if entry.table_name == "organizations"]
    assert organization_reads and all(entry.row_count <= 1 for entry in organization_reads)

    changed = await client.put(
        f"/organizations/{target_id}", json={"name": "Blue Harbor"}, headers=headers
    )
    assert changed.status_code == 200
    assert [item["id"] for item in (
        await client.get("/workspace/search?q=Blue", headers=headers)
    ).json()] == [target_id]
    assert (await client.get("/workspace/search?q=Health", headers=headers)).json() == []
    stored = (await db_session.execute(select(WorkspaceSearchToken.digest))).scalars().all()
    assert stored and all("Harbor" not in digest for digest in stored)


@pytest.mark.asyncio
async def test_search_backfill_restores_existing_records(client, db_session):
    headers = await _headers(client, "search-backfill@example.com")
    created = await client.post(
        "/organizations", json={"name": "Legacy Harbor", "kind": "carrier"}, headers=headers
    )
    await db_session.execute(delete(WorkspaceSearchToken).where(
        WorkspaceSearchToken.kind == "organization",
        WorkspaceSearchToken.record_id == created.json()["id"],
    ))
    await db_session.commit()
    assert (await client.get("/workspace/search?q=Legacy", headers=headers)).json() == []
    await backfill_search_index(db_session)
    assert [item["id"] for item in (
        await client.get("/workspace/search?q=Legacy", headers=headers)
    ).json()] == [created.json()["id"]]


@pytest.mark.asyncio
async def test_search_backfill_skips_undecryptable_records(client, db_session):
    headers = await _headers(client, "search-backfill-poison@example.com")
    healthy = await client.post(
        "/organizations", json={"name": "Harbor Health", "kind": "carrier"}, headers=headers
    )
    poisoned = await client.post(
        "/organizations", json={"name": "Harbor Legacy", "kind": "carrier"}, headers=headers
    )
    await db_session.execute(delete(WorkspaceSearchToken).where(
        WorkspaceSearchToken.kind == "organization",
        WorkspaceSearchToken.record_id.in_([healthy.json()["id"], poisoned.json()["id"]]),
    ))
    # Raw SQL skips EncryptedString, leaving ciphertext this app's key cannot open.
    await db_session.execute(
        text("UPDATE organizations SET name = :name WHERE id = :id"),
        {"name": "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA", "id": poisoned.json()["id"]},
    )
    await db_session.commit()
    assert (await client.get("/workspace/search?q=Harbor", headers=headers)).json() == []

    await backfill_search_index(db_session)

    assert [item["id"] for item in (
        await client.get("/workspace/search?q=Harbor", headers=headers)
    ).json()] == [healthy.json()["id"]]
