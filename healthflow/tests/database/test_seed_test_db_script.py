"""The e2e stack's schema seed builds the current schema, including new tables."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_seed_test_db_creates_the_current_schema(tmp_path):
    database = tmp_path / "e2e.sqlite"
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{database}", "PYTHONPATH": str(REPO_ROOT)}

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "seed_test_db.py")],
        env=env, capture_output=True, text=True, timeout=120, cwd=REPO_ROOT,
    )

    assert result.returncode == 0, result.stderr
    inspector = inspect(create_engine(f"sqlite:///{database}"))
    assert "approvals" in inspector.get_table_names()
    for table in ("tasks", "appointments"):
        assert "approval_id" in {column["name"] for column in inspector.get_columns(table)}
    assert "archived_at" in {column["name"] for column in inspector.get_columns("clients")}
