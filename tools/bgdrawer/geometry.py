from .constants import (
    GRID_OFFSET_X,
    GRID_OFFSET_Y_FOR_MAX_ROWS,
    GRID_SIZE_X,
    GRID_SIZE_Y,
    MAX_GRID_ROWS,
)


def get_grid_geometry(grid_rows):
    if grid_rows <= 0:
        raise ValueError("row_number should be a positive integer")
    if grid_rows > MAX_GRID_ROWS:
        raise ValueError(f"row_number should be less than or equal to {MAX_GRID_ROWS}")

    grid_offset_y = (
        GRID_OFFSET_Y_FOR_MAX_ROWS + (MAX_GRID_ROWS - grid_rows) * GRID_SIZE_Y / 2
    )

    return {
        "offset_x": GRID_OFFSET_X,
        "offset_y": grid_offset_y,
        "size_x": GRID_SIZE_X,
        "size_y": GRID_SIZE_Y,
    }


def get_grid_top_left(col, row, grid_rows):
    geometry = get_grid_geometry(grid_rows)
    x = geometry["offset_x"] + col * geometry["size_x"]
    y = geometry["offset_y"] + row * geometry["size_y"]
    return x, y
