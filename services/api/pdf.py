from collections.abc import Iterable
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageColor
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Image as PDFImage
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from pipeline.models import DesignSpec
from pipeline.prompts import describe_spec

from .integrations import IntegrationError
from .models import Look, Photo, Render, Space, Venue
from .storage import media_path

_SWATCHES = {
    "blush": "#EBC4C0",
    "sage green": "#9BAA8D",
    "champagne": "#F4DFC0",
    "rose gold": "#B76E79",
    "dusty blue": "#829CAF",
    "warm amber": "#FFBF69",
}


def _color(name: str):
    key = name.strip().lower()
    try:
        red, green, blue = ImageColor.getrgb(_SWATCHES.get(key, key.replace(" ", "")))[:3]
        return colors.Color(red / 255, green / 255, blue / 255)
    except ValueError:
        return colors.white


def _thumbnail(root: Path, relative: str, width: int, height: int) -> PDFImage:
    try:
        with Image.open(media_path(root, relative)) as original:
            original.thumbnail((width * 2, height * 2))
            buffer = BytesIO()
            original.convert("RGB").save(buffer, "JPEG", quality=88)
            buffer.seek(0)
            scale = min(width / original.width, height / original.height)
            return PDFImage(buffer, width=original.width * scale, height=original.height * scale)
    except OSError as exc:
        raise IntegrationError(
            409, "A saved image is missing or unreadable; cannot export this look"
        ) from exc


def make_pdf(
    root: Path, venue: Venue, space: Space, look: Look, images: Iterable[tuple[Render, Photo]]
) -> bytes:
    spec = DesignSpec.model_validate(look.design_spec_json)
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        title=look.name,
        pagesize=letter,
        leftMargin=45,
        rightMargin=45,
        topMargin=40,
        bottomMargin=40,
        pageCompression=0,
    )
    styles = getSampleStyleSheet()

    def line(text: str, style: str = "BodyText") -> Paragraph:
        return Paragraph(escape(text), styles[style])

    story = [line(look.name, "Title"), line(f"{venue.name} / {space.name}", "Heading2")]
    if spec.palette:
        story.append(line("Palette", "Heading2"))
        for start in range(0, len(spec.palette), 4):
            row = spec.palette[start : start + 4]
            swatches = Table(
                [[""] * len(row), [line(name) for name in row]],
                colWidths=[(doc.width - 12) / 4] * len(row),
                hAlign="LEFT",
                rowHeights=[20, None],
            )
            swatches.setStyle(
                TableStyle(
                    [("BOX", (i, 0), (i, 0), 0.5, colors.lightgrey) for i in range(len(row))]
                    + [("BACKGROUND", (i, 0), (i, 0), _color(name)) for i, name in enumerate(row)]
                )
            )
            story.append(swatches)
    story.append(line("Design", "Heading2"))
    guests = f" for {spec.guest_count} guests" if spec.guest_count else ""
    event = "an event" if spec.event_type == "other" else f"a {spec.event_type} event"
    story.append(line(f"This look is planned for {event}{guests}."))
    story.extend(line(text) for text in describe_spec(spec))
    if look.warnings_json:
        story.append(line("Warnings", "Heading2"))
        for warning in look.warnings_json:
            story.append(line(f"{warning['message']}. {warning.get('fix') or ''}".strip()))
    for index, (render, photo) in enumerate(images, start=1):
        if not render.path:
            raise IntegrationError(409, "A completed render has no saved image")
        pair = Table(
            [
                [line("Original"), line("Saved render")],
                [_thumbnail(root, photo.path, 236, 164), _thumbnail(root, render.path, 236, 164)],
            ],
            colWidths=[doc.width / 2 - 6] * 2,
            hAlign="LEFT",
        )
        score = "" if render.structure_score is None else f" - structure score {render.structure_score:.2f}"
        group = [line(f"View {index}{score}", "Heading2"), pair]
        if photo.kind == "web":
            source = photo.source_page or photo.source_url or "Source unavailable"
            group.append(line(f"Photo credit: {photo.credit or 'Not provided'}. Source: {source}"))
        qa = render.qa_json or {}
        if qa.get("structure_warning"):
            group.append(line(qa["structure_warning"]))
        for warning in qa.get("rule_warnings", []):
            group.append(line(f"{warning['message']}. {warning.get('fix') or ''}".strip()))
        story.extend([Spacer(1, 10), KeepTogether(group)])
    doc.build(story)
    return buffer.getvalue()
