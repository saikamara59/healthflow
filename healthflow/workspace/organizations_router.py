"""Broker-private Organization directory and nested Contacts."""

from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.dependencies import get_current_broker
from healthflow.database.config import get_db
from healthflow.database.models import Broker, Contact, Organization, _utcnow
from healthflow.workspace.schemas import (
    ContactCreate,
    ContactResponse,
    ContactUpdate,
    OrganizationCreate,
    OrganizationResponse,
    OrganizationUpdate,
)
from healthflow.workspace.serializers import contact_response, organization_response


organizations_router = APIRouter(prefix="/organizations", tags=["organizations"])


async def _organization(db: AsyncSession, organization_id: UUID) -> Organization:
    organization = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return organization


async def _contact(db: AsyncSession, organization_id: UUID, contact_id: UUID) -> Contact:
    contact = (
        await db.execute(
            select(Contact).where(
                Contact.id == contact_id, Contact.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


async def _contacts_for(db: AsyncSession, organization_ids: list[UUID]) -> dict[UUID, list[Contact]]:
    if not organization_ids:
        return {}
    contacts = (
        await db.execute(select(Contact).where(Contact.organization_id.in_(organization_ids)))
    ).scalars().all()
    grouped: dict[UUID, list[Contact]] = defaultdict(list)
    for contact in contacts:
        grouped[contact.organization_id].append(contact)
    return grouped


@organizations_router.post("", response_model=OrganizationResponse, status_code=201)
async def create_organization(
    data: OrganizationCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    organization = Organization(broker_id=broker.id, **data.model_dump())
    db.add(organization)
    await db.flush()
    return organization_response(organization)


@organizations_router.get("", response_model=list[OrganizationResponse])
async def list_organizations(
    include_archived: bool = False,
    include_contacts: bool = False,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> list[OrganizationResponse]:
    statement = select(Organization).order_by(Organization.created_at.desc())
    if not include_archived:
        statement = statement.where(Organization.archived_at.is_(None))
    organizations = (await db.execute(statement)).scalars().all()
    grouped = await _contacts_for(db, [organization.id for organization in organizations])
    return [
        organization_response(
            organization,
            contacts=grouped.get(organization.id, []),
            include_contacts=include_contacts,
        )
        for organization in organizations
    ]


@organizations_router.get("/{organization_id}", response_model=OrganizationResponse)
async def get_organization(
    organization_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    organization = await _organization(db, organization_id)
    grouped = await _contacts_for(db, [organization_id])
    return organization_response(organization, contacts=grouped.get(organization_id, []))


@organizations_router.put("/{organization_id}", response_model=OrganizationResponse)
async def update_organization(
    organization_id: UUID,
    data: OrganizationUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    organization = await _organization(db, organization_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(organization, field, value)
    await db.flush()
    grouped = await _contacts_for(db, [organization_id])
    return organization_response(organization, contacts=grouped.get(organization_id, []))


@organizations_router.post("/{organization_id}/archive", response_model=OrganizationResponse)
async def archive_organization(
    organization_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    organization = await _organization(db, organization_id)
    if organization.archived_at is None:
        organization.archived_at = _utcnow()
    await db.flush()
    grouped = await _contacts_for(db, [organization_id])
    return organization_response(organization, contacts=grouped.get(organization_id, []))


@organizations_router.post("/{organization_id}/restore", response_model=OrganizationResponse)
async def restore_organization(
    organization_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    organization = await _organization(db, organization_id)
    organization.archived_at = None
    await db.flush()
    grouped = await _contacts_for(db, [organization_id])
    return organization_response(organization, contacts=grouped.get(organization_id, []))


@organizations_router.post(
    "/{organization_id}/contacts", response_model=ContactResponse, status_code=201
)
async def create_contact(
    organization_id: UUID,
    data: ContactCreate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> ContactResponse:
    organization = await _organization(db, organization_id)
    if organization.archived_at is not None:
        raise HTTPException(status_code=404, detail="Organization not found")
    contact = Contact(broker_id=broker.id, organization_id=organization_id, **data.model_dump())
    db.add(contact)
    await db.flush()
    return contact_response(contact)


@organizations_router.put(
    "/{organization_id}/contacts/{contact_id}", response_model=ContactResponse
)
async def update_contact(
    organization_id: UUID,
    contact_id: UUID,
    data: ContactUpdate,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> ContactResponse:
    await _organization(db, organization_id)
    contact = await _contact(db, organization_id, contact_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    await db.flush()
    return contact_response(contact)


@organizations_router.post(
    "/{organization_id}/contacts/{contact_id}/archive", response_model=ContactResponse
)
async def archive_contact(
    organization_id: UUID,
    contact_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> ContactResponse:
    await _organization(db, organization_id)
    contact = await _contact(db, organization_id, contact_id)
    if contact.archived_at is None:
        contact.archived_at = _utcnow()
    await db.flush()
    return contact_response(contact)


@organizations_router.post(
    "/{organization_id}/contacts/{contact_id}/restore", response_model=ContactResponse
)
async def restore_contact(
    organization_id: UUID,
    contact_id: UUID,
    broker: Broker = Depends(get_current_broker),
    db: AsyncSession = Depends(get_db),
) -> ContactResponse:
    await _organization(db, organization_id)
    contact = await _contact(db, organization_id, contact_id)
    contact.archived_at = None
    await db.flush()
    return contact_response(contact)
