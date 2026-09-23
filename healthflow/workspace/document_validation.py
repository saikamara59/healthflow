"""Bounded synthetic-upload validation, not malware detection.

The caller owns and must close the returned private stream. No filename is
ever used as a filesystem path or object key.
"""

import tempfile
import unicodedata
import warnings
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import BinaryIO
from xml.etree import ElementTree

import olefile
from fastapi import UploadFile
from PIL import Image
from pypdf import PdfReader

MAX_ZIP_ENTRIES = 1024
MAX_ZIP_BYTES = 64 * 1024 * 1024
MAX_XML_BYTES = 8 * 1024 * 1024
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "jpeg": "image/jpeg",
    "png": "image/png",
}


class InvalidDocumentType(ValueError):
    def __init__(self):
        super().__init__("Unsupported or malformed Document")


class DocumentTooLarge(ValueError):
    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        super().__init__(f"Document exceeds {max_bytes} bytes")


@dataclass
class ValidatedUpload:
    display_filename: str
    verified_type: str
    content_type: str
    byte_length: int
    stream: BinaryIO


def _display_filename(name: str | None) -> str:
    name = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(
        c for c in name if not unicodedata.category(c).startswith("C")
    ).strip()
    if not name or name in {".", ".."}:
        raise InvalidDocumentType()
    # Preserve the extension when shortening a long display name.
    stem, separator, suffix = name.rpartition(".")
    return stem[:230] + separator + suffix[:20] if separator else name[:251]


def _xml(data: bytes):
    # Disallow DTD/entities entirely, including UTF-16 spellings.
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper() or b"\x00" in data:
        raise InvalidDocumentType()
    return ElementTree.fromstring(data)


def _validate_docx(stream: BinaryIO):
    with zipfile.ZipFile(stream) as archive:
        entries = archive.infolist()
        if (
            len(entries) > MAX_ZIP_ENTRIES
            or sum(e.file_size for e in entries) > MAX_ZIP_BYTES
        ):
            raise InvalidDocumentType()
        names = set()
        for entry in entries:
            name = entry.filename
            if (
                name in names
                or "\\" in name
                or ":" in name
                or name.startswith("/")
                or ".." in PurePosixPath(name).parts
                or entry.flag_bits & 1
                or (entry.external_attr >> 16) & 0o170000 == 0o120000
            ):
                raise InvalidDocumentType()
            names.add(name)
        required = {"[Content_Types].xml", "word/document.xml"}
        if not required <= names:
            raise InvalidDocumentType()
        parts = {}
        # Read all entries to check CRC and actual decompressed lengths under a cap.
        total = 0
        for entry in entries:
            data = bytearray()
            size = 0
            with archive.open(entry) as member:
                while chunk := member.read(min(65536, MAX_ZIP_BYTES - total + 1)):
                    size += len(chunk)
                    total += len(chunk)
                    if total > MAX_ZIP_BYTES:
                        raise InvalidDocumentType()
                    if entry.filename in required:
                        if size > MAX_XML_BYTES:
                            raise InvalidDocumentType()
                        data.extend(chunk)
            if size != entry.file_size:
                raise InvalidDocumentType()
            if entry.filename in required:
                parts[entry.filename] = _xml(bytes(data))
        types = parts["[Content_Types].xml"]
        word = parts["word/document.xml"]
        namespace = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        if types.tag != namespace + "Types" or not any(
            item.get("PartName") == "/word/document.xml"
            and item.get("ContentType") == CONTENT_TYPES["docx"] + ".main+xml"
            for item in types.findall(namespace + "Override")
        ):
            raise InvalidDocumentType()
        if (
            word.tag
            != "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}document"
        ):
            raise InvalidDocumentType()


def _verify(stream: BinaryIO, kind: str):
    signature = stream.read(8)
    stream.seek(0)
    if kind == "pdf":
        if not signature.startswith(b"%PDF-"):
            raise InvalidDocumentType()
        reader = PdfReader(stream, strict=True)
        if reader.is_encrypted or not reader.pages:
            raise InvalidDocumentType()
        for page in reader.pages:
            if page.get("/Type") != "/Page":
                raise InvalidDocumentType()
            contents = page.get_contents()
            if contents is not None:
                # ContentStream defers its operator parser until this access.
                _ = contents.operations
    elif kind in {"jpeg", "png"}:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(stream) as picture:
                if picture.format != {"jpeg": "JPEG", "png": "PNG"}[kind]:
                    raise InvalidDocumentType()
                picture.verify()
            stream.seek(0)
            with Image.open(stream) as picture:
                picture.load()  # JPEG verify alone does not decode truncated pixels.
    elif kind == "doc":
        if not olefile.isOleFile(stream):
            raise InvalidDocumentType()
        stream.seek(0)
        with olefile.OleFileIO(
            stream, raise_defects=olefile.DEFECT_INCORRECT
        ) as document:
            if (
                not document.exists("WordDocument")
                or document.get_size("WordDocument") < 32
            ):
                raise InvalidDocumentType()
            with document.openstream("WordDocument") as word:
                if word.read(2) != b"\xec\xa5":
                    raise InvalidDocumentType()
    else:
        _validate_docx(stream)


async def validate_upload(
    file: UploadFile, max_bytes: int = 20 * 1024 * 1024
) -> ValidatedUpload:
    if max_bytes < 1:
        raise ValueError("max_bytes must be positive")
    name = _display_filename(file.filename)
    extension = name.rsplit(".", 1)[-1].lower()
    kind = "jpeg" if extension in {"jpg", "jpeg"} else extension
    if kind not in CONTENT_TYPES:
        raise InvalidDocumentType()
    stream = tempfile.TemporaryFile(mode="w+b")
    try:
        total = 0
        while chunk := await file.read(min(65536, max_bytes - total + 1)):
            total += len(chunk)
            if total > max_bytes:
                raise DocumentTooLarge(max_bytes)
            stream.write(chunk)
        if not total:
            raise InvalidDocumentType()
        stream.seek(0)
        try:
            _verify(stream, kind)
        except Exception:
            # Do not expose parser errors, file contents, or sensitive names.
            raise InvalidDocumentType() from None
        stream.seek(0)
        return ValidatedUpload(name, kind, CONTENT_TYPES[kind], total, stream)
    except BaseException:
        stream.close()
        raise
