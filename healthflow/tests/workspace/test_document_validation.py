import io
import zipfile

import pytest
from fastapi import UploadFile
from PIL import Image

from healthflow.tests.fixtures.documents import fixture_bytes, word_zip
from healthflow.workspace.document_validation import (
    DocumentTooLarge,
    InvalidDocumentType,
    validate_upload,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,expected",
    [
        ("sample.pdf", "pdf"),
        ("sample.doc", "doc"),
        ("sample.docx", "docx"),
        ("sample.jpg", "jpeg"),
        ("sample.png", "png"),
    ],
)
async def test_valid_fixture(name, expected):
    data = fixture_bytes(name)
    result = await validate_upload(UploadFile(io.BytesIO(data), filename=name))
    with result.stream:
        assert result.verified_type == expected
        assert result.byte_length == len(data)
        assert result.stream.read() == data


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,data",
    [
        ("empty.pdf", b""),
        ("bad.pdf", b"%PDF-1.7"),
        ("bad.png", b"\x89PNG\r\n\x1a\n"),
        ("renamed.pdf", word_zip()),
        ("traversal.docx", word_zip({"../escape": b"x"})),
        ("missing.docx", b"PK\x03\x04"),
        ("mismatch.jpg", fixture_bytes("sample.png")),
    ],
)
async def test_invalid_document(name, data):
    with pytest.raises(InvalidDocumentType):
        await validate_upload(UploadFile(io.BytesIO(data), filename=name))


@pytest.mark.asyncio
async def test_missing_word_parts():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("readme.txt", "invented")
    with pytest.raises(InvalidDocumentType):
        await validate_upload(
            UploadFile(io.BytesIO(stream.getvalue()), filename="fake.docx")
        )


@pytest.mark.asyncio
async def test_decompression_bomb(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1)
    with pytest.raises(InvalidDocumentType):
        await validate_upload(
            UploadFile(io.BytesIO(fixture_bytes("sample.png")), filename="bomb.png")
        )


@pytest.mark.asyncio
async def test_final_chunk_over_limit():
    source = io.BytesIO(b"x" * 65538)
    with pytest.raises(DocumentTooLarge):
        await validate_upload(UploadFile(source, filename="large.pdf"), max_bytes=65536)
    assert source.tell() == 65537


@pytest.mark.asyncio
async def test_exact_limit_and_safe_display_name():
    data = fixture_bytes("sample.pdf")
    result = await validate_upload(
        UploadFile(io.BytesIO(data), filename="../folder\\safe\x00.pdf"),
        max_bytes=len(data),
    )
    with result.stream:
        assert result.display_filename == "safe.pdf"
        assert not hasattr(result, "object_key")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "extra",
    [
        {"/absolute": b"x"},
        {"folder\\escape": b"x"},
        {"word/document.xml": b"not XML"},
        {"word/document.xml": b"<wrong/>"},
        {"[Content_Types].xml": b"<Types/>"},
        {"word/document.xml": b'<!DOCTYPE x [<!ENTITY y "z">]><x>&y;</x>'},
    ],
)
async def test_rejects_unsafe_word_zip(extra):
    with pytest.raises(InvalidDocumentType):
        await validate_upload(
            UploadFile(io.BytesIO(word_zip(extra)), filename="bad.docx")
        )


@pytest.mark.asyncio
async def test_word_zip_expansion_bound(monkeypatch):
    import healthflow.workspace.document_validation as validation

    monkeypatch.setattr(validation, "MAX_ZIP_BYTES", 1024)
    with pytest.raises(InvalidDocumentType):
        await validate_upload(
            UploadFile(
                io.BytesIO(word_zip({"huge": b"x" * 2048})), filename="bomb.docx"
            )
        )


@pytest.mark.asyncio
async def test_temp_stream_closed_on_invalid_input(monkeypatch):
    import healthflow.workspace.document_validation as validation

    temporary = io.BytesIO()
    monkeypatch.setattr(
        validation.tempfile, "TemporaryFile", lambda **kwargs: temporary
    )
    with pytest.raises(InvalidDocumentType):
        await validate_upload(UploadFile(io.BytesIO(b"bad"), filename="bad.pdf"))
    assert temporary.closed


@pytest.mark.asyncio
async def test_default_twenty_mib_limit():
    maximum = 20 * 1024 * 1024
    source = io.BytesIO(b"x" * (maximum + 2))
    with pytest.raises(DocumentTooLarge) as error:
        await validate_upload(UploadFile(source, filename="large.pdf"))
    assert error.value.max_bytes == maximum
    assert source.tell() == maximum + 1


@pytest.mark.asyncio
async def test_non_word_ole_rejected():
    data = fixture_bytes("sample.doc").replace(
        "WordDocument".encode("utf-16le"), "FakeDocument".encode("utf-16le")
    )
    with pytest.raises(InvalidDocumentType):
        await validate_upload(UploadFile(io.BytesIO(data), filename="disguised.doc"))


@pytest.mark.asyncio
async def test_zip_entry_limit():
    data = word_zip({f"part{i}": b"" for i in range(1024)})
    with pytest.raises(InvalidDocumentType):
        await validate_upload(UploadFile(io.BytesIO(data), filename="many.docx"))


@pytest.mark.asyncio
async def test_jpeg_alias_ignores_browser_mime():
    from starlette.datastructures import Headers

    file = UploadFile(
        io.BytesIO(fixture_bytes("sample.jpg")),
        filename="sample.JPEG",
        headers=Headers({"content-type": "text/plain"}),
    )
    result = await validate_upload(file)
    with result.stream:
        assert result.content_type == "image/jpeg"


@pytest.mark.asyncio
async def test_temp_stream_closed_on_read_error(monkeypatch):
    import healthflow.workspace.document_validation as validation

    temporary = io.BytesIO()
    monkeypatch.setattr(
        validation.tempfile, "TemporaryFile", lambda **kwargs: temporary
    )

    class FailedUpload:
        filename = "safe.pdf"

        async def read(self, size):
            raise OSError("interrupted upload")

    with pytest.raises(OSError):
        await validate_upload(FailedUpload())
    assert temporary.closed


@pytest.mark.asyncio
async def test_pdf_malformed_page_content():
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=72, height=72)
    content = DecodedStreamObject()
    content.set_data(b"(unterminated string")
    page[NameObject("/Contents")] = content
    source = io.BytesIO()
    writer.write(source)
    with pytest.raises(InvalidDocumentType):
        await validate_upload(
            UploadFile(io.BytesIO(source.getvalue()), filename="broken.pdf")
        )
