"""Maintain a keyed, tenant-scoped search index without storing plaintext titles."""

import logging

from sqlalchemy import and_, event, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from healthflow.auth.phi_crypto import (
    PhiDecryptionError,
    blind_index_digest,
    current_blind_index_version,
)
from healthflow.auth.tenant_context import system_context
from healthflow.database.models import (
    Appointment,
    Client,
    Contact,
    Organization,
    Task,
    WorkspaceSearchToken,
)

logger = logging.getLogger(__name__)


SEARCHABLE_MODELS = (
    ("client", Client, "full_name"),
    ("organization", Organization, "name"),
    ("contact", Contact, "full_name"),
    ("task", Task, "title"),
    ("appointment", Appointment, "title"),
)


def search_grams(text: str) -> set[str]:
    """Use two- and three-character grams to support substring search."""
    normalized = text.casefold()
    if len(normalized) < 2:
        return {normalized}
    return {
        normalized[index:index + size]
        for size in (2, 3)
        for index in range(max(len(normalized) - size + 1, 0))
    }


def query_grams(text: str) -> set[str]:
    normalized = text.casefold()
    size = min(len(normalized), 3)
    return {normalized[index:index + size] for index in range(len(normalized) - size + 1)}


def _token_rows(kind: str, record, title: str) -> list[dict]:
    version = current_blind_index_version()
    return [
        {
            "broker_id": record.broker_id,
            "kind": kind,
            "record_id": record.id,
            "key_version": version,
            "digest": blind_index_digest(gram, version, str(record.broker_id)),
        }
        for gram in search_grams(title)
    ]


def _index_record(mapper, connection, record) -> None:
    kind, _, field = next(item for item in SEARCHABLE_MODELS if isinstance(record, item[1]))
    table = WorkspaceSearchToken.__table__
    connection.execute(table.delete().where(
        table.c.broker_id == record.broker_id,
        table.c.kind == kind,
        table.c.record_id == record.id,
    ))
    rows = _token_rows(kind, record, getattr(record, field))
    if rows:
        connection.execute(table.insert(), rows)


def _remove_record(mapper, connection, record) -> None:
    kind = next(item[0] for item in SEARCHABLE_MODELS if isinstance(record, item[1]))
    table = WorkspaceSearchToken.__table__
    connection.execute(table.delete().where(
        table.c.broker_id == record.broker_id,
        table.c.kind == kind,
        table.c.record_id == record.id,
    ))


def install_search_index() -> None:
    """Keep tokens in the same transaction as ORM title mutations."""
    for _, model, _ in SEARCHABLE_MODELS:
        for event_name, callback in (
            ("after_insert", _index_record),
            ("after_update", _index_record),
            ("after_delete", _remove_record),
        ):
            if not event.contains(model, event_name, callback):
                event.listen(model, event_name, callback)


async def backfill_search_index(db: AsyncSession) -> None:
    """Index pre-existing encrypted records in bounded startup batches.

    A record whose title cannot be decrypted is logged and skipped, so one bad
    row cannot keep every other record out of search.
    """
    table = WorkspaceSearchToken.__table__
    with system_context("workspace search index backfill"):
        for kind, model, field in SEARCHABLE_MODELS:
            skipped: set = set()
            while True:
                # Select ids only: loading whole rows decrypts them, and one bad
                # value would fail the entire batch.
                query = select(model.id).outerjoin(
                    WorkspaceSearchToken,
                    and_(
                        WorkspaceSearchToken.broker_id == model.broker_id,
                        WorkspaceSearchToken.kind == kind,
                        WorkspaceSearchToken.record_id == model.id,
                    ),
                ).where(WorkspaceSearchToken.record_id.is_(None))
                if skipped:
                    query = query.where(model.id.not_in(skipped))
                record_ids = (await db.execute(query.limit(100))).scalars().all()
                if not record_ids:
                    break
                rows = []
                for record_id in record_ids:
                    try:
                        record = await db.get(model, record_id)
                        rows.extend(_token_rows(kind, record, getattr(record, field)))
                    except PhiDecryptionError:
                        skipped.add(record_id)
                        logger.warning(
                            "Search backfill skipped %s %s: its title cannot be decrypted",
                            kind, record_id,
                        )
                if rows:
                    dialect = db.get_bind().dialect.name
                    if dialect == "postgresql":
                        statement = postgres_insert(table).on_conflict_do_nothing()
                    elif dialect == "sqlite":
                        statement = sqlite_insert(table).on_conflict_do_nothing()
                    else:
                        raise RuntimeError(f"Unsupported search-index backfill dialect: {dialect}")
                    await db.execute(statement, rows)
                await db.commit()
