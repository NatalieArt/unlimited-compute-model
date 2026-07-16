#!/usr/bin/env python3
"""Build sharp desktop and mobile sprite tracks for the scroll animation."""

from pathlib import Path

from PIL import Image


TRACKS = {
    "desktop": {
        "tile": (960, 540),
        "grid": (4, 1),
        "step": 3,
        "quality": 70,
        "crop": False,
    },
    "mobile": {
        "tile": (450, 800),
        "grid": (4, 1),
        "step": 3,
        "quality": 70,
        "crop": True,
    },
    "desktop-hd": {
        "tile": (1440, 810),
        "grid": (3, 1),
        "step": 2,
        "quality": 76,
        "crop": False,
    },
}

ROOT = Path(__file__).resolve().parents[1]
FRAMES_DIR = ROOT / "assets" / "gpu-scroll-frames"


def prepare_tile(source: Image.Image, tile_size: tuple[int, int], crop: bool) -> Image.Image:
    image = source.convert("RGB")
    if crop:
        target_ratio = tile_size[0] / tile_size[1]
        source_ratio = image.width / image.height
        if source_ratio > target_ratio:
            crop_width = round(image.height * target_ratio)
            left = (image.width - crop_width) // 2
            image = image.crop((left, 0, left + crop_width, image.height))
        elif source_ratio < target_ratio:
            crop_height = round(image.width / target_ratio)
            top = (image.height - crop_height) // 2
            image = image.crop((0, top, image.width, top + crop_height))
    return image.resize(tile_size, Image.Resampling.LANCZOS)


def build_track(name: str, configuration: dict[str, object]) -> None:
    tile_size = configuration["tile"]
    grid = configuration["grid"]
    step = configuration["step"]
    quality = configuration["quality"]
    crop = configuration["crop"]
    if not isinstance(tile_size, tuple) or not isinstance(grid, tuple):
        raise TypeError("track tile and grid sizes must be tuples")
    if not isinstance(step, int) or not isinstance(quality, int):
        raise TypeError("track step and quality must be integers")

    sheet_size = (tile_size[0] * grid[0], tile_size[1] * grid[1])
    indices = list(range(0, 361, step))
    tiles_per_sheet = grid[0] * grid[1]
    sheet_count = (len(indices) + tiles_per_sheet - 1) // tiles_per_sheet
    output_dir = ROOT / "assets" / f"gpu-scroll-preview-{name}"
    output_dir.mkdir(parents=True, exist_ok=True)

    for sheet_index in range(sheet_count):
        sheet = Image.new("RGB", sheet_size, (0, 0, 0))
        start = sheet_index * tiles_per_sheet
        stop = min(start + tiles_per_sheet, len(indices))

        for global_index in range(start, stop):
            frame_index = indices[global_index]
            source_path = FRAMES_DIR / f"frame-{frame_index:03d}.webp"
            tile_index = global_index - start
            column = tile_index % grid[0]
            row = tile_index // grid[0]

            with Image.open(source_path) as source:
                tile = prepare_tile(source, tile_size, bool(crop))
            sheet.paste(tile, (column * tile_size[0], row * tile_size[1]))

        output_path = output_dir / f"sheet-{sheet_index}.webp"
        sheet.save(output_path, "WEBP", quality=quality, method=6, exact=True)
        print(f"Wrote {output_path.relative_to(ROOT)} ({output_path.stat().st_size} bytes)")


def build_preview_sheets() -> None:
    for name, configuration in TRACKS.items():
        build_track(name, configuration)


if __name__ == "__main__":
    build_preview_sheets()
