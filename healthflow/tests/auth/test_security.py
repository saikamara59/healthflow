import pytest
from datetime import timedelta

from healthflow.auth.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)


def test_hash_password_returns_hash():
    hashed = hash_password("mysecretpassword")
    assert hashed != "mysecretpassword"
    assert len(hashed) > 20


def test_verify_password_correct():
    hashed = hash_password("mysecretpassword")
    assert verify_password("mysecretpassword", hashed) is True


def test_verify_password_incorrect():
    hashed = hash_password("mysecretpassword")
    assert verify_password("wrongpassword", hashed) is False


def test_create_and_decode_access_token():
    token = create_access_token({"sub": "broker-123", "role": "broker"})
    payload = decode_token(token)
    assert payload["sub"] == "broker-123"
    assert payload["role"] == "broker"
    assert "exp" in payload


def test_create_access_token_custom_expiry():
    token = create_access_token(
        {"sub": "broker-123", "role": "broker"},
        expires_delta=timedelta(minutes=5),
    )
    payload = decode_token(token)
    assert payload["sub"] == "broker-123"


@pytest.mark.anyio
async def test_create_and_decode_refresh_token(db_session):
    import uuid as _uuid
    broker_id = _uuid.uuid4()
    token = await create_refresh_token(db_session, broker_id)
    payload = decode_token(token)
    assert payload["sub"] == str(broker_id)
    assert payload["type"] == "refresh"
    assert payload["jti"] is not None
    assert "exp" in payload


def test_expired_token_raises():
    token = create_access_token(
        {"sub": "broker-123", "role": "broker"},
        expires_delta=timedelta(seconds=-1),
    )
    with pytest.raises(Exception):
        decode_token(token)


def test_invalid_token_raises():
    with pytest.raises(Exception):
        decode_token("this.is.not.a.valid.token")


def test_tampered_token_raises():
    token = create_access_token({"sub": "broker-123", "role": "broker"})
    # Replace the entire signature segment (after the last `.`) with a
    # syntactically valid but cryptographically invalid one. A single-char
    # flip in base64url can produce a still-valid signature ~1/256 times,
    # which made this test flaky on every push.
    head, _ = token.rsplit(".", 1)
    tampered = head + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    with pytest.raises(Exception):
        decode_token(tampered)


@pytest.mark.parametrize("algorithm", ["HS512", "none"])
def test_tokens_signed_with_any_other_algorithm_are_rejected(algorithm):
    # Algorithm confusion (GHSA-3qf3-8w2g-rqmx and CVE-2024-33663 in python-jose)
    # works only when a service accepts an algorithm it did not choose.
    import base64
    import hashlib
    import hmac
    import json

    from healthflow.auth.security import JWT_SECRET

    def segment(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = segment(json.dumps({"alg": algorithm, "typ": "JWT"}).encode())
    body = segment(json.dumps({"sub": "broker-123", "type": "access", "exp": 4102444800}).encode())
    signing_input = f"{header}.{body}".encode()
    signature = (
        segment(hmac.new(JWT_SECRET.encode(), signing_input, hashlib.sha512).digest())
        if algorithm == "HS512" else ""
    )
    with pytest.raises(ValueError, match="Invalid token"):
        decode_token(f"{header}.{body}.{signature}")
