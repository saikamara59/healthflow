"""Broker-private Organization and Contact API behavior."""

import pytest


async def _headers(client, email: str) -> dict[str, str]:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123!", "full_name": "Workspace Broker"},
    )
    await client.post("/__test/activate-broker", json={"email": email})
    response = await client.post(
        "/auth/login", json={"email": email, "password": "securepass123!"}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_broker_can_create_organization_and_nested_contact(client):
    headers = await _headers(client, "org-owner@example.com")
    organization = await client.post(
        "/organizations", json={"name": "Harbor Health", "kind": "carrier"}, headers=headers
    )
    assert organization.status_code == 201
    organization_id = organization.json()["id"]

    contact = await client.post(
        f"/organizations/{organization_id}/contacts",
        json={"full_name": "Dana Ruiz", "role": "Broker support", "email": "dana@example.com"},
        headers=headers,
    )
    assert contact.status_code == 201
    assert contact.json()["organization_id"] == organization_id

    detail = await client.get(f"/organizations/{organization_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["contact_count"] == 1
    assert detail.json()["contacts"][0]["full_name"] == "Dana Ruiz"


@pytest.mark.asyncio
async def test_organization_kind_must_be_one_of_the_approved_values(client):
    headers = await _headers(client, "org-kind@example.com")
    for kind in ("carrier", "provider_office", "employer", "agency", "other"):
        response = await client.post(
            "/organizations", json={"name": kind, "kind": kind}, headers=headers
        )
        assert response.status_code == 201
    invalid = await client.post(
        "/organizations", json={"name": "Unknown", "kind": "unknown"}, headers=headers
    )
    assert invalid.status_code == 422


@pytest.mark.asyncio
async def test_archived_organization_is_hidden_and_restorable(client):
    headers = await _headers(client, "org-archive@example.com")
    created = await client.post(
        "/organizations", json={"name": "Archive Me", "kind": "other"}, headers=headers
    )
    organization_id = created.json()["id"]
    await client.post(
        f"/organizations/{organization_id}/contacts",
        json={"full_name": "Active Contact"}, headers=headers,
    )
    archived = await client.post(f"/organizations/{organization_id}/archive", headers=headers)
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert archived.json()["contact_count"] == 1

    active = await client.get("/organizations", headers=headers)
    assert all(item["id"] != organization_id for item in active.json())
    all_records = await client.get("/organizations?include_archived=true", headers=headers)
    assert [item["id"] for item in all_records.json()] == [organization_id]

    restored = await client.post(f"/organizations/{organization_id}/restore", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None


@pytest.mark.asyncio
async def test_contact_can_be_updated_archived_and_restored(client):
    headers = await _headers(client, "contact-lifecycle@example.com")
    org = await client.post(
        "/organizations", json={"name": "Harbor", "kind": "agency"}, headers=headers
    )
    org_id = org.json()["id"]
    created = await client.post(
        f"/organizations/{org_id}/contacts", json={"full_name": "Dana"}, headers=headers
    )
    contact_id = created.json()["id"]
    updated = await client.put(
        f"/organizations/{org_id}/contacts/{contact_id}",
        json={"full_name": "Dana Ruiz", "email": "dana@example.com"}, headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["full_name"] == "Dana Ruiz"
    archived = await client.post(
        f"/organizations/{org_id}/contacts/{contact_id}/archive", headers=headers
    )
    assert archived.status_code == 200
    detail = await client.get(f"/organizations/{org_id}", headers=headers)
    assert detail.json()["contacts"] == []
    restored = await client.post(
        f"/organizations/{org_id}/contacts/{contact_id}/restore", headers=headers
    )
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None


@pytest.mark.asyncio
async def test_other_broker_cannot_mutate_organization_or_contact(client):
    owner = await _headers(client, "org-tenant-a@example.com")
    outsider = await _headers(client, "org-tenant-b@example.com")
    org = await client.post(
        "/organizations", json={"name": "Private", "kind": "carrier"}, headers=owner
    )
    org_id = org.json()["id"]
    contact = await client.post(
        f"/organizations/{org_id}/contacts", json={"full_name": "Private Contact"}, headers=owner
    )
    contact_id = contact.json()["id"]
    paths = [
        ("get", f"/organizations/{org_id}", None),
        ("put", f"/organizations/{org_id}", {"name": "Stolen"}),
        ("post", f"/organizations/{org_id}/archive", None),
        ("post", f"/organizations/{org_id}/restore", None),
        ("post", f"/organizations/{org_id}/contacts", {"full_name": "Intruder"}),
        ("put", f"/organizations/{org_id}/contacts/{contact_id}", {"full_name": "Stolen"}),
        ("post", f"/organizations/{org_id}/contacts/{contact_id}/archive", None),
        ("post", f"/organizations/{org_id}/contacts/{contact_id}/restore", None),
    ]
    for method, path, payload in paths:
        response = await client.request(method.upper(), path, json=payload, headers=outsider)
        assert response.status_code == 404, (method, path, response.text)
