#!/bin/sh
# Demo deploy entrypoint (Fly.io combined-container).
#
# 1. Start uvicorn in the background.
# 2. Wait for /health to return 200 (lifespan create_all has run).
# 3. If SEED_DEMO=1, run seed.py — idempotent; skips broker registration on
#    409 (already exists). Seeding is OFF by default so a deploy never
#    auto-provisions accounts unless explicitly opted in.
# 4. Wait on uvicorn so the container stays alive + Fly sees the process.
#
# No admin account is ever auto-provisioned. seed.py creates only a single
# non-privileged demo broker; admins are created out-of-band via
# scripts/promote_admin.py with a deployment-specific password.
#
# seed.py runs after readiness on each boot. Existing Clients and fixture
# markers (including archived records) are skipped. Seeding errors fail boot.

set -eu

echo "[entrypoint] starting uvicorn on 0.0.0.0:8000"
uvicorn healthflow.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

echo "[entrypoint] waiting for /health"
i=0
while [ "$i" -lt 30 ]; do
    if python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=1)" 2>/dev/null; then
        echo "[entrypoint] backend healthy after ${i}s"
        break
    fi
    i=$((i + 1))
    sleep 1
done

if [ "$i" -ge 30 ]; then
    echo "[entrypoint] backend never became healthy — exiting"
    kill "$UVICORN_PID" 2>/dev/null || true
    exit 1
fi

if [ "${SEED_DEMO:-0}" = "1" ]; then
    echo "[entrypoint] SEED_DEMO=1 — seeding demo data (idempotent)"
    if ! python seed.py; then
        echo "[entrypoint] demo seeding failed — exiting"
        kill "$UVICORN_PID" 2>/dev/null || true
        exit 1
    fi
else
    echo "[entrypoint] SEED_DEMO not set — skipping demo seeding"
fi

echo "[entrypoint] handing off to uvicorn (pid=$UVICORN_PID)"
wait "$UVICORN_PID"
