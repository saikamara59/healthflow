"""Async→sync SQLAlchemy URL conversion, shared by the invocation logger and
the decision recorder (both write from synchronous request paths via a
parallel sync engine)."""


def sync_url(async_url: str) -> str:
    """Convert an async SQLAlchemy URL to its sync equivalent.

      * sqlite+aiosqlite:///healthflow.db → sqlite:///healthflow.db
      * postgresql+asyncpg://...          → postgresql+psycopg://...

    Anything else is returned unchanged (SQLAlchemy raises on engine creation —
    better than a silent surprise).
    """
    if async_url.startswith("sqlite+aiosqlite"):
        return async_url.replace("sqlite+aiosqlite", "sqlite", 1)
    if async_url.startswith("postgresql+asyncpg"):
        return async_url.replace("postgresql+asyncpg", "postgresql+psycopg", 1)
    return async_url
