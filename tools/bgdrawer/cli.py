import argparse
from pathlib import Path

from .layers import build_layers, compose_layers
from .psd import write_layered_psd


def main(
    grid_rows,
    grid_cols,
    output_path=None,
    background_path=None,
    tile_paths=None,
    should_write_psd=False,
    psd_output_path=None,
):
    if tile_paths is not None and len(tile_paths) != 2:
        raise ValueError("tile_paths should contain exactly two image paths")

    canvas_size, layers = build_layers(grid_rows, grid_cols, background_path, tile_paths)
    image = compose_layers(layers, canvas_size)

    output_path = Path(output_path or f"grid_{grid_rows}x{grid_cols}.png")
    image.save(output_path)
    print(output_path, "已保存")

    if should_write_psd:
        psd_output_path = Path(psd_output_path or output_path.with_suffix(".psd"))
        write_layered_psd(psd_output_path, canvas_size, layers, image)
        print(psd_output_path, "已保存")


def cli():
    parser = argparse.ArgumentParser(description="生成固定尺寸图片和矩形网格")
    parser.add_argument("-r", type=int, default=6, help="网格行数（最大7）")
    parser.add_argument("-c", type=int, default=9, help="网格列数")
    parser.add_argument("-o", "--output", help="输出 PNG 路径，默认 grid_行x列.png")
    parser.add_argument(
        "-b",
        "--background",
        help="背景图片路径；会先缩放到一个 tile 大小，再平铺到整张图",
    )
    parser.add_argument(
        "-t",
        "--tiles",
        nargs=2,
        metavar=("TILE_A", "TILE_B"),
        help="两个战斗场景 tile 图片路径；会在网格内交错铺放",
    )
    parser.add_argument("--psd", action="store_true", help="同时生成 PSD 文件")
    parser.add_argument("--psd-output", help="输出 PSD 路径，默认与 PNG 同名")
    args = parser.parse_args()

    main(
        args.r,
        args.c,
        output_path=args.output,
        background_path=args.background,
        tile_paths=args.tiles,
        should_write_psd=args.psd,
        psd_output_path=args.psd_output,
    )
