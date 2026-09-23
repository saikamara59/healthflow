"""Deployment bridge for Client archive state on an existing database."""

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from healthflow.database.schema_migrations import ensure_client_archive_column


@pytest.mark.asyncio
async def test_client_archive_bridge_adds_column_once():
    engine = create_async_engine("sqlite+aiosqlite:///")
    async with engine.begin() as connection:
        await connection.execute(text("CREATE TABLE clients (id VARCHAR(36) PRIMARY KEY)"))
        await connection.run_sync(ensure_client_archive_column)
        await connection.run_sync(ensure_client_archive_column)
        columns = await connection.run_sync(
            lambda sync_connection: [item["name"] for item in inspect(sync_connection).get_columns("clients")]
        )
        assert columns.count("archived_at") == 1
    await engine.dispose()
