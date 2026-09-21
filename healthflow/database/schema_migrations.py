"""Small idempotent schema bridges for deployments that predate Alembic."""

from sqlalchemy import inspect, text


def ensure_phase2_issue_links(connection) -> None:
    """Add nullable Issue links to existing Task and Appointment tables.

    `Base.metadata.create_all` creates the new Phase 2 tables, but intentionally
    does not alter tables that already exist. These two nullable columns are the
    only Phase 2 changes to existing tables, so bridge them explicitly and
    idempotently for both SQLite and PostgreSQL deployments.
    """

    inspector = inspect(connection)
    for table_name in ("tasks", "appointments"):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "issue_id" not in columns:
            connection.execute(
                text(
                    f"ALTER TABLE {table_name} ADD COLUMN issue_id VARCHAR(36) "
                    "REFERENCES issues(id)"
                )
            )
        connection.execute(
            text(
                f"CREATE INDEX IF NOT EXISTS ix_{table_name}_issue_id "
                f"ON {table_name} (issue_id)"
            )
        )
