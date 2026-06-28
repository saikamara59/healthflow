from healthflow.logs._sync_engine import sync_url


def test_sync_url_converts_aiosqlite():
    assert sync_url("sqlite+aiosqlite:///healthflow.db") == "sqlite:///healthflow.db"


def test_sync_url_converts_asyncpg_to_psycopg():
    assert sync_url("postgresql+asyncpg://user:pw@host/db") == "postgresql+psycopg://user:pw@host/db"


def test_sync_url_passes_through_unknown():
    assert sync_url("mysql+aiomysql://x") == "mysql+aiomysql://x"
