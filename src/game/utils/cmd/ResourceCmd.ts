import ResourceManager from "../../managers/combat/ResourceManager";
import type { Game } from "../../scenes/Game";
import { SfxCmd } from "./SfxCmd";
import { GainEnergySfx } from "../../sfx/energy/GainEnergySfx";
import { GainStarShardSfx } from "../../sfx/star/GainStarShardSfx";
import { PositionManager } from "../../managers/view/PositionManager";
import TickerManager from "../../managers/combat/TickerManager";
import type { JsonValue } from "../../core/SimulationState";
import BackendWS from "../../../utils/net/sync";
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

/**
 * 到账金额规范化：与 timer 工厂的 Number(args.amount) 解析、canonicalize 的
 * 有限数检查保持一致，保证正常到账与 checkpoint 重建到账拿到完全相同的数值。
 */
function sanitizeAmount(amount: number): number {
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 资源收益倍率：只在真实联机房间且尚未 desync 时减半。
 *
 * BackendWS.isOnlineMode() 已经同时排除了 mock 单人房间与 desync 离线态，
 * 分叉后会自动恢复单机全额收益。两端在同一权威逻辑帧读取同一份状态，
 * 因此减半结果确定，并按 halve 后的数值写入 timer args 参与跨端哈希与
 * checkpoint 重建，避免 900ms 后到账时再次读网络状态造成分叉。
 */
function resourceGainMultiplier(): number {
  return BackendWS.isOnlineMode() ? 0.5 : 1;
}

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
   *
   * 联机且未 desync 时收益减半：倍率在“排定 timer 的权威帧”读取一次并写进
   * args，闭包到账与 checkpoint/factory 重建到账都只认 args 里的金额。
   */
  export function AddEnergyToAllWithAnim(amount: number, sfxCfg?: ResourceSfxCfg): void {
    if (amount <= 0) return;
    const effectiveAmount = sanitizeAmount(amount) * resourceGainMultiplier();
    if (effectiveAmount <= 0) return;
    playEnergyAnimation(effectiveAmount, sfxCfg);
    // 到账金额只以 JSON 安全的 args 为唯一数据源：闭包路径与 checkpoint/factory
    // 重建路径读同一份 args，杜绝"原始浮点值"与"JSON 往返值"在某端不一致。
    const args: AddResourceTimerArgs = { amount: effectiveAmount };
    TickerManager.Instance.delayedCall({
      delay: RESOURCE_GAIN_DELAY_MS,
      callback: () => AddEnergyToAll(args.amount),
      snapshot: { kind: RESOURCE_ADD_ENERGY_TIMER, args: args as unknown as JsonValue },
    });
  }

  /**
   * 加星碎（带动画）：立即播指定数量的星碎 SFX，固定 900ms 后统一到账。
   * 减半后可能出现 0.5 块，动画与 HUD 都会显示半块。
   */
  export function AddStarshardToAllWithAnim(amount: number, sfxCfg?: ResourceSfxCfg): void {
    if (amount <= 0) return;
    const effectiveAmount = sanitizeAmount(amount) * resourceGainMultiplier();
    if (effectiveAmount <= 0) return;
    playStarShardAnimation(effectiveAmount, sfxCfg);
    const args: AddResourceTimerArgs = { amount: effectiveAmount };
    TickerManager.Instance.delayedCall({
      delay: RESOURCE_GAIN_DELAY_MS,
      callback: () => AddStarshardToAll(args.amount),
      snapshot: { kind: RESOURCE_ADD_STARSHARD_TIMER, args: args as unknown as JsonValue },
    });
  }

  /** 供 timer 工厂调用：纯到账，不播动画。args 里的金额已应用过收益倍率。 */
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
    const wholeCount = Math.floor(amount);
    let hasHalf = amount - wholeCount >= 0.5;
    // 视觉保底：任何正收益都至少飞出一个星碎（不足半块时也按半块表现）。
    if (wholeCount === 0 && !hasHalf) hasHalf = true;
    const spawn = (half: boolean) => SfxCmd.Create(GainStarShardSfx, {
      scene,
      x: origin.x,
      y: origin.y,
      amount: 1,
      half,
      totalDurationMs: RESOURCE_GAIN_DELAY_MS,
    });
    for (let i = 0; i < wholeCount; i++) {
      spawn(false);
    }
    if (hasHalf) {
      spawn(true);
    }
  }
}

export default ResourceCmd;
