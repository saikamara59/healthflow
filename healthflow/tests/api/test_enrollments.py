"""Broker-reviewed Enrollment API behavior."""

import pytest


async def _headers(client, email: str) -> dict[str, str]:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123!", "full_name": "Enrollment Broker"},
    )
    await client.post("/__test/activate-broker", json={"email": email})
    response = await client.post(
        "/auth/login", json={"email": email, "password": "securepass123!"}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _client_record(client, headers, name: str = "Maria Hill") -> dict:
    response = await client.post(
        "/clients",
        json={
            "full_name": name,
            "zip_code": "10001",
            "age": 68,
            "income_level": "medium",
            "doctors": [],
            "prescriptions": [],
            "procedures": [],
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_broker_creates_and_views_enrollment_for_owned_client(client):
    headers = await _headers(client, "enrollment-owner@example.com")
    owned_client = await _client_record(client, headers)

    created = await client.post(
        "/enrollments",
        json={
            "client_id": owned_client["id"],
            "plan_name": "Harbor Gold PPO",
            "effective_date": "2027-01-01",
            "notes": "Paper application prepared for broker review.",
        },
        headers=headers,
    )

    assert created.status_code == 201, created.text
    payload = created.json()
    assert {
        key: payload[key]
        for key in ("client_id", "client_name", "plan_name", "effective_date", "status")
    } == {
        "client_id": owned_client["id"],
        "client_name": "Maria Hill",
        "plan_name": "Harbor Gold PPO",
        "effective_date": "2027-01-01",
        "status": "preparing",
    }
    enrollment_id = payload["id"]
    detail = await client.get(f"/enrollments/{enrollment_id}", headers=headers)
    listing = await client.get("/enrollments", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["id"] == enrollment_id
    assert [item["id"] for item in listing.json()] == [enrollment_id]


@pytest.mark.asyncio
async def test_enrollment_review_checkpoint_requires_explicit_submission_confirmation(client):
    headers = await _headers(client, "enrollment-review@example.com")
    owned_client = await _client_record(client, headers)
    created = await client.post(
        "/enrollments",
        json={"client_id": owned_client["id"], "plan_name": "Harbor Gold PPO"},
        headers=headers,
    )
    enrollment_id = created.json()["id"]

    ready = await client.post(f"/enrollments/{enrollment_id}/ready-to-submit", headers=headers)
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready_to_submit"
    assert ready.json()["submitted_at"] is None

    not_confirmed = await client.post(
        f"/enrollments/{enrollment_id}/submit",
        json={"external_submission_confirmed": False},
        headers=headers,
    )
    assert not_confirmed.status_code == 409
    assert (await client.get(f"/enrollments/{enrollment_id}", headers=headers)).json()[
        "status"
    ] == "ready_to_submit"

    submitted = await client.post(
        f"/enrollments/{enrollment_id}/submit",
        json={"external_submission_confirmed": True},
        headers=headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "submitted"
    assert submitted.json()["submitted_at"] is not None

    confirmed = await client.post(f"/enrollments/{enrollment_id}/confirm", headers=headers)
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "confirmed"


@pytest.mark.asyncio
async def test_enrollment_can_be_updated_filtered_and_canceled(client):
    headers = await _headers(client, "enrollment-filter@example.com")
    first_client = await _client_record(client, headers)
    second_client = await _client_record(client, headers, "Sam Wilson")
    first = await client.post(
        "/enrollments",
        json={"client_id": first_client["id"], "plan_name": "Harbor Gold PPO"},
        headers=headers,
    )
    await client.post(
        "/enrollments",
        json={"client_id": second_client["id"], "plan_name": "River Silver HMO"},
        headers=headers,
    )

    updated = await client.put(
        f"/enrollments/{first.json()['id']}",
        json={"plan_name": "Harbor Gold Plus", "effective_date": "2027-02-01"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["plan_name"] == "Harbor Gold Plus"

    canceled = await client.post(
        f"/enrollments/{first.json()['id']}/cancel", headers=headers
    )
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    filtered = await client.get(
        f"/enrollments?client_id={first_client['id']}&status=canceled", headers=headers
    )
    assert [item["id"] for item in filtered.json()] == [first.json()["id"]]


@pytest.mark.asyncio
async def test_enrollment_rejects_cross_broker_read_write_and_client_link(client):
    owner = await _headers(client, "enrollment-private-owner@example.com")
    other = await _headers(client, "enrollment-private-other@example.com")
    owned_client = await _client_record(client, owner)
    created = await client.post(
        "/enrollments",
        json={"client_id": owned_client["id"], "plan_name": "Private Plan"},
        headers=owner,
    )
    enrollment_id = created.json()["id"]

    assert (await client.get(f"/enrollments/{enrollment_id}", headers=other)).status_code == 404
    assert (
        await client.put(
            f"/enrollments/{enrollment_id}", json={"plan_name": "Tampered"}, headers=other
        )
    ).status_code == 404
    assert (
        await client.post(
            "/enrollments",
            json={"client_id": owned_client["id"], "plan_name": "Cross-tenant"},
            headers=other,
        )
    ).status_code == 404
