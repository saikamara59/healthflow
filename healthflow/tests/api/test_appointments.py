"""Native Appointment, Scheduling, and completion Activity behavior."""

from datetime import datetime, timedelta, timezone

import pytest


async def _headers(client, email: str) -> dict[str, str]:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123!", "full_name": "Meeting Broker"},
    )
    await client.post("/__test/activate-broker", json={"email": email})
    response = await client.post(
        "/auth/login", json={"email": email, "password": "securepass123!"}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _payload(title: str, starts_at: datetime, ends_at: datetime) -> dict:
    return {"title": title, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}


@pytest.mark.asyncio
async def test_past_scheduled_appointment_needs_follow_up_without_status_change(client):
    headers = await _headers(client, "appointment-owner@example.com")
    now = datetime.now(timezone.utc)
    created = await client.post(
        "/appointments",
        json=_payload("Missed review", now - timedelta(hours=2), now - timedelta(hours=1)),
        headers=headers,
    )
    assert created.status_code == 201
    assert created.json()["status"] == "scheduled"
    assert created.json()["presentation_status"] == "needs_follow_up"


@pytest.mark.asyncio
async def test_appointment_rejects_invalid_create_and_partial_update_interval(client):
    headers = await _headers(client, "appointment-interval@example.com")
    now = datetime.now(timezone.utc)
    invalid = await client.post(
        "/appointments", json=_payload("Invalid", now + timedelta(hours=2), now),
        headers=headers,
    )
    assert invalid.status_code == 422

    created = await client.post(
        "/appointments",
        json=_payload("Valid", now + timedelta(hours=1), now + timedelta(hours=2)),
        headers=headers,
    )
    assert created.status_code == 201
    appointment_id = created.json()["id"]
    invalid_update = await client.put(
        f"/appointments/{appointment_id}",
        json={"ends_at": now.isoformat()}, headers=headers,
    )
    assert invalid_update.status_code == 422
    detail = await client.get(f"/appointments/{appointment_id}", headers=headers)
    assert detail.json()["ends_at"] == created.json()["ends_at"]


@pytest.mark.asyncio
async def test_completion_and_restore_keep_historical_activity(client):
    headers = await _headers(client, "appointment-complete@example.com")
    now = datetime.now(timezone.utc)
    created = await client.post(
        "/appointments",
        json=_payload("Review", now + timedelta(hours=1), now + timedelta(hours=2)),
        headers=headers,
    )
    appointment_id = created.json()["id"]
    completed = await client.post(f"/appointments/{appointment_id}/complete", headers=headers)
    assert completed.status_code == 200
    assert completed.json()["completed_at"] is not None
    assert completed.json()["status"] == "completed"
    assert (await client.post(f"/appointments/{appointment_id}/complete", headers=headers)).status_code == 200
    assert len((await client.get("/workspace/activity", headers=headers)).json()) == 1

    restored = await client.post(f"/appointments/{appointment_id}/restore-scheduled", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["status"] == "scheduled"
    assert restored.json()["completed_at"] is None
    assert len((await client.get("/workspace/activity", headers=headers)).json()) == 1


@pytest.mark.asyncio
async def test_cancel_records_one_activity_and_can_restore(client):
    headers = await _headers(client, "appointment-cancel@example.com")
    now = datetime.now(timezone.utc)
    created = await client.post(
        "/appointments",
        json=_payload("Review", now + timedelta(hours=1), now + timedelta(hours=2)),
        headers=headers,
    )
    appointment_id = created.json()["id"]
    canceled = await client.post(f"/appointments/{appointment_id}/cancel", headers=headers)
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert canceled.json()["canceled_at"] is not None
    await client.post(f"/appointments/{appointment_id}/cancel", headers=headers)
    activity = (await client.get("/workspace/activity", headers=headers)).json()
    assert [(entry["entity_id"], entry["action"]) for entry in activity] == [
        (appointment_id, "canceled")
    ]
    restored = await client.post(f"/appointments/{appointment_id}/restore-scheduled", headers=headers)
    assert restored.json()["status"] == "scheduled"
    assert restored.json()["canceled_at"] is None


@pytest.mark.asyncio
async def test_appointment_list_bounds_return_only_matching_start_times(client):
    headers = await _headers(client, "appointment-bounds@example.com")
    base = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
    for title, starts_at in (
        ("Before", base - timedelta(days=1)),
        ("Inside", base + timedelta(hours=1)),
        ("After", base + timedelta(days=1)),
    ):
        created = await client.post(
            "/appointments", json=_payload(title, starts_at, starts_at + timedelta(hours=1)),
            headers=headers,
        )
        assert created.status_code == 201
    response = await client.get(
        "/appointments",
        params={
            "starts_after": base.isoformat(),
            "starts_before": (base + timedelta(days=1)).isoformat(),
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert [appointment["title"] for appointment in response.json()] == ["Inside"]


@pytest.mark.asyncio
async def test_appointment_links_and_second_broker_are_tenant_scoped(client):
    owner = await _headers(client, "appointment-private-a@example.com")
    outsider = await _headers(client, "appointment-private-b@example.com")
    org = await client.post(
        "/organizations", json={"name": "Owned", "kind": "carrier"}, headers=owner
    )
    contact = await client.post(
        f"/organizations/{org.json()['id']}/contacts",
        json={"full_name": "Owned Rep"}, headers=owner,
    )
    foreign_org = await client.post(
        "/organizations", json={"name": "Foreign", "kind": "agency"}, headers=outsider
    )
    now = datetime.now(timezone.utc)
    payload = _payload("Private meeting", now + timedelta(hours=1), now + timedelta(hours=2))
    foreign = await client.post(
        "/appointments", json={**payload, "organization_id": foreign_org.json()["id"]},
        headers=owner,
    )
    assert foreign.status_code == 404
    created = await client.post(
        "/appointments",
        json={**payload, "organization_id": org.json()["id"], "contact_id": contact.json()["id"]},
        headers=owner,
    )
    assert created.status_code == 201
    appointment_id = created.json()["id"]
    assert created.json()["contact_name"] == "Owned Rep"
    assert (await client.get(f"/appointments/{appointment_id}", headers=outsider)).status_code == 404
    assert (await client.post(f"/appointments/{appointment_id}/cancel", headers=outsider)).status_code == 404
    assert (await client.get("/appointments", headers=outsider)).json() == []
