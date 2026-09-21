"""Validate optional workspace links within the current Broker's tenant."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.database.models import Client, Contact, Organization


async def require_owned_links(
    db: AsyncSession,
    *,
    client_id: UUID | None = None,
    organization_id: UUID | None = None,
    contact_id: UUID | None = None,
) -> None:
    if client_id is not None:
        client = (
            await db.execute(select(Client).where(Client.id == client_id))
        ).scalar_one_or_none()
        if client is None:
            raise HTTPException(status_code=404, detail="Client not found")

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
