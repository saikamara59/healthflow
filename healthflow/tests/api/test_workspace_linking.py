"""Tenant-safe workspace relationship validation."""

import pytest
from fastapi import HTTPException

from healthflow.auth.tenant_context import current_broker_id, system_context
from healthflow.database.models import Broker, Client, Contact, Issue, Organization, _utcnow


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["appeals", "tasks", "appointments"])
async def test_archived_issue_client_blocks_new_work_but_allows_existing_updates(client, kind):
    from healthflow.tests.api.test_enrollments import _client_record, _headers

    headers = await _headers(client, "archived-issue-parent@example.com")
    parent = await _client_record(client, headers, "Synthetic parent")
    issue = (await client.post("/issues", headers=headers, json={"client_id": parent["id"], "title": "Synthetic"})).json()
    payload = {"issue_id": issue["id"], "title": "Synthetic work"}
    if kind == "appointments":
        payload.update(starts_at="2030-01-15T10:00:00Z", ends_at="2030-01-15T11:00:00Z")
    existing = await client.post(f"/{kind}", headers=headers, json=payload)
    assert existing.status_code == 201
    assert (await client.post(f"/clients/{parent['id']}/archive", headers=headers)).status_code == 200
    assert (await client.post(f"/{kind}", headers=headers, json=payload)).status_code == 404
    assert (await client.put(f"/{kind}/{existing.json()['id']}", headers=headers, json={"title": "Updated existing work"})).status_code == 200
    if kind == "tasks":
        assert (await client.post(f"/tasks/{existing.json()['id']}/complete", headers=headers)).status_code == 200
    assert (await client.post(f"/clients/{parent['id']}/restore", headers=headers)).status_code == 200
    assert (await client.post(f"/{kind}", headers=headers, json=payload)).status_code == 201


@pytest.mark.asyncio
async def test_link_validation_rejects_foreign_and_mismatched_records(db_session_factory):
    from healthflow.workspace.linking import require_owned_links

    async with db_session_factory() as session:
        with system_context("seed linked-record ownership test"):
            owner = Broker(email="links-owner@example.com", hashed_password="hash", full_name="Owner")
            outsider = Broker(email="links-outsider@example.com", hashed_password="hash", full_name="Outsider")
            session.add_all([owner, outsider])
            await session.flush()
            own_client = Client(
                broker_id=owner.id, full_name="Own Client", zip_code="10001", age=40,
                income_level="medium", doctors=[], prescriptions=[], procedures=[],
            )
            foreign_client = Client(
                broker_id=outsider.id, full_name="Foreign Client", zip_code="10002", age=40,
                income_level="medium", doctors=[], prescriptions=[], procedures=[],
            )
            own_org = Organization(broker_id=owner.id, name="Own Org", kind="carrier")
            other_own_org = Organization(broker_id=owner.id, name="Other Own Org", kind="agency")
            foreign_org = Organization(broker_id=outsider.id, name="Foreign Org", kind="carrier")
            session.add_all([own_client, foreign_client, own_org, other_own_org, foreign_org])
            await session.flush()
            own_contact = Contact(broker_id=owner.id, organization_id=own_org.id, full_name="Own")
            other_own_contact = Contact(
                broker_id=owner.id, organization_id=other_own_org.id, full_name="Other Own"
            )
            foreign_contact = Contact(
                broker_id=outsider.id, organization_id=foreign_org.id, full_name="Foreign"
            )
            session.add_all([own_contact, other_own_contact, foreign_contact])
            await session.commit()

        token = current_broker_id.set(owner.id)
        try:
            await require_owned_links(
                session, client_id=own_client.id, organization_id=own_org.id,
                contact_id=own_contact.id,
            )
            for kwargs in (
                {"client_id": foreign_client.id},
                {"organization_id": foreign_org.id},
                {"contact_id": foreign_contact.id},
            ):
                with pytest.raises(HTTPException) as error:
                    await require_owned_links(session, **kwargs)
                assert error.value.status_code == 404
            with pytest.raises(HTTPException) as mismatch:
                await require_owned_links(
                    session, organization_id=own_org.id, contact_id=other_own_contact.id
                )
            assert mismatch.value.status_code == 422
        finally:
            current_broker_id.reset(token)


