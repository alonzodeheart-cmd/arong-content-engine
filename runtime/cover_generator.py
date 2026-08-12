from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


SIZES = {
    "cover-3x4.jpg": (1080, 1440),
    "cover-16x9.jpg": (1920, 1080),
    "wechat-header.jpg": (900, 383),
    "wechat-share.jpg": (500, 500),
}


def find_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path(r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def split_title_by_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
    max_lines: int,
) -> tuple[list[str], bool]:
    text = text.strip()
    if not text:
        return ["待确认封面短标题"], True
    lines: list[str] = []
    current = ""
    for char in text:
        candidate = current + char
        box = draw.textbbox((0, 0), candidate, font=font)
        if current and box[2] - box[0] > max_width:
            lines.append(current.rstrip())
            current = char.lstrip()
        else:
            current = candidate
    if current:
        lines.append(current.rstrip())
    return lines[:max_lines], len(lines) <= max_lines


def fit_title(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    initial_size: int,
    minimum_size: int,
    max_lines: int,
) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    for size in range(initial_size, minimum_size - 1, -2):
        font = find_font(size, bold=True)
        lines, complete = split_title_by_width(draw, text, font, max_width, max_lines)
        if complete:
            return font, lines
    font = find_font(minimum_size, bold=True)
    lines, _ = split_title_by_width(draw, text, font, max_width, max_lines)
    if lines:
        last = lines[-1]
        while last:
            candidate = last.rstrip("，。！？：、 ") + "…"
            box = draw.textbbox((0, 0), candidate, font=font)
            if box[2] - box[0] <= max_width:
                lines[-1] = candidate
                break
            last = last[:-1]
    return font, lines


def palette(lane: str) -> dict[str, tuple[int, int, int]]:
    if lane == "project_sop":
        return {
            "bg": (244, 247, 255),
            "ink": (10, 37, 64),
            "muted": (66, 84, 102),
            "accent": (99, 91, 255),
            "soft": (226, 232, 255),
        }
    return {
        "bg": (250, 247, 240),
        "ink": (28, 27, 24),
        "muted": (91, 86, 77),
        "accent": (213, 76, 53),
        "soft": (238, 226, 207),
    }


def rounded_image_card(
    source_path: Path,
    target_size: tuple[int, int],
    radius: int,
) -> Image.Image:
    with Image.open(source_path) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        fitted = ImageOps.fit(source, target_size, method=Image.Resampling.LANCZOS)
    mask = Image.new("L", target_size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, target_size[0], target_size[1]),
        radius=radius,
        fill=255,
    )
    fitted.putalpha(mask)
    return fitted


