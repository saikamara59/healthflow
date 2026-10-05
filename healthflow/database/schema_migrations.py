"""Small idempotent schema bridges for deployments that predate Alembic."""

from sqlalchemy import inspect, text


def ensure_demo_document_cleanup_intents(connection) -> None:
    """Idempotently upgrade existing demo databases with the recovery journal."""
    from healthflow.database.models import DemoDocumentCleanupIntent

    DemoDocumentCleanupIntent.__table__.create(connection, checkfirst=True)


def ensure_client_archive_column(connection) -> None:
    """Add Client archive state to databases created before Phase 3."""
    if connection.dialect.name == "postgresql":
        connection.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE"))
        return

    columns = {column["name"] for column in inspect(connection).get_columns("clients")}
    if "archived_at" not in columns:
        connection.execute(text("ALTER TABLE clients ADD COLUMN archived_at DATETIME"))


def ensure_phase2_issue_links(connection) -> None:
    """Add nullable Issue links to existing Task and Appointment tables.

    `Base.metadata.create_all` creates the new Phase 2 tables, but intentionally
    does not alter tables that already exist. These two nullable columns are the
    only Phase 2 changes to existing tables, so bridge them explicitly and
    idempotently for both SQLite and PostgreSQL deployments.
    """

    if connection.dialect.name == "postgresql":
        for table_name in ("tasks", "appointments"):
            connection.execute(
                text(
                    f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS issue_id VARCHAR(36) "
                    "REFERENCES issues(id)"
                )
            )
            connection.execute(
                text(
                    f"CREATE INDEX IF NOT EXISTS ix_{table_name}_issue_id "
                    f"ON {table_name} (issue_id)"
                )
            )
        return

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


def ensure_approval_links(connection) -> None:
    """Add the nullable Approval back-reference to existing Task and Appointment tables.

    `create_all` creates the new approvals table but does not alter tables that
    already exist, so bridge the one new column explicitly and idempotently.
    """
    for table_name in ("tasks", "appointments"):
        if connection.dialect.name == "postgresql":
            connection.execute(text(
                f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS approval_id VARCHAR(36) "
                "REFERENCES approvals(id)"
            ))
            continue
        columns = {column["name"] for column in inspect(connection).get_columns(table_name)}
        if "approval_id" not in columns:
            connection.execute(text(
                f"ALTER TABLE {table_name} ADD COLUMN approval_id VARCHAR(36) REFERENCES approvals(id)"
            ))
