import ResourceManager from "../../managers/combat/ResourceManager";
import type { Game } from "../../scenes/Game";
import { SfxCmd } from "./SfxCmd";
import { GainEnergySfx } from "../../sfx/energy/GainEnergySfx";
import { GainStarShardSfx } from "../../sfx/star/GainStarShardSfx";
import { PositionManager } from "../../managers/view/PositionManager";
import TickerManager from "../../managers/combat/TickerManager";
import type { JsonValue } from "../../core/SimulationState";
import {
  RESOURCE_GAIN_DELAY_MS,
  RESOURCE_ADD_ENERGY_TIMER,
  RESOURCE_ADD_STARSHARD_TIMER,
  splitEnergyAmount,
  type ResourceSfxCfg,
  type AddResourceTimerArgs,
} from "./ResourceTiming";

/**
 * 资源增加命令层。
 *
 * 基础 API 立即到账；WithAnim 变体把"特效动画"与"资源到账"拆成两个事件：
 * 动画立即播放（纯表现），资源到账由可恢复的全局计时器延迟固定时长后调用基础 API。
 * 计时器的 kind/args 进快照 + 哈希，重连/回滚后由工厂重建回调，保证 desync 安全。
 */

/** 把 col/row 或 x/y 起点解析成世界坐标。 */
function resolveOriginWorld(origin: ResourceSfxCfg["origin"]): { x: number; y: number } {
  if (origin && typeof origin.x === "number" && typeof origin.y === "number") {
    return { x: origin.x, y: origin.y };
  }
  if (origin && typeof origin.col === "number" && typeof origin.row === "number") {
    return PositionManager.Instance.getGridCenter(origin.col, origin.row);
  }
  const bounds = PositionManager.Instance.getGridBounds();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

namespace ResourceCmd {
  export function AddEnergyToAll(amount: number) {
    ResourceManager.Instance.UpdateEnergy(amount, 'all');
  }

  export function AddStarshardToAll(amount: number) {
    ResourceManager.Instance.UpdateStarShards(amount, 'all');
  }

  /**
   * 加能量（带动画）：立即播 100/50/25 拆分的能量 SFX，固定 900ms 后统一到账。
   * 到账只 delay 一次、加总数量，不随 SFX 数量分次。
   */
  export function AddEnergyToAllWithAnim(amount: number, sfxCfg?: ResourceSfxCfg): void {
    if (amount <= 0) return;
    playEnergyAnimation(amount, sfxCfg);
    const args: AddResourceTimerArgs = { amount };
    TickerManager.Instance.delayedCall({
      delay: RESOURCE_GAIN_DELAY_MS,
      callback: () => AddEnergyToAll(amount),
      snapshot: { kind: RESOURCE_ADD_ENERGY_TIMER, args: args as unknown as JsonValue },
    });
  }

  /**
   * 加星碎（带动画）：立即播指定数量的星碎 SFX，固定 900ms 后统一到账。
   */
  export function AddStarshardToAllWithAnim(amount: number, sfxCfg?: ResourceSfxCfg): void {
    if (amount <= 0) return;
    playStarShardAnimation(amount, sfxCfg);
    const args: AddResourceTimerArgs = { amount };
    TickerManager.Instance.delayedCall({
      delay: RESOURCE_GAIN_DELAY_MS,
      callback: () => AddStarshardToAll(amount),
      snapshot: { kind: RESOURCE_ADD_STARSHARD_TIMER, args: args as unknown as JsonValue },
    });
  }

  /** 供 timer 工厂调用：纯到账，不播动画。 */
  export function creditEnergy(amount: number): void {
    AddEnergyToAll(amount);
  }
  export function creditStarshard(amount: number): void {
    AddStarshardToAll(amount);
  }

  function playEnergyAnimation(amount: number, sfxCfg?: ResourceSfxCfg): void {
    const scene = ResourceManager.Instance.getScene();
    if (!scene) return;
    const origin = resolveOriginWorld(sfxCfg?.origin);
    const sizes = sfxCfg?.energySize ? [sfxCfg.energySize] : splitEnergyAmount(amount);
    const stagger = Math.max(0, sfxCfg?.staggerMs ?? 0);
    sizes.forEach((size, index) => {
      // 错峰纯表现（scene.time.delayedCall 合规）；每个 SFX 的可见时长 =
      // 总时长 - 自身错峰偏移，保证所有能量块约在到账时刻一起抵达 HUD。
      const duration = RESOURCE_GAIN_DELAY_MS - index * stagger;
      const spawn = () => SfxCmd.Create(GainEnergySfx, {
        scene,
        x: origin.x,
        y: origin.y,
        size,
        totalDurationMs: duration,
      });
      if (index === 0 || stagger <= 0) spawn();
      else scene.time.delayedCall(index * stagger, spawn);
    });
  }

  function playStarShardAnimation(amount: number, sfxCfg?: ResourceSfxCfg): void {
    const scene = ResourceManager.Instance.getScene();
    if (!scene) return;
    const origin = resolveOriginWorld(sfxCfg?.origin);
    const count = Math.max(1, amount);
    for (let i = 0; i < count; i++) {
      SfxCmd.Create(GainStarShardSfx, {
        scene,
        x: origin.x,
        y: origin.y,
        amount: 1,
        totalDurationMs: RESOURCE_GAIN_DELAY_MS,
      });
    }
  }
}

export default ResourceCmd;
