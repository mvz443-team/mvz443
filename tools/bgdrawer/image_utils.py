from PIL import Image

from .constants import TILE_SIZE

try:
    RESAMPLE_FILTER = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_FILTER = Image.LANCZOS


def load_resized_tile(path, tile_size=TILE_SIZE):
    with Image.open(path) as image:
        return image.convert("RGBA").resize(tile_size, RESAMPLE_FILTER)


def paste_clipped(base, tile, x, y):
    width, height = base.size
    if x >= width or y >= height:
        return

    paste_width = min(tile.width, width - x)
    paste_height = min(tile.height, height - y)
    if paste_width <= 0 or paste_height <= 0:
        return

    clipped_tile = tile.crop((0, 0, paste_width, paste_height))
    base.alpha_composite(clipped_tile, (x, y))
