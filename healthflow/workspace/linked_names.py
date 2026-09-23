"""Batch-load Broker-scoped names used by Task and Appointment responses."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.database.models import Appointment, Client, Contact, Organization, Task


async def load_linked_names(
    db: AsyncSession, records: Iterable[Task | Appointment]
) -> dict[str, dict[UUID, str]]:
    records = list(records)
    names: dict = {"client": {}, "client_archived": {}, "organization": {}, "contact": {}}
    for kind, model, field, attribute in (
        ("client", Client, "client_id", "full_name"),
        ("organization", Organization, "organization_id", "name"),
        ("contact", Contact, "contact_id", "full_name"),
    ):
        ids = {getattr(record, field) for record in records if getattr(record, field) is not None}
        if ids:
            matches = (await db.execute(select(model).where(model.id.in_(ids)))).scalars().all()
            names[kind] = {match.id: getattr(match, attribute) for match in matches}
            if kind == "client":
                names["client_archived"] = {
                    match.id: match.archived_at is not None for match in matches
                }
    return names
