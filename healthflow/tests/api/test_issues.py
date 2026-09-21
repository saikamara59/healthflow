"""Broker-private Issue and Appeal workspace behavior."""

import pytest

from healthflow.tests.api.test_enrollments import _client_record, _headers


@pytest.mark.asyncio
async def test_issue_can_resolve_without_an_appeal(client):
    headers = await _headers(client, "issue-resolution@example.com")
    owned_client = await _client_record(client, headers)
    created = await client.post(
        "/issues",
        json={
            "client_id": owned_client["id"],
            "title": "Incorrect specialist copay",
            "description": "Carrier statement differs from the plan evidence.",
            "deadline": "2027-03-15",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "open"
    assert created.json()["appeals"] == []

    progressed = await client.put(
        f"/issues/{created.json()['id']}", json={"status": "in_progress"}, headers=headers
    )
    assert progressed.status_code == 200
    resolved = await client.put(
        f"/issues/{created.json()['id']}", json={"status": "resolved"}, headers=headers
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"
    assert resolved.json()["resolved_at"] is not None
    assert resolved.json()["appeals"] == []


@pytest.mark.asyncio
async def test_appeal_always_belongs_to_an_owned_issue(client):
    owner = await _headers(client, "appeal-owner@example.com")
    other = await _headers(client, "appeal-other@example.com")
    owned_client = await _client_record(client, owner)
    issue = await client.post(
        "/issues",
        json={"client_id": owned_client["id"], "title": "MRI denial"},
        headers=owner,
    )
    issue_id = issue.json()["id"]

    missing_issue = await client.post(
        "/appeals", json={"title": "No parent"}, headers=owner
    )
    assert missing_issue.status_code == 422
    cross_tenant = await client.post(
        "/appeals",
        json={"issue_id": issue_id, "title": "Cross-tenant draft"},
        headers=other,
    )
    assert cross_tenant.status_code == 404

    appeal = await client.post(
        "/appeals",
        json={"issue_id": issue_id, "title": "Medical necessity appeal"},
        headers=owner,
    )
    assert appeal.status_code == 201, appeal.text
    assert appeal.json()["issue_id"] == issue_id
    detail = await client.get(f"/issues/{issue_id}", headers=owner)
    assert [item["id"] for item in detail.json()["appeals"]] == [appeal.json()["id"]]


@pytest.mark.asyncio
async def test_issue_detail_combines_deadline_followups_appointments_and_appeals(client):
    headers = await _headers(client, "issue-context@example.com")
    owned_client = await _client_record(client, headers)
    issue = await client.post(
        "/issues",
        json={
            "client_id": owned_client["id"],
            "title": "Coverage exception",
            "deadline": "2027-04-01",
        },
        headers=headers,
    )
    issue_id = issue.json()["id"]
    task = await client.post(
        "/tasks",
        json={
            "client_id": owned_client["id"],
            "issue_id": issue_id,
            "title": "Call carrier",
            "is_follow_up": True,
        },
        headers=headers,
    )
    appointment = await client.post(
        "/appointments",
        json={
            "client_id": owned_client["id"],
            "issue_id": issue_id,
            "title": "Review denial",
            "starts_at": "2027-03-20T15:00:00Z",
            "ends_at": "2027-03-20T15:30:00Z",
        },
        headers=headers,
    )
    appeal = await client.post(
        "/appeals",
        json={"issue_id": issue_id, "title": "Coverage exception draft"},
        headers=headers,
    )

    detail = await client.get(f"/issues/{issue_id}", headers=headers)
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["deadline"] == "2027-04-01"
    assert [item["id"] for item in payload["follow_ups"]] == [task.json()["id"]]
    assert [item["id"] for item in payload["appointments"]] == [appointment.json()["id"]]
    assert [item["id"] for item in payload["appeals"]] == [appeal.json()["id"]]


@pytest.mark.asyncio
async def test_issue_rejects_cross_broker_read_write_and_links(client):
    owner = await _headers(client, "issue-private-owner@example.com")
    other = await _headers(client, "issue-private-other@example.com")
    owned_client = await _client_record(client, owner)
    issue = await client.post(
        "/issues",
        json={"client_id": owned_client["id"], "title": "Private issue"},
        headers=owner,
    )
    issue_id = issue.json()["id"]

    assert (await client.get(f"/issues/{issue_id}", headers=other)).status_code == 404
    assert (
        await client.put(f"/issues/{issue_id}", json={"status": "resolved"}, headers=other)
    ).status_code == 404
    assert (
        await client.post(
            "/issues",
            json={"client_id": owned_client["id"], "title": "Cross-tenant issue"},
            headers=other,
        )
    ).status_code == 404
