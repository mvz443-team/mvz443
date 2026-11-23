/**
 * 植物 pid 常量（纯数据、零依赖）。
 *
 * 供关卡脚本等非渲染层引用，避免 import 植物 preset 文件而把 Phaser 依赖带进来。
 * 数值必须与各 preset 的 `override pid` 保持一致（pid 是稳定身份，不随关卡变化）。
 */
export const PLANT_PIDS = {
  dispenser: 1,
  furnace: 2,
  obsidian: 3,
  tntMines: 4,
  smallDispenser: 5,
  lily: 6,
  tnt: 7,
  generator: 8,
  pumpkin: 9,
  magicPowder: 10,
  pumpkinWan: 11,
  iceBomb: 12,
  tripleDispenser: 13,
  atDispenser: 14,
  elasticPutin: 15,
  doubleDispenser: 16,
  glowPowder: 17,
  bouncingAnvil: 18,
} as const;
