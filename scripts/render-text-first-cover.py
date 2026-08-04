from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


def cover_crop(image: Image.Image, width: int, height: int) -> Image.Image:
    source_ratio = image.width / image.height
    target_ratio = width / height
    if source_ratio > target_ratio:
        crop_width = round(image.height * target_ratio)
        left = (image.width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, image.height))
    else:
        crop_height = round(image.width / target_ratio)
        top = (image.height - crop_height) // 2
        image = image.crop((0, top, image.width, top + crop_height))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def choose_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"),
        Path(r"C:\Windows\Fonts\simsunb.ttf"),
        Path(r"C:\Windows\Fonts\msyhbd.ttc"),
    ]
    for path in candidates:
        if path.exists():
            font = ImageFont.truetype(str(path), size=size)
            if path.name == "NotoSerifSC-VF.ttf":
                font.set_variation_by_name("Black")
            return font
    raise FileNotFoundError("No supported Chinese font was found")


def fit_font(draw: ImageDraw.ImageDraw, lines: list[str], max_width: int, initial: int) -> ImageFont.FreeTypeFont:
    size = initial
    while size >= 64:
        font = choose_font(size)
        widest = max(draw.textbbox((0, 0), line, font=font)[2] for line in lines)
        if widest <= max_width:
            return font
        size -= 4
    return choose_font(64)


def main() -> None:
    parser = argparse.ArgumentParser(description="Place approved Chinese title text over a darkened background")
    parser.add_argument("--background", required=True)
    parser.add_argument("--title", required=True, help="Use explicit line breaks to make 2-4 lines")
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1440)
    parser.add_argument("--overlay", type=int, default=176, help="Black overlay opacity from 0 to 255")
    args = parser.parse_args()

    lines = [line.strip() for line in args.title.splitlines() if line.strip()]
    if not 2 <= len(lines) <= 4:
        raise ValueError("Title must be split into 2-4 lines")

    image = Image.open(args.background).convert("RGB")
    image = cover_crop(image, args.width, args.height)
    image = ImageEnhance.Color(image).enhance(0.48)
    image = image.filter(ImageFilter.GaussianBlur(radius=max(1, args.width / 450)))
    image = Image.alpha_composite(
        image.convert("RGBA"),
        Image.new("RGBA", image.size, (0, 0, 0, max(0, min(255, args.overlay)))),
    )

    draw = ImageDraw.Draw(image)
    max_width = round(args.width * 0.88)
    font = fit_font(draw, lines, max_width, round(args.width * 0.17))
    line_gap = round(font.size * 0.15)
    boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    heights = [box[3] - box[1] for box in boxes]
    total_height = sum(heights) + line_gap * (len(lines) - 1)
    y = round((args.height - total_height) * 0.47)

    for line, box, height in zip(lines, boxes, heights):
        width = box[2] - box[0]
        x = (args.width - width) // 2
        draw.text(
            (x, y), line, font=font, fill=(255, 255, 255, 255),
        )
        y += height + line_gap

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(output, quality=95, subsampling=0)
    print(output.resolve())


if __name__ == "__main__":
    main()
