import { DeferredManager } from "../../managers/DeferredManager";
import type { LogicModel } from "../../core/logic/LogicModel";
import { Faction } from "../../models/Enum";

/**
 * 魅惑命令层：所有临时阵营变更都必须经此进入权威帧队列。
 *
 * - 禁止在 Tween / scene.time.delayedCall 里直接写 charmedBy，否则不进快照且两端时序不同。
 * - 目标 Model 必须声明 charmedBy 字段（PlantModel / MonsterModel），保证回滚可恢复。
 * - MonsterModel 会在 setCharm 内部按 attackTargetRank 重选普攻目标，不重建攻击定时器。
 */
export namespace CharmCmd {
  /**
   * faction 为 null 表示解除魅惑，回到稳定 faction。
   * durationMs <= 0 表示永久魅惑；否则到期由 Model 的 CharmExpired tick 事件清除。
   */
  export function Apply(model: LogicModel, faction: Faction | null, durationMs: number = 0): void {
    DeferredManager.Instance.defer(() => {
      model.setCharm(faction, durationMs);
    });
  }
}
