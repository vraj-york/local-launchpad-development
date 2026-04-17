#!/usr/bin/env python3
"""Generate PWA icons with 'CLR' in a pixel font."""

import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow is required: pip install Pillow")
    raise SystemExit(1)

# 5x7 pixel bitmaps for C, L, R
GLYPHS = {
    "C": [
        "01110",
        "10001",
        "10000",
        "10000",
        "10000",
        "10001",
        "01110",
    ],
    "L": [
        "10000",
        "10000",
        "10000",
        "10000",
        "10000",
        "10000",
        "11111",
    ],
    "R": [
        "11110",
        "10001",
        "10001",
        "11110",
        "10100",
        "10010",
        "10001",
    ],
}

BG = (10, 10, 11)       # #0a0a0b
FG = (232, 232, 232)     # #e8e8e8


def render_text(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (*BG, 255))
    draw = ImageDraw.Draw(img)

    text = "CLR"
    glyph_w, glyph_h = 5, 7
    spacing = 1
    total_w = len(text) * glyph_w + (len(text) - 1) * spacing
    total_h = glyph_h

    # pixel scale — leave ~30% padding on each side
    usable = int(size * 0.55)
    scale = max(1, usable // total_w)

    px_w = total_w * scale
    px_h = total_h * scale
    ox = (size - px_w) // 2
    oy = (size - px_h) // 2 - scale  # nudge up slightly

    for ci, ch in enumerate(text):
        glyph = GLYPHS[ch]
        gx = ox + ci * (glyph_w + spacing) * scale
        for row_i, row in enumerate(glyph):
            for col_i, bit in enumerate(row):
                if bit == "1":
                    x = gx + col_i * scale
                    y = oy + row_i * scale
                    draw.rectangle([x, y, x + scale - 1, y + scale - 1], fill=FG)

    # rounded corners via mask
    mask = Image.new("L", (size, size), 0)
    radius = max(1, size // 5)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)

    return img


def main() -> None:
    root = Path(__file__).resolve().parent.parent

    outputs = {
        root / "src" / "app" / "icon.png": 32,
        root / "src" / "app" / "apple-icon.png": 180,
        root / "public" / "icon-192.png": 192,
        root / "public" / "icon-512.png": 512,
        root / "public" / "apple-touch-icon.png": 180,
    }

    for path, size in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        img = render_text(size)
        img.save(str(path), "PNG")
        print(f"  {path.relative_to(root)}  ({size}x{size})")

    print("Done.")


if __name__ == "__main__":
    main()
