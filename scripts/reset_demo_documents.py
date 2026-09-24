"""Explicit administrator reset of selected synthetic fixtures only."""
import argparse
import asyncio
import getpass

from dotenv import load_dotenv


async def reset(args, password):
    from sqlalchemy import select
    from healthflow.auth.security import verify_password
    from healthflow.auth.tenant_context import current_broker_id, system_context
    from healthflow.database.config import async_session_factory
    from healthflow.database.models import Broker, Document
    from healthflow.workspace.demo_documents import DEMO_EMAIL, exact_markers, reset_demo_documents, seed_demo_documents
    from healthflow.workspace.document_storage import S3DocumentStorage

    markers = exact_markers(args.fixture)
    async with async_session_factory() as session:
        admin = (await session.scalars(select(Broker).where(Broker.email == args.admin_email))).one_or_none()
        if admin is None or not admin.is_active or admin.role != "admin" or not verify_password(password, admin.hashed_password):
            raise PermissionError("Administrator authentication failed")
        with system_context("preview exact demo Document reset"):
            broker = (await session.scalars(select(Broker).where(Broker.email == DEMO_EMAIL))).one()
            targets = (await session.scalars(select(Document).where(Document.broker_id == broker.id, Document.demo_fixture_marker.in_(markers)))).all()
            print(f"Matched Documents: {len(targets)}")
            for document in targets:
                print(f"  {document.id} {document.demo_fixture_marker}")
        if not args.confirm:
            print("Preview only. Repeat with --confirm to remove and reseed these fixtures.")
            return
        storage = S3DocumentStorage.from_environment()
        token = current_broker_id.set(admin.id)
        try:
            removed = await reset_demo_documents(session, storage, broker.id, markers)
        finally:
            current_broker_id.reset(token)
        with system_context("reseed explicitly reset demo Documents"):
            created = await seed_demo_documents(session, storage, broker.id, fixture_ids=markers)
        print(f"Removed: {removed}; seeded: {created}")


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--fixture", action="append", required=True, help="Exact checked-in marker; repeat for multiple fixtures")
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    try:
        asyncio.run(reset(args, getpass.getpass("Admin password: ")))
    except Exception:
        # Provider exceptions may contain credentials or object details.
        parser.exit(1, "Demo reset failed; inspect metadata-only audit events before retrying.\n")


if __name__ == "__main__":
    main()
