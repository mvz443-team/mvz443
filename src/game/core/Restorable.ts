/**
 * 统一的“可快照 / 可恢复”契约。
 *
 * 任何需要参与确定性恢复的对象（实体、管理器、注册表）都实现同一接口：
 * - captureSnapshot()：导出影响模拟结果的纯数据；
 * - restoreSnapshot()：把状态写回。
 *
 * 恢复模式：
 * - "in-place"：对象仍然存活，只回写数值（同进程回滚、弱网追帧、断线重连）；
 * - "rebuild"：对象已不存在，需要根据快照重建动态结构（计时器、刚体、投射物）。
 */

import type { RestoreContext, RestoreMode, RestoreReport } from "./SimulationState";

export type { RestoreContext, RestoreMode, RestoreReport };

export interface Restorable<TState = unknown> {
  /** 稳定 key，便于诊断与去重。 */
  readonly snapshotKey: string;
  captureSnapshot(): TState;
  restoreSnapshot(state: TState, context: RestoreContext): void;
}

/** 把子模块的报告合并进父报告。 */
export function mergeReport(target: RestoreReport, label: string, source: RestoreReport): void {
  target.ok = target.ok && source.ok;
  target.restored.push(...source.restored.map((item) => `${label}.${item}`));
  target.missing.push(...source.missing.map((item) => `${label}.${item}`));
  target.errors.push(...source.errors.map((item) => `${label}.${item}`));
}
