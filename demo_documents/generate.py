"""Regenerate the checked-in invented fixtures; no network or real inputs."""
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

root = Path(__file__).parent
lines = ["SYNTHETIC DEMO - NOT A REAL RECORD", "Invented person: Eleanor Rigby",
         "Sample reference: DEMO-0001", "For HealthFlow sandbox demonstration only."]
for filename, kind in [("synthetic-card.jpg", "JPEG"), ("synthetic-notice.png", "PNG")]:
    image = Image.new("RGB", (640, 180), "white")
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(lines):
        draw.text((20, 20 + index * 30), line, fill="black")
    image.save(root / filename, kind)
writer = PdfWriter()
page = writer.add_blank_page(width=612, height=792)
font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
stream = DecodedStreamObject()
stream.set_data(("BT /F1 12 Tf 40 740 Td " + " 0 -24 Td ".join(f"({line}) Tj" for line in lines) + " ET").encode("ascii"))
page[NameObject("/Contents")] = writer._add_object(stream)
writer.write(root / "synthetic-summary.pdf")
