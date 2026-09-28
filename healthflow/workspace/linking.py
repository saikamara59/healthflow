"""Validate optional workspace links within the current Broker's tenant."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.database.models import Appeal, Client, Contact, DocumentLink, Enrollment, Issue, Organization


async def lock_client(db, broker_id, client_id):
    """Serialize Client lifecycle and Document commits across processes.

    Call in a fresh transaction: SQLite cannot upgrade an old WAL snapshot.
    UPDATE locks the row on PostgreSQL and the writer on SQLite. Reload after
    waiting so a cached Client cannot conceal a completed archive transition.
    """
    result = await db.execute(update(Client).where(
        Client.id == client_id, Client.broker_id == broker_id,
    ).values(updated_at=Client.updated_at).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise HTTPException(404, "Client not found")
    return (await db.execute(select(Client).where(
        Client.id == client_id, Client.broker_id == broker_id,
    ).execution_options(populate_existing=True))).scalar_one()


async def lock_document_target(db, broker_id, target_type, target_id):
    """Serialize Link creation and Client reassignment on the same parent row.

    No-op UPDATE also locks on SQLite, where SELECT FOR UPDATE is ignored.
    Refresh after waiting so an identity-map entry cannot hide a reassignment.
    Appeal's Issue is immutable and owns its Client, so lock that Issue.
    """
    if target_type == "appeal":
        target_id = (await db.execute(select(Appeal.issue_id).where(
            Appeal.id == target_id, Appeal.broker_id == broker_id,
        ))).scalar_one_or_none()
        target_type = "issue"
    model = {"enrollment": Enrollment, "issue": Issue}[target_type]
    result = await db.execute(update(model).where(
        model.id == target_id, model.broker_id == broker_id,
    ).values(updated_at=model.updated_at).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise HTTPException(404, "Record not found")
    return (await db.execute(select(model).where(
        model.id == target_id, model.broker_id == broker_id,
    ).execution_options(populate_existing=True))).scalar_one()


async def require_no_document_history(db, broker_id, target_type, target_id):
    """Call with the target lock held; ended Links and archived files count."""
    association = DocumentLink.enrollment_id == target_id
    if target_type == "issue":
        association = or_(DocumentLink.issue_id == target_id, DocumentLink.appeal_id.in_(
            select(Appeal.id).where(Appeal.issue_id == target_id, Appeal.broker_id == broker_id),
        ))
    linked = (await db.execute(select(DocumentLink.id).where(
        DocumentLink.broker_id == broker_id, association,
    ).limit(1))).scalar_one_or_none()
    if linked is not None:
        raise HTTPException(409, "Document Link history prevents changing the Client")


async def require_owned_links(
    db: AsyncSession,
    *,
    client_id: UUID | None = None,
    organization_id: UUID | None = None,
    contact_id: UUID | None = None,
    issue_id: UUID | None = None,
) -> None:
    client = None
    if client_id is not None:
        client = (
            await db.execute(select(Client).where(Client.id == client_id))
        ).scalar_one_or_none()
        if client is None or client.archived_at is not None:
            raise HTTPException(status_code=404, detail="Client not found")

    if issue_id is not None:
        issue = (
            await db.execute(select(Issue).where(Issue.id == issue_id))
        ).scalar_one_or_none()
        if issue is None:
            raise HTTPException(status_code=404, detail="Issue not found")
        if client is not None and issue.client_id != client.id:
            raise HTTPException(status_code=404, detail="Issue not found")
        parent = (await db.execute(select(Client).where(Client.id == issue.client_id))).scalar_one_or_none()
        if parent is None or parent.archived_at is not None:
            raise HTTPException(status_code=404, detail="Issue not found")

    organization = None
    if organization_id is not None:
        organization = (
            await db.execute(select(Organization).where(Organization.id == organization_id))
        ).scalar_one_or_none()
        if organization is None or organization.archived_at is not None:
            raise HTTPException(status_code=404, detail="Organization not found")

    if contact_id is not None:
        contact = (
            await db.execute(select(Contact).where(Contact.id == contact_id))
        ).scalar_one_or_none()
        if contact is None or contact.archived_at is not None:
            raise HTTPException(status_code=404, detail="Contact not found")
        if organization is not None and contact.organization_id != organization.id:
            raise HTTPException(status_code=422, detail="Contact does not belong to Organization")
        if organization is None:
            parent = (
                await db.execute(select(Organization).where(Organization.id == contact.organization_id))
            ).scalar_one_or_none()
            if parent is None or parent.archived_at is not None:
                raise HTTPException(status_code=404, detail="Contact not found")
