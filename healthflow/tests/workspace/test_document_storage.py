import io

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber

from healthflow.workspace.document_storage import (
    FakeDocumentStorage,
    LocalDocumentStorage,
    S3DocumentStorage,
)


def test_fake_storage():
    store = FakeDocumentStorage()
    source = io.BytesIO(b"synthetic")
    store.put("opaque-key", source, "application/pdf")
    source.close()
    with store.get("opaque-key") as result:
        assert result.read() == b"synthetic"
    store.remove("opaque-key")
    with pytest.raises(FileNotFoundError):
        store.get("opaque-key")
    assert not any("url" in name.lower() for name in dir(store))


def test_s3_private_arguments():
    client = boto3.client(
        "s3", region_name="auto", aws_access_key_id="test", aws_secret_access_key="test"
    )
    store = S3DocumentStorage("private-synthetic", client=client)
    body = io.BytesIO(b"synthetic")
    with Stubber(client) as stub:
        stub.add_response(
            "put_object",
            {},
            {
                "Bucket": "private-synthetic",
                "Key": "opaque-key",
                "Body": body,
                "ContentType": "application/pdf",
            },
        )
        stub.add_response(
            "get_object",
            {"Body": StreamingBody(io.BytesIO(b"synthetic"), 9)},
            {"Bucket": "private-synthetic", "Key": "opaque-key"},
        )
        stub.add_response(
            "delete_object", {}, {"Bucket": "private-synthetic", "Key": "opaque-key"}
        )
        store.put("opaque-key", body, "application/pdf")
        with store.get("opaque-key") as result:
            assert result.read() == b"synthetic"
        store.remove("opaque-key")
        stub.assert_no_pending_responses()
    assert not any("url" in name.lower() for name in dir(store))


def test_local_private_storage(tmp_path):
    root = tmp_path / "private-documents"
    store = LocalDocumentStorage(root)
    store.put("opaque-key", io.BytesIO(b"synthetic"), "application/pdf")
    assert root.stat().st_mode & 0o777 == 0o700
    assert (root / "opaque-key").stat().st_mode & 0o777 == 0o600
    with store.get("opaque-key") as result:
        assert result.read() == b"synthetic"
    store.remove("opaque-key")
    with pytest.raises(FileNotFoundError):
        store.get("opaque-key")


@pytest.mark.parametrize(
    "key", ["../escape", "folder/file", "folder\\file", "/absolute", "file.pdf", ""]
)
def test_storage_rejects_filename_keys(tmp_path, key):
    for store in (FakeDocumentStorage(), LocalDocumentStorage(tmp_path / "private")):
        for operation in (
            lambda: store.put(key, io.BytesIO(b"x"), "application/pdf"),
            lambda: store.get(key),
            lambda: store.remove(key),
        ):
            with pytest.raises(ValueError):
                operation()


def test_local_rejects_webroot_and_symlink(tmp_path):
    with pytest.raises(ValueError):
        LocalDocumentStorage(tmp_path / "frontend" / "uploads")
    store = LocalDocumentStorage(tmp_path / "private")
    target = tmp_path / "untouched"
    target.touch()
    (tmp_path / "private" / "opaque-key").symlink_to(target)
    with pytest.raises(OSError):
        store.put("opaque-key", io.BytesIO(b"overwrite"), "application/pdf")
    with pytest.raises(OSError):
        store.get("opaque-key")
    store.remove("opaque-key")
    assert target.read_bytes() == b""


def test_s3_missing_key():
    client = boto3.client(
        "s3", region_name="auto", aws_access_key_id="test", aws_secret_access_key="test"
    )
    with Stubber(client) as stub:
        stub.add_client_error(
            "get_object",
            service_error_code="NoSuchKey",
            expected_params={"Bucket": "private", "Key": "missing"},
        )
        with pytest.raises(FileNotFoundError):
            S3DocumentStorage("private", client=client).get("missing")


def test_environment_config(monkeypatch):
    monkeypatch.setenv("DOCUMENT_STORAGE_BUCKET", "synthetic-only")
    monkeypatch.setenv("DOCUMENT_STORAGE_ENDPOINT", "https://storage.example.test")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    observed = {}
    client = boto3.client(
        "s3", region_name="auto", aws_access_key_id="test", aws_secret_access_key="test"
    )

    def make_client(service, **kwargs):
        observed.update(kwargs)
        assert service == "s3"
        return client

    monkeypatch.setattr(boto3, "client", make_client)
    store = S3DocumentStorage.from_environment()
    assert observed["endpoint_url"] == "https://storage.example.test"
    with Stubber(client) as stub:
        stub.add_response(
            "delete_object", {}, {"Bucket": "synthetic-only", "Key": "opaque-key"}
        )
        store.remove("opaque-key")
        stub.assert_no_pending_responses()
    monkeypatch.setenv("DOCUMENT_STORAGE_ENDPOINT", "http://storage.example.test")
    with pytest.raises(ValueError):
        S3DocumentStorage.from_environment()
