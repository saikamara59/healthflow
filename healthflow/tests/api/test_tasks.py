"""Task, Follow-up, and completed Activity API behavior."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event


async def _headers(client, email: str) -> dict[str, str]:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123!", "full_name": "Task Broker"},
    )
    await client.post("/__test/activate-broker", json={"email": email})
    response = await client.post(
        "/auth/login", json={"email": email, "password": "securepass123!"}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_create_complete_and_reopen_task_retains_completion_activity(client):
    headers = await _headers(client, "task-owner@example.com")
    created = await client.post(
        "/tasks", json={"title": "Call Maria", "priority": "high", "is_follow_up": True},
        headers=headers,
    )
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert created.json()["status"] == "open"

    completed = await client.post(f"/tasks/{task_id}/complete", headers=headers)
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None
    repeated = await client.post(f"/tasks/{task_id}/complete", headers=headers)
    assert repeated.status_code == 200

    activity = await client.get("/workspace/activity", headers=headers)
    assert activity.status_code == 200
    assert [(entry["entity_id"], entry["action"]) for entry in activity.json()] == [
        (task_id, "completed")
    ]

    reopened = await client.post(f"/tasks/{task_id}/reopen", headers=headers)
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"
    assert reopened.json()["completed_at"] is None
    activity_after_reopen = await client.get("/workspace/activity", headers=headers)
    assert len(activity_after_reopen.json()) == 1


@pytest.mark.asyncio
async def test_task_links_reject_foreign_and_mismatched_records(client):
    owner = await _headers(client, "task-links-owner@example.com")
    outsider = await _headers(client, "task-links-outsider@example.com")
    own_org = await client.post(
        "/organizations", json={"name": "Own Org", "kind": "carrier"}, headers=owner
    )
    other_org = await client.post(
        "/organizations", json={"name": "Other Org", "kind": "agency"}, headers=owner
    )
    other_contact = await client.post(
        f"/organizations/{other_org.json()['id']}/contacts",
        json={"full_name": "Other Rep"}, headers=owner,
    )
    foreign_org = await client.post(
        "/organizations", json={"name": "Foreign Org", "kind": "carrier"}, headers=outsider
    )

    mismatch = await client.post(
        "/tasks",
        json={
            "title": "Mismatch", "organization_id": own_org.json()["id"],
            "contact_id": other_contact.json()["id"],
        },
        headers=owner,
    )
    assert mismatch.status_code == 422
    foreign = await client.post(
        "/tasks",
        json={"title": "Foreign", "organization_id": foreign_org.json()["id"]},
        headers=owner,
    )
    assert foreign.status_code == 404


@pytest.mark.asyncio
async def test_task_lists_followups_and_unscheduled_work(client):
    headers = await _headers(client, "task-list@example.com")
    undated = await client.post(
        "/tasks", json={"title": "Undated follow-up", "is_follow_up": True}, headers=headers
    )
    await client.post("/tasks", json={"title": "Other Task"}, headers=headers)

    followups = await client.get("/tasks?is_follow_up=true", headers=headers)
    assert [task["id"] for task in followups.json()] == [undated.json()["id"]]
    unscheduled = await client.get("/tasks?schedule=unscheduled", headers=headers)
    assert {task["title"] for task in unscheduled.json()} == {"Undated follow-up", "Other Task"}


@pytest.mark.asyncio
async def test_task_can_be_updated_and_filtered_by_status(client):
    headers = await _headers(client, "task-update@example.com")
    created = await client.post("/tasks", json={"title": "Original"}, headers=headers)
    task_id = created.json()["id"]
    updated = await client.put(
        f"/tasks/{task_id}", json={"title": "Revised", "priority": "medium"}, headers=headers
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Revised"
    assert updated.json()["priority"] == "medium"
    assert (await client.get("/tasks?status=open", headers=headers)).json()[0]["id"] == task_id
    await client.post(f"/tasks/{task_id}/complete", headers=headers)
    assert (await client.get("/tasks?status=open", headers=headers)).json() == []
    assert (await client.get("/tasks?status=completed", headers=headers)).json()[0]["id"] == task_id


@pytest.mark.asyncio
async def test_task_due_earlier_today_is_overdue_not_due_today(client, monkeypatch):
    from healthflow.workspace import tasks_router

    frozen_now = datetime(2026, 9, 15, 12, tzinfo=timezone.utc)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen_now.astimezone(tz) if tz is not None else frozen_now.replace(tzinfo=None)

    monkeypatch.setattr(tasks_router, "datetime", FrozenDatetime)
    headers = await _headers(client, "task-dates@example.com")
    local_date = frozen_now.date().isoformat()
    overdue_due_at = frozen_now - timedelta(minutes=10)
    future_due_at = frozen_now + timedelta(minutes=10)
    for title, due_at in (("Past due", overdue_due_at), ("Later today", future_due_at)):
        created = await client.post(
            "/tasks", json={"title": title, "due_at": due_at.isoformat()}, headers=headers
        )
        assert created.status_code == 201

    overdue = await client.get(
        f"/tasks?schedule=overdue&timezone_name=UTC&local_date={local_date}", headers=headers
    )
    today = await client.get(
        f"/tasks?schedule=today&timezone_name=UTC&local_date={local_date}", headers=headers
    )
    assert {task["title"] for task in overdue.json()} == {"Past due"}
    assert {task["title"] for task in today.json()} == {"Later today"}


@pytest.mark.asyncio
async def test_task_schedule_rejects_invalid_timezone(client):
    headers = await _headers(client, "task-zone@example.com")
    response = await client.get("/tasks?schedule=today&timezone_name=Not/AZone", headers=headers)
    assert response.status_code == 422
    malformed = await client.get("/tasks?schedule=today&timezone_name=%2Fetc%2Fpasswd", headers=headers)
    assert malformed.status_code == 422


@pytest.mark.asyncio
async def test_task_pagination_and_other_schedule_include_only_unfeatured_work(client):
    headers = await _headers(client, "task-pages@example.com")
    for title, due_at in (
        ("Due today", "2026-09-15T12:00:00Z"),
        ("Future one", "2026-09-17T12:00:00Z"),
        ("Future two", "2026-09-18T12:00:00Z"),
        ("Unscheduled", None),
    ):
        assert (await client.post("/tasks", json={"title": title, "due_at": due_at}, headers=headers)).status_code == 201
    query = "/tasks?schedule=other&local_date=2026-09-15&timezone_name=UTC&limit=2"
    first = await client.get(query, headers=headers)
    second = await client.get(f"{query}&offset=2", headers=headers)
    assert first.status_code == second.status_code == 200
    assert {task["title"] for task in first.json() + second.json()} == {
        "Future one", "Future two", "Unscheduled"
    }
    assert (await client.get("/tasks?limit=101", headers=headers)).status_code == 422


@pytest.mark.asyncio
async def test_task_list_batch_loads_linked_names(client, db_engine):
    headers = await _headers(client, "task-batch@example.com")
    org = await client.post(
        "/organizations", json={"name": "Harbor", "kind": "carrier"}, headers=headers
    )
    org_id = org.json()["id"]
    contact = await client.post(
        f"/organizations/{org_id}/contacts", json={"full_name": "Dana"}, headers=headers
    )
    for title in ("First", "Second"):
        await client.post("/tasks", json={
            "title": title, "organization_id": org_id, "contact_id": contact.json()["id"],
        }, headers=headers)

    statements = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())
    event.listen(db_engine.sync_engine, "before_cursor_execute", capture)
    try:
        response = await client.get("/tasks", headers=headers)
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", capture)
    assert {task["organization_name"] for task in response.json()} == {"Harbor"}
    assert {task["contact_name"] for task in response.json()} == {"Dana"}
    assert sum("from organizations" in sql for sql in statements) == 1
    assert sum("from contacts" in sql for sql in statements) == 1


@pytest.mark.asyncio
async def test_selected_past_date_returns_tasks_due_that_day(client):
    headers = await _headers(client, "task-past-date@example.com")
    assert (await client.post(
        "/tasks", json={"title": "Past day", "due_at": "2026-09-01T12:00:00Z"}, headers=headers
    )).status_code == 201
    response = await client.get(
        "/tasks?schedule=today&local_date=2026-09-01&timezone_name=UTC", headers=headers
    )
    assert [task["title"] for task in response.json()] == ["Past day"]


@pytest.mark.asyncio
async def test_task_read_returns_utc_offset_after_database_round_trip(client):
    headers = await _headers(client, "task-timestamp@example.com")
    due_at = datetime(2026, 10, 1, 17, tzinfo=timezone.utc)
    created = await client.post(
        "/tasks", json={"title": "Time-zone check", "due_at": due_at.isoformat()},
        headers=headers,
    )
    detail = await client.get(f"/tasks/{created.json()['id']}", headers=headers)
    assert detail.status_code == 200
    assert datetime.fromisoformat(detail.json()["due_at"]).utcoffset() == timedelta(0)


@pytest.mark.asyncio
async def test_second_broker_cannot_view_or_complete_task(client):
    owner = await _headers(client, "task-private-a@example.com")
    outsider = await _headers(client, "task-private-b@example.com")
    task = await client.post("/tasks", json={"title": "Private work"}, headers=owner)
    task_id = task.json()["id"]

    assert (await client.get(f"/tasks/{task_id}", headers=outsider)).status_code == 404
    assert (await client.post(f"/tasks/{task_id}/complete", headers=outsider)).status_code == 404
    assert (await client.get("/tasks", headers=outsider)).json() == []
