"""Deployment bridge for the Approval back-reference on an existing database."""

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from healthflow.database.schema_migrations import ensure_approval_links


@pytest.mark.asyncio
async def test_approval_migration_adds_back_references_idempotently():
    engine = create_async_engine("sqlite+aiosqlite:///")
    async with engine.begin() as connection:
        await connection.execute(text("CREATE TABLE approvals (id VARCHAR(36) PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE tasks (id VARCHAR(36) PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE appointments (id VARCHAR(36) PRIMARY KEY)"))
        await connection.run_sync(ensure_approval_links)
        await connection.run_sync(ensure_approval_links)

        def columns(sync_connection, table):
            return {item["name"] for item in inspect(sync_connection).get_columns(table)}

        assert "approval_id" in await connection.run_sync(columns, "tasks")
        assert "approval_id" in await connection.run_sync(columns, "appointments")
    await engine.dispose()


def test_postgres_approval_migration_uses_atomic_column_creation():
    class PostgreSQLDialect:
        name = "postgresql"

    class RecordingConnection:
        dialect = PostgreSQLDialect()

        def __init__(self):
            self.statements = []

        def execute(self, statement):
            self.statements.append(str(statement))

    connection = RecordingConnection()

    ensure_approval_links(connection)

    assert len(connection.statements) == 2
    assert all("ADD COLUMN IF NOT EXISTS approval_id" in statement for statement in connection.statements)
