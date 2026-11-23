/**
 * 水面替代贴图的静态资源约定。
 *
 * 贴图是从各关卡地图背景右侧 20% 区域离线截取的静态 PNG（见 public/assets/bg/water），
 * 运行时按 `watertile0..N` 纹理 key 加载，覆盖水格时随机挑选。
 */
export const WATER_TILE_VARIANT_COUNT = 4;

export function waterTileTextureKey(index: number): string {
  return `watertile${index}`;
}
