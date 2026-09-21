"""Deployment bridge for Phase 2 links on an existing database."""

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from healthflow.database.schema_migrations import ensure_phase2_issue_links


@pytest.mark.asyncio
async def test_phase2_migration_adds_issue_links_idempotently():
    engine = create_async_engine("sqlite+aiosqlite:///")
    async with engine.begin() as connection:
        await connection.execute(text("CREATE TABLE issues (id VARCHAR(36) PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE tasks (id VARCHAR(36) PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE appointments (id VARCHAR(36) PRIMARY KEY)"))
        await connection.run_sync(ensure_phase2_issue_links)
        await connection.run_sync(ensure_phase2_issue_links)

        def columns(sync_connection, table):
            return {item["name"] for item in inspect(sync_connection).get_columns(table)}

        assert "issue_id" in await connection.run_sync(columns, "tasks")
        assert "issue_id" in await connection.run_sync(columns, "appointments")
    await engine.dispose()