def draw_cover(
    path: Path,
    size: tuple[int, int],
    title: str,
    lane: str,
    brand: str,
    source_path: Path | None = None,
) -> None:
    width, height = size
    colors = palette(lane)
    image = Image.new("RGB", size, colors["bg"])
    draw = ImageDraw.Draw(image)
    margin = int(min(width, height) * 0.07)

    # Stable accents plus optional real-evidence card for project covers.
    rule_h = max(5, int(height * 0.012))
    draw.rounded_rectangle(
        (margin, margin, width - margin, margin + rule_h),
        radius=rule_h // 2,
        fill=colors["accent"],
    )
    has_source = bool(source_path and source_path.exists())

    horizontal = width / height > 1.3
    square = abs(width - height) < 50
    if horizontal:
        top = int(height * 0.28)
        max_lines = 3
        title_width = int(width * (0.48 if has_source else 0.82))
        initial_size = int(height * 0.112)
        minimum_size = int(height * 0.072)
    elif square:
        top = int(height * 0.23)
        max_lines = 3
        title_width = width - margin * 2
        initial_size = int(height * 0.103)
        minimum_size = int(height * 0.068)
    else:
        top = int(height * 0.23)
        max_lines = 3
        title_width = width - margin * 2
        initial_size = int(width * 0.092)
        minimum_size = int(width * 0.065)

    title_font, lines = fit_title(
        draw,
        title,
        title_width,
        initial_size,
        minimum_size,
        max_lines,
    )
    font_size = title_font.size
    label_font = find_font(max(24, int(min(width, height) * 0.038)), bold=True)
    meta_font = find_font(max(19, int(min(width, height) * 0.027)), bold=False)

    label = "思想观点" if lane == "thought" else "真实项目拆解"
    label_box = draw.textbbox((0, 0), label, font=label_font)
    label_w = label_box[2] - label_box[0]
    label_h = label_box[3] - label_box[1]
    draw.rounded_rectangle(
        (margin, top - label_h - int(height * 0.06), margin + label_w + int(width * 0.04), top - int(height * 0.025)),
        radius=max(10, label_h // 2),
        fill=colors["soft"],
    )
    draw.text((margin + int(width * 0.02), top - label_h - int(height * 0.047)), label, font=label_font, fill=colors["accent"])

    line_gap = int(font_size * 0.34)
    y = top
    for line in lines:
        draw.text((margin, y), line, font=title_font, fill=colors["ink"], stroke_width=0)
        y += font_size + line_gap

    if has_source and source_path:
        if horizontal:
            card_box = (
                int(width * 0.61),
                int(height * 0.18),
                width - margin,
                height - margin,
            )
        elif square:
            card_box = (
                margin,
                int(height * 0.58),
                width - margin,
                height - margin * 2,
            )
        else:
            card_box = (
                margin,
                max(int(height * 0.56), y + int(height * 0.035)),
                width - margin,
                height - margin * 2,
            )
        card_w = max(1, card_box[2] - card_box[0])
        card_h = max(1, card_box[3] - card_box[1])
        shadow_pad = max(5, int(min(width, height) * 0.012))
        draw.rounded_rectangle(
            (
                card_box[0] - shadow_pad,
                card_box[1] - shadow_pad,
                card_box[2] + shadow_pad,
                card_box[3] + shadow_pad,
            ),
            radius=max(18, int(min(width, height) * 0.035)),
            fill=colors["soft"],
        )
        card = rounded_image_card(
            source_path,
            (card_w, card_h),
            max(16, int(min(width, height) * 0.025)),
        )
        image.paste(card, (card_box[0], card_box[1]), card)
    else:
        radius = int(min(width, height) * 0.19)
        cx, cy = width - margin - radius // 2, height - margin - radius // 2
        draw.arc(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            start=205,
            end=510,
            fill=colors["soft"],
            width=max(8, int(radius * 0.12)),
        )

    meta = f"{brand} · 内容档案"
    meta_box = draw.textbbox((0, 0), meta, font=meta_font)
    meta_h = meta_box[3] - meta_box[1]
    draw.rounded_rectangle(
        (
            margin - int(width * 0.012),
            height - margin - meta_h - int(height * 0.025),
            margin + (meta_box[2] - meta_box[0]) + int(width * 0.025),
            height - margin + int(height * 0.012),
        ),
        radius=max(8, meta_h // 2),
        fill=colors["bg"],
    )
    draw.text(
        (margin, height - margin - meta_h - int(height * 0.008)),
        meta,
        font=meta_font,
        fill=colors["muted"],
    )
    image.save(path, "JPEG", quality=94, subsampling=0)


def next_version(media_dir: Path) -> tuple[int, str | None]:
    manifest_path = media_dir / "cover-manifest.json"
    if not manifest_path.exists():
        return 1, None
    try:
        current = json.loads(manifest_path.read_text(encoding="utf-8"))
        match = re.fullmatch(r"v(\d+)", str(current.get("version", "")))
        old_version = match.group(0) if match else "v1"
        return int(match.group(1)) + 1 if match else 2, old_version
    except (json.JSONDecodeError, OSError):
        return 2, "v1"


def archive_previous(media_dir: Path, version: str | None) -> None:
    if not version:
        return
    archive_dir = media_dir / "history" / version
    archive_dir.mkdir(parents=True, exist_ok=True)
    for name in [*SIZES.keys(), "cover-manifest.json"]:
        source = media_dir / name
        if source.exists():
            shutil.copy2(source, archive_dir / name)


def draw_card(
    path: Path,
    index: int,
    total: int,
    card: dict,
    brand: str,
    task: Path,
) -> None:
    width, height = 1080, 1440
    colors = palette("project_sop")
    image = Image.new("RGB", (width, height), colors["bg"])
    draw = ImageDraw.Draw(image)
    margin = 76
    draw.rounded_rectangle(
        (margin, 72, width - margin, 84),
        radius=6,
        fill=colors["accent"],
    )
    number_font = find_font(34, bold=True)
    draw.text(
        (margin, 126),
        f"{index:02d} / {total:02d}",
        font=number_font,
        fill=colors["accent"],
    )
    title_font, title_lines = fit_title(
        draw,
        str(card.get("title", "")),
        width - margin * 2,
        82,
        60,
        3,
    )
    y = 205
    for line in title_lines:
        draw.text((margin, y), line, font=title_font, fill=colors["ink"])
        y += int(title_font.size * 1.34)

    card_type = card.get("type", "checklist")
    content_top = max(440, y + 30)
    if card_type == "evidence" and card.get("asset"):
        candidate = Path(str(card["asset"]))
        source = candidate if candidate.is_absolute() else (task / candidate).resolve()
        if source.exists():
            card_image = rounded_image_card(source, (width - margin * 2, 650), 30)
            image.paste(card_image, (margin, content_top), card_image)
        note = str(card.get("note", "")).strip()
        if note:
            note_font = find_font(32)
            draw.text(
                (margin, 1140),
                note,
                font=note_font,
                fill=colors["muted"],
            )
    elif card_type == "data":
        values = card.get("values") or []
        box_h = 175
        for row, item in enumerate(values[:4]):
            top = content_top + row * (box_h + 22)
            draw.rounded_rectangle(
                (margin, top, width - margin, top + box_h),
                radius=26,
                fill=(255, 255, 255),
                outline=colors["soft"],
                width=4,
            )
            value_font = find_font(55, bold=True)
            label_font = find_font(31, bold=True)
            draw.text((margin + 34, top + 30), str(item.get("value", "")), font=value_font, fill=colors["accent"])
            draw.text((margin + 360, top + 57), str(item.get("label", "")), font=label_font, fill=colors["ink"])
    else:
        items = card.get("steps") or card.get("items") or []
        item_font = find_font(38, bold=True)
        small_font = find_font(28, bold=True)
        box_h = min(170, max(118, int(720 / max(1, len(items)))))
        for row, item in enumerate(items[:6]):
            top = content_top + row * (box_h + 18)
            draw.rounded_rectangle(
                (margin, top, width - margin, top + box_h),
                radius=24,
                fill=(255, 255, 255),
                outline=colors["soft"],
                width=3,
            )
            draw.ellipse(
                (margin + 28, top + 30, margin + 88, top + 90),
                fill=colors["accent"],
            )
            draw.text(
                (margin + 45, top + 40),
                str(row + 1),
                font=small_font,
                fill=(255, 255, 255),
                anchor="mm",
            )
            draw.text(
                (margin + 118, top + 36),
                str(item),
                font=item_font,
                fill=colors["ink"],
            )

    meta_font = find_font(28)
    draw.text(
        (margin, height - 92),
        f"{brand} · 项目复盘",
        font=meta_font,
        fill=colors["muted"],
    )
    image.save(path, "JPEG", quality=94, subsampling=0)


def generate_cards(task: Path, media_dir: Path, brand: str) -> list[dict]:
    cards_path = task / "04-平台文章" / "cards.json"
    if not cards_path.exists():
        return []
    data = json.loads(cards_path.read_text(encoding="utf-8"))
    cards = data.get("cards") if isinstance(data, dict) else None
    if not isinstance(cards, list) or not 4 <= len(cards) <= 6:
        raise SystemExit("cards.json 必须包含 4–6 张卡片")
    output = []
    for index, card in enumerate(cards, 1):
        name = f"card-{index:02d}.jpg"
        draw_card(media_dir / name, index, len(cards), card, brand, task)
        output.append({"name": name, "width": 1080, "height": 1440})
    (media_dir / "cards-manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                "files": output,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", required=True)
    parser.add_argument("--cards-only", action="store_true")
    args = parser.parse_args()
    task = Path(args.task).resolve()
    manifest = json.loads((task / "manifest.json").read_text(encoding="utf-8"))
    brand = str(manifest.get("settings", {}).get("creator_name") or "创作者")
    selected = manifest.get("selected_hook") or {}
    title = selected.get("cover_hook") or manifest["title"]
    media_dir = task / "06-媒体成品"
    media_dir.mkdir(parents=True, exist_ok=True)
    if args.cards_only:
        print(json.dumps(generate_cards(task, media_dir, brand), ensure_ascii=False, indent=2))
        return
    version_number, previous_version = next_version(media_dir)
    archive_previous(media_dir, previous_version)

    source_path = None
    source_value = manifest.get("settings", {}).get("cover_source")
    if source_value:
        candidate = Path(source_value)
        source_path = candidate if candidate.is_absolute() else (task / candidate).resolve()

    for name, size in SIZES.items():
        draw_cover(
            media_dir / name,
            size,
            title,
            manifest["lane"],
            brand,
            source_path,
        )

    result = {
        "schema_version": 1,
        "version": f"v{version_number}",
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "deterministic-layout+real-evidence" if source_path else "deterministic-layout",
        "source_image": str(source_path) if source_path else None,
        "cover_hook": title,
        "files": [
            {"name": name, "width": width, "height": height}
            for name, (width, height) in SIZES.items()
        ],
    }
    (media_dir / "cover-manifest.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if manifest["lane"] == "project_sop":
        result["cards"] = generate_cards(task, media_dir, brand)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
