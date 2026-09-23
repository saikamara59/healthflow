"""Synthetic fixtures generated in memory only."""

import io
import struct
import zipfile

from PIL import Image
from pypdf import PdfWriter


def word_ole():
    """CFB v3 with a regular 4096-byte WordDocument stream (minimal FIB)."""
    free, end, fat = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD
    header = bytearray(512)
    header[:8] = bytes.fromhex("d0cf11e0a1b11ae1")
    struct.pack_into("<HHHHH", header, 24, 0x3E, 3, 0xFFFE, 9, 6)
    struct.pack_into("<9I", header, 40, 0, 1, 1, 0, 4096, end, 0, end, 0)
    struct.pack_into("<109I", header, 76, 0, *([free] * 108))
    allocation = [fat, end, *range(3, 10), end] + [free] * 118
    directory = bytearray(512)
    for offset, name, kind, child, start, size in [
        (0, "Root Entry", 5, 1, end, 0),
        (128, "WordDocument", 2, free, 2, 4096),
    ]:
        encoded = (name + "\0").encode("utf-16le")
        directory[offset : offset + len(encoded)] = encoded
        struct.pack_into(
            "<HBBIII", directory, offset + 64, len(encoded), kind, 1, free, free, child
        )
        struct.pack_into("<IQ", directory, offset + 116, start, size)
    word = bytearray(4096)
    struct.pack_into("<HH", word, 0, 0xA5EC, 0x00C1)
    return (
        bytes(header)
        + struct.pack("<128I", *allocation)
        + bytes(directory)
        + bytes(word)
    )


def word_zip(extra=None):
    parts = {
        "[Content_Types].xml": b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "word/document.xml": b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
    }
    parts.update(extra or {})
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return stream.getvalue()


def fixture_bytes(name):
    stream = io.BytesIO()
    if name.endswith(".pdf"):
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        writer.write(stream)
    elif name.endswith(".doc"):
        return word_ole()
    elif name.endswith(".docx"):
        return word_zip()
    else:
        Image.new("RGB", (2, 2), "white").save(
            stream, "JPEG" if name.endswith(".jpg") else "PNG"
        )
    return stream.getvalue()