@pytest.mark.asyncio
async def test_link_validation_rejects_archived_organization_and_contact(db_session_factory):
    from healthflow.workspace.linking import require_owned_links

    async with db_session_factory() as session:
        with system_context("seed archived link test"):
            broker = Broker(email="links-archive@example.com", hashed_password="hash", full_name="Owner")
            session.add(broker)
            await session.flush()
            organization = Organization(broker_id=broker.id, name="Archived", kind="agency")
            session.add(organization)
            await session.flush()
            contact = Contact(
                broker_id=broker.id, organization_id=organization.id, full_name="Archived Contact"
            )
            session.add(contact)
            await session.commit()

        token = current_broker_id.set(broker.id)
        try:
            organization.archived_at = _utcnow()
            await session.flush()
            with pytest.raises(HTTPException) as archived_org:
                await require_owned_links(session, organization_id=organization.id)
            assert archived_org.value.status_code == 404
            with pytest.raises(HTTPException) as contact_in_archived_org:
                await require_owned_links(session, contact_id=contact.id)
            assert contact_in_archived_org.value.status_code == 404

            organization.archived_at = None
            contact.archived_at = _utcnow()
            await session.flush()
            with pytest.raises(HTTPException) as archived_contact:
                await require_owned_links(session, organization_id=organization.id, contact_id=contact.id)
            assert archived_contact.value.status_code == 404
        finally:
            current_broker_id.reset(token)


@pytest.mark.asyncio
async def test_link_validation_rejects_archived_client(db_session_factory):
    from healthflow.workspace.linking import require_owned_links

    async with db_session_factory() as session:
        with system_context("seed archived Client link test"):
            broker = Broker(email="client-link-archive@example.com", hashed_password="hash", full_name="Owner")
            session.add(broker)
            await session.flush()
            client = Client(
                broker_id=broker.id, full_name="Archived", zip_code="10001", age=40,
                income_level="medium", doctors=[], prescriptions=[], procedures=[],
            )
            session.add(client)
            await session.commit()

        token = current_broker_id.set(broker.id)
        try:
            await require_owned_links(session, client_id=client.id)
            client.archived_at = _utcnow()
            await session.flush()
            with pytest.raises(HTTPException) as archived:
                await require_owned_links(session, client_id=client.id)
            assert archived.value.status_code == 404
            client.archived_at = None
            await session.flush()
            await require_owned_links(session, client_id=client.id)
        finally:
            current_broker_id.reset(token)


@pytest.mark.asyncio
async def test_link_validation_hides_issue_from_different_owned_client(db_session_factory):
    from healthflow.workspace.linking import require_owned_links

    async with db_session_factory() as session:
        with system_context("seed Client Issue mismatch test"):
            broker = Broker(email="issue-client-mismatch@example.com", hashed_password="hash", full_name="Owner")
            session.add(broker)
            await session.flush()
            first = Client(
                broker_id=broker.id, full_name="First", zip_code="10001", age=40,
                income_level="medium", doctors=[], prescriptions=[], procedures=[],
            )
            second = Client(
                broker_id=broker.id, full_name="Second", zip_code="10002", age=41,
                income_level="medium", doctors=[], prescriptions=[], procedures=[],
            )
            session.add_all([first, second])
            await session.flush()
            issue = Issue(broker_id=broker.id, client_id=first.id, title="Owned Issue")
            session.add(issue)
            await session.commit()

        token = current_broker_id.set(broker.id)
        try:
            await require_owned_links(session, client_id=first.id, issue_id=issue.id)
            with pytest.raises(HTTPException) as mismatch:
                await require_owned_links(session, client_id=second.id, issue_id=issue.id)
            assert mismatch.value.status_code == 404
            assert mismatch.value.detail == "Issue not found"
        finally:
            current_broker_id.reset(token)
