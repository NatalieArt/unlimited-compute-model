#!/usr/bin/env python3
"""Build lightweight sprite sheets for the scroll animation preview track."""

from pathlib import Path

from PIL import Image


FRAME_STEP = 6
TILE_SIZE = (480, 270)
GRID = (4, 4)
SHEET_SIZE = (1920, 1080)
QUALITY = 68

ROOT = Path(__file__).resolve().parents[1]
FRAMES_DIR = ROOT / "assets" / "gpu-scroll-frames"
OUTPUT_DIR = ROOT / "assets" / "gpu-scroll-preview"


def build_preview_sheets() -> None:
    indices = list(range(0, 361, FRAME_STEP))
    tiles_per_sheet = GRID[0] * GRID[1]
    sheet_count = (len(indices) + tiles_per_sheet - 1) // tiles_per_sheet

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for sheet_index in range(sheet_count):
        sheet = Image.new("RGB", SHEET_SIZE, (0, 0, 0))
        start = sheet_index * tiles_per_sheet
        stop = min(start + tiles_per_sheet, len(indices))

        for global_index in range(start, stop):
            frame_index = indices[global_index]
            source_path = FRAMES_DIR / f"frame-{frame_index:03d}.webp"
            tile_index = global_index - start
            column = tile_index % GRID[0]
            row = tile_index // GRID[0]

            with Image.open(source_path) as source:
                tile = source.convert("RGB").resize(TILE_SIZE, Image.Resampling.LANCZOS)
            sheet.paste(tile, (column * TILE_SIZE[0], row * TILE_SIZE[1]))

        output_path = OUTPUT_DIR / f"sheet-{sheet_index}.webp"
        sheet.save(output_path, "WEBP", quality=QUALITY, method=6, exact=True)
        print(f"Wrote {output_path.relative_to(ROOT)} ({output_path.stat().st_size} bytes)")


if __name__ == "__main__":
    build_preview_sheets()
