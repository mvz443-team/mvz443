import argparse
from PIL import Image, ImageDraw

LOGICAL_BATTLE_WIDTH = 800
GRID_OFFSET_X = 50
GRID_OFFSET_Y_FOR_MAX_ROWS = 20
GRID_SIZE_X = 80
GRID_SIZE_Y = 90
MAX_GRID_ROWS = 7
GRID_BOTTOM_MARGIN_FOR_MAX_ROWS = 40
LOGICAL_BATTLE_HEIGHT = (
    GRID_OFFSET_Y_FOR_MAX_ROWS
    + MAX_GRID_ROWS * GRID_SIZE_Y
    + GRID_BOTTOM_MARGIN_FOR_MAX_ROWS
)


def get_grid_geometry(grid_rows):
    if grid_rows <= 0:
        raise ValueError("row_number should be a positive integer")
    if grid_rows > MAX_GRID_ROWS:
        raise ValueError(f"row_number should be less than or equal to {MAX_GRID_ROWS}")

    grid_offset_y = GRID_OFFSET_Y_FOR_MAX_ROWS + (MAX_GRID_ROWS - grid_rows) * GRID_SIZE_Y / 2

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

def main(grid_rows, grid_cols):
    # 创建一张固定 battle viewport 尺寸的透明背景图片
    width, height = LOGICAL_BATTLE_WIDTH, LOGICAL_BATTLE_HEIGHT
    image = Image.new("RGBA", (width, height), (255,255,255,0))
    draw = ImageDraw.Draw(image)
    
    # 固定边框颜色为绿色，边框宽度为1像素
    rect_color = "green"
    
    # 绘制网格中的矩形边框
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
            draw.rectangle(rect_bbox, outline=rect_color, width=1)
    
    # 保存生成的图片
    name = f"grid_{grid_rows}x{grid_cols}.png"
    image.save(name)
    print(name, "已保存")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="生成固定尺寸图片和矩形网格")
    parser.add_argument("-r", type=int, default=6, help="网格行数（最大7）")
    parser.add_argument("-c", type=int, default=9, help="网格列数, 固定而且只能为9")
    args = parser.parse_args()
    
    main(args.r, args.c)
