"""Walk the full RLHF feedback loop end-to-end against an in-memory DB.

Run: .venv/bin/python scripts/demo_rlhf_loop.py

Stages:
  1. Seed agent outputs (action_history) for two agents: compare + translate
  2. Brokers rate those outputs (feedback)  -> human feedback
  3. RewardModel scores outputs cross-broker -> best/worst agent, top/bottom outputs
  4. PromptUpdater turns top-rated outputs into few-shot examples
  5. PromptUpdater spins up an A/B prompt variant and shows weighted routing
"""
import asyncio
import base64
import os
import uuid

# Deterministic test secrets, set before any healthflow.* import (these modules
# raise at import time if the env vars are missing). Demo/test-only — never prod.
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault("PHI_ENCRYPTION_KEY", base64.b64encode(b"\x00" * 32).decode())

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from healthflow.auth.tenant_context import system_context
from healthflow.database.models import (
    ActionHistory,
    Base,
    Broker,
    Client,
    Feedback,
    PromptVariant,
)
from healthflow.database.phi_audit import install_phi_audit
from healthflow.database.tenant_filter import install_raw_sql_guard, install_tenant_filter
from healthflow.feedback.collector import FeedbackCollector
from healthflow.feedback.prompt_updater import PromptUpdater
from healthflow.feedback.reward_model import RewardModel


def rule(title: str) -> None:
    print(f"\n{'=' * 64}\n{title}\n{'=' * 64}")


async def make_broker(db: AsyncSession, tag: str) -> Broker:
    broker = Broker(
        id=uuid.uuid4(),
        email=f"{tag}-{uuid.uuid4().hex[:6]}@demo.com",
        hashed_password="x",
        full_name=f"Broker {tag}",
    )
    db.add(broker)
    await db.flush()
    client = Client(
        id=uuid.uuid4(),
        broker_id=broker.id,
        full_name="Demo Client",
        zip_code="90210",
        age=45,
        income_level="medium",
    )
    db.add(client)
    await db.flush()
    return broker, client


async def make_output(db, broker, client, agent_type, request, response):
    """Create an action_history row = one agent output. Returns its id (the output_id)."""
    oid = uuid.uuid4()
    db.add(
        ActionHistory(
            id=oid,
            broker_id=broker.id,
            client_id=client.id,
            action_type=agent_type,
            request_data=request,
            response_summary=response,
        )
    )
    await db.flush()
    return str(oid)


async def main():
    engine = create_async_engine("sqlite+aiosqlite:///", echo=False)
    install_raw_sql_guard(engine)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    install_tenant_filter(factory)
    install_phi_audit(factory)

    collector = FeedbackCollector()
    reward = RewardModel()
    updater = PromptUpdater()

    async with factory() as db:
        with system_context("rlhf demo"):
            # --- STAGE 1: two brokers, agent outputs -------------------
            rule("STAGE 1  Agent produces outputs (action_history)")
            b1, c1 = await make_broker(db, "alice")
            b2, c2 = await make_broker(db, "bob")

            good_compare = await make_output(
                db, b1, c1, "compare",
                {"zip_code": "90210", "age": 45},
                {"plans": ["Silver PPO", "Gold HMO"], "recommendation": "Silver PPO"},
            )
            ok_compare = await make_output(
                db, b2, c2, "compare",
                {"zip_code": "10001", "age": 30},
                {"plans": ["Bronze HSA"], "recommendation": "Bronze HSA"},
            )
            bad_translate = await make_output(
                db, b1, c1, "translate",
                {"text": "deductible", "lang": "es"},
                {"translation": "deducible (literal, no context)"},
            )
            print(f"compare output  (good): {good_compare[:8]}…")
            print(f"compare output  (ok)  : {ok_compare[:8]}…")
            print(f"translate output (bad): {bad_translate[:8]}…")

            # --- STAGE 2: humans rate the outputs ----------------------
            rule("STAGE 2  Humans submit feedback (1-5 per dimension)")
            # good compare output: rated highly by both brokers
            await collector.submit(db, b1.id, good_compare, "compare", 5, 5, 5, "spot on")
            await collector.submit(db, b2.id, good_compare, "compare", 5, 4, 5, "great")
            # ok compare output: middling
            await collector.submit(db, b2.id, ok_compare, "compare", 4, 4, 3)
            # bad translate output: poor
            await collector.submit(db, b1.id, bad_translate, "translate", 2, 2, 1, "wrong term")
            print("submitted 4 feedback rows across 2 brokers, 2 agents")

            # --- STAGE 3: reward model scores cross-broker -------------
            rule("STAGE 3  RewardModel.score_outputs() (cross-broker)")
            report = await reward.score_outputs(db, days=7)
            for a in report["agents"]:
                print(
                    f"  {a['agent_type']:9} n={a['total_feedback']} "
                    f"acc={a['avg_accuracy']} cla={a['avg_clarity']} "
                    f"hlp={a['avg_helpfulness']} -> combined={a['combined_avg']}"
                )
            print(f"\n  best_agent   : {report['best_agent']}")
            print(f"  worst_agent  : {report['worst_agent']}")
            print(f"  overall_avg  : {report['overall_avg']}")
            print(f"  top outputs (>=4.5)  : {[o[:8] for o in report['top_output_ids']]}")
            print(f"  bottom outputs (<3.0): {[o[:8] for o in report['bottom_output_ids']]}")
            print(f"  low_score_count      : {report['low_score_count']}")

            # --- STAGE 4: top outputs -> few-shot examples ------------
            rule("STAGE 4  PromptUpdater.generate_few_shot('compare')")
            few_shot = await updater.generate_few_shot(db, "compare", top_n=2)
            print(few_shot)

            # --- STAGE 5: create an A/B variant -----------------------
            rule("STAGE 5  PromptUpdater.create_variant() — A/B routing")

            # Seed the baseline the agent ships with today: a 'control' variant
            # at 100% traffic. create_variant() only splits traffic against
            # variants that already exist, so without this the new variant would
            # get 100% by default (it'd be the only active row).
            control = PromptVariant(
                id=uuid.uuid4(),
                agent_type="compare",
                variant_name="control",
                prompt_template="You are a plan-comparison agent.",
                is_active=True,
                traffic_pct=100,
            )
            db.add(control)
            await db.flush()
            print(f"seeded baseline '{control.variant_name}' @ {control.traffic_pct}% traffic")

            # Now roll out the feedback-improved prompt to 30% of traffic.
            # create_variant proportionally shrinks existing variants to fit.
            improved_prompt = (
                "You are a plan-comparison agent.\n" + few_shot
            )
            variant = await updater.create_variant(
                db, "compare", improved_prompt, traffic_pct=30
            )
            await db.refresh(control)
            print(f"created variant '{variant.variant_name}' @ {variant.traffic_pct}% traffic")
            print(f"'control' shrunk to {control.traffic_pct}% to make room")

            # Show weighted routing over 1000 draws — should land near 70/30
            counts = {}
            for _ in range(1000):
                v = await updater.get_active_variant(db, "compare")
                counts[v.variant_name] = counts.get(v.variant_name, 0) + 1
            print(f"routing over 1000 requests: {counts}")

    await engine.dispose()
    rule("LOOP COMPLETE")
    print("output -> feedback -> reward score -> few-shot prompt -> A/B variant")


if __name__ == "__main__":
    asyncio.run(main())
