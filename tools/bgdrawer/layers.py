from PIL import Image, ImageDraw

from .constants import LOGICAL_BATTLE_HEIGHT, LOGICAL_BATTLE_WIDTH
from .geometry import get_grid_geometry
from .image_utils import load_resized_tile, paste_clipped


def create_grid_border_layer(grid_rows, grid_cols, canvas_size):
    layer = Image.new("RGBA", canvas_size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(layer)
    geometry = get_grid_geometry(grid_rows)

    for row in range(grid_rows):
        for col in range(grid_cols):
            x = geometry["offset_x"] + col * geometry["size_x"]
            y = geometry["offset_y"] + row * geometry["size_y"]
            rect_bbox = [
                round(x),
                round(y),
                round(x + geometry["size_x"]),
                round(y + geometry["size_y"]),
            ]
            draw.rectangle(rect_bbox, outline="green", width=1)

    return layer


def create_tiled_background_layer(background_path, canvas_size):
    layer = Image.new("RGBA", canvas_size, (255, 255, 255, 0))
    if not background_path:
        return layer

    tile = load_resized_tile(background_path)
    width, height = canvas_size
    for y in range(0, height, tile.height):
        for x in range(0, width, tile.width):
            paste_clipped(layer, tile, x, y)

    return layer


def create_battle_tiles_layer(grid_rows, grid_cols, tile_paths, canvas_size):
    layer = Image.new("RGBA", canvas_size, (255, 255, 255, 0))
    if not tile_paths:
        return layer

    tiles = [load_resized_tile(path) for path in tile_paths]
    geometry = get_grid_geometry(grid_rows)

    for row in range(grid_rows):
        for col in range(grid_cols):
            tile = tiles[(row + col) % len(tiles)]
            x = round(geometry["offset_x"] + col * geometry["size_x"])
            y = round(geometry["offset_y"] + row * geometry["size_y"])
            paste_clipped(layer, tile, x, y)

    return layer


def compose_layers(layers, canvas_size):
    image = Image.new("RGBA", canvas_size, (255, 255, 255, 0))
    for _, layer in layers:
        image.alpha_composite(layer)
    return image


def build_layers(grid_rows, grid_cols, background_path=None, tile_paths=None):
    canvas_size = (LOGICAL_BATTLE_WIDTH, LOGICAL_BATTLE_HEIGHT)
    layers = [
        ("Green Border", create_grid_border_layer(grid_rows, grid_cols, canvas_size)),
    ]

    if background_path:
        layers.append(
            ("Tiled Background", create_tiled_background_layer(background_path, canvas_size))
        )

    if tile_paths:
        layers.append(
            (
                "Battle Tiles",
                create_battle_tiles_layer(grid_rows, grid_cols, tile_paths, canvas_size),
            )
        )

    return canvas_size, layers
