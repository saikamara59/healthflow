import base64 as _base64
import os

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault(
    "PHI_ENCRYPTION_KEY",
    _base64.b64encode(b"\x00" * 32).decode(),
)
