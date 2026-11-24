/**
 * 资源延迟到账的纯常量与类型（零依赖，避免 ResourceCmd ↔ ResourceManager 循环引用）。
 */
import type { GainEnergySfxSize } from "../../sfx/energy/GainEnergySfx";

/** 资源到账固定延迟（ms），与动画起点坐标无关。 */
export const RESOURCE_GAIN_DELAY_MS = 900;

/** timer 语义 kind（工厂注册在 ResourceManager.Load）。 */
export const RESOURCE_ADD_ENERGY_TIMER = "resource.addEnergyWithAnim";
export const RESOURCE_ADD_STARSHARD_TIMER = "resource.addStarshardWithAnim";

/** 动画起点：世界坐标 x/y 或格子坐标 col/row 二选一（优先 x/y）。 */
export type ResourceSfxOrigin = {
  x?: number;
  y?: number;
  col?: number;
  row?: number;
};

/** WithAnim API 的可选动画配置。 */
export type ResourceSfxCfg = {
  origin?: ResourceSfxOrigin;
  /** 能量 SFX 尺寸覆盖；不传时按 100=large / 50=medium / 25=small 自动映射。 */
  energySize?: GainEnergySfxSize;
  /** 星碎数量（仅显示在 SFX 上，不影响到账数量）。 */
  amount?: number;
  /** 多个 SFX 的错峰间隔（ms，纯表现）；0 或不传表示同时播放。 */
  staggerMs?: number;
};

/** timer 参数（纯 JSON，进快照）。 */
export type AddResourceTimerArgs = { amount: number };

/** 把能量数值拆成尽量大的 100/50/25 组合，返回每项对应的 SFX 尺寸。 */
export function splitEnergyAmount(amount: number): GainEnergySfxSize[] {
  let remaining = Math.max(0, Math.floor(amount));
  const parts: GainEnergySfxSize[] = [];
  const units: Array<[number, GainEnergySfxSize]> = [[100, "large"], [50, "medium"], [25, "small"]];
  for (const [value, size] of units) {
    while (remaining >= value) {
      parts.push(size);
      remaining -= value;
    }
  }
  // 不足 25 的余数按 small 显示一个（视觉保底），到账仍按原始 amount。
  if (remaining > 0) parts.push("small");
  return parts;
}
