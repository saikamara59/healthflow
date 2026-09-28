"""Private object operations; bucket privacy must be verified before deployment.

These adapters never produce URLs. Authorization and random key generation
belong to the Document service, never to client-supplied filenames.
"""

import io
import os
import re
import shutil
from pathlib import Path
from typing import BinaryIO, Protocol

import boto3
from botocore.exceptions import ClientError


class DocumentStorage(Protocol):
    def put(self, key: str, body: BinaryIO, content_type: str) -> None: ...
    def get(self, key: str) -> BinaryIO: ...
    def remove(self, key: str) -> None: ...


def _check_key(key: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", key):
        raise ValueError("Expected an opaque Document key")


class FakeDocumentStorage:
    """In-memory private adapter for tests; return independent byte streams."""

    def __init__(self):
        self._objects: dict[str, bytes] = {}

    def put(self, key: str, body: BinaryIO, content_type: str) -> None:
        _check_key(key)
        self._objects[key] = body.read()

    def get(self, key: str) -> BinaryIO:
        _check_key(key)
        try:
            return io.BytesIO(self._objects[key])
        except KeyError:
            raise FileNotFoundError("Document object missing") from None

    def remove(self, key: str) -> None:
        _check_key(key)
        self._objects.pop(key, None)


class LocalDocumentStorage:
    """Optional local development storage, never within a served asset tree.

    Use a dedicated private directory. Directory-relative, no-follow opens
    prevent an object symlink from redirecting reads or writes outside it.
    """

    def __init__(self, root: Path):
        root = Path(root).absolute()
        if any(part.is_symlink() for part in (root, *root.parents)):
            raise ValueError("Document storage root must not contain symlinks")
        root = root.resolve()
        # Match main.py's effective frontend configuration, including an
        # assets mount that resolves outside the frontend through a symlink.
        frontend = Path(os.getenv("HEALTHFLOW_DIST_DIR", "/app/frontend/dist"))
        served_roots = (frontend.resolve(), (frontend / "assets").resolve())
        if any(root.is_relative_to(served) for served in served_roots) or any(
            part.lower() in {"frontend", "static", "public", "dist"}
            for part in root.parts
        ):
            raise ValueError("Document storage must be outside web assets")
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if root.stat().st_mode & 0o077:
            raise ValueError("Document storage root must be private (mode 0700)")
        self._root = root

    def _directory(self):
        return os.open(self._root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def put(self, key: str, body: BinaryIO, content_type: str) -> None:
        _check_key(key)
        directory = self._directory()
        try:
            descriptor = os.open(
                key,
                os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW,
                0o600,
                dir_fd=directory,
            )
            with os.fdopen(descriptor, "wb") as target:
                shutil.copyfileobj(body, target, length=65536)
        finally:
            os.close(directory)

    def get(self, key: str) -> BinaryIO:
        _check_key(key)
        directory = self._directory()
        try:
            return os.fdopen(
                os.open(key, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory), "rb"
            )
        finally:
            os.close(directory)

    def remove(self, key: str) -> None:
        _check_key(key)
        directory = self._directory()
        try:
            try:
                os.unlink(key, dir_fd=directory)
            except FileNotFoundError:
                pass
        finally:
            os.close(directory)


class S3DocumentStorage:
    def __init__(self, bucket: str, *, client=None):
        if not bucket:
            raise ValueError("Document bucket required")
        self._bucket = bucket
        self._client = client if client is not None else boto3.client("s3")

    @classmethod
    def from_environment(cls):
        """Dedicated Document bucket; AWS credentials use the SDK environment.

        DOCUMENT_STORAGE_BUCKET and DOCUMENT_STORAGE_ENDPOINT configure Tigris;
        AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN (optional),
        and AWS_REGION are consumed without ever being returned to a browser.
        """
        bucket = os.environ["DOCUMENT_STORAGE_BUCKET"]
        endpoint = os.environ["DOCUMENT_STORAGE_ENDPOINT"]
        if not endpoint.startswith("https://"):
            raise ValueError("Document storage requires an HTTPS endpoint")
        return cls(
            bucket,
            client=boto3.client(
                "s3",
                endpoint_url=endpoint,
                region_name=os.getenv("AWS_REGION", "auto"),
                aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
                aws_session_token=os.getenv("AWS_SESSION_TOKEN"),
            ),
        )

    def put(self, key: str, body: BinaryIO, content_type: str) -> None:
        _check_key(key)
        self._client.put_object(
            Bucket=self._bucket, Key=key, Body=body, ContentType=content_type
        )

    def get(self, key: str) -> BinaryIO:
        _check_key(key)
        try:
            return self._client.get_object(Bucket=self._bucket, Key=key)["Body"]
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                raise FileNotFoundError("Document object missing") from None
            raise

    def remove(self, key: str) -> None:
        _check_key(key)
        self._client.delete_object(Bucket=self._bucket, Key=key)
