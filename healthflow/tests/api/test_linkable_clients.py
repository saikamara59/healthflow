"""Clients offered for new Broker workspace records must be linkable."""

import pytest
from sqlalchemy import update

from healthflow.database.models import Broker
from healthflow.tests.api.test_enrollments import _client_record, _headers


@pytest.mark.asyncio
async def test_admin_workspace_client_choices_exclude_other_brokers_clients(client, db_session):
    owner = await _headers(client, "issue73-owner@example.com")
    foreign_client = await _client_record(client, owner, "Other broker client")
    admin = await _headers(client, "issue73-admin@example.com")
    own_client = await _client_record(client, admin, "Admin client")
    await db_session.execute(
        update(Broker).where(Broker.email == "issue73-admin@example.com").values(role="admin")
    )
    await db_session.commit()

    # The general Client directory intentionally includes other books for admins.
    directory = await client.get("/clients", headers=admin)
    assert {item["id"] for item in directory.json()} == {
        foreign_client["id"], own_client["id"]
    }

    for path, body in (
        ("/issues", {"title": "Billing discrepancy"}),
        ("/enrollments", {"plan_name": "Harbor Gold PPO"}),
    ):
        selected = next(item for item in directory.json() if item["id"] == foreign_client["id"])
        rejected = await client.post(path, json={"client_id": selected["id"], **body}, headers=admin)
        assert rejected.status_code == 404
        assert rejected.json()["detail"] == "Client not found"

    choices = await client.get("/clients?linkable=true", headers=admin)
    assert choices.status_code == 200
    assert [item["id"] for item in choices.json()] == [own_client["id"]]

    for path, body in (
        ("/issues", {"title": "Billing discrepancy"}),
        ("/enrollments", {"plan_name": "Harbor Gold PPO"}),
    ):
        selected = choices.json()[0]
        created = await client.post(path, json={"client_id": selected["id"], **body}, headers=admin)
        assert created.status_code == 201, created.text
        assert created.json()["client_id"] == selected["id"]
