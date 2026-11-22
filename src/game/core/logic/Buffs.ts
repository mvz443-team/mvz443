/**
 * Buff 系统的纯数据与规则定义。
 *
 * 所有运行时状态都在 Model 上（三个 untilFrame 字段），随快照进哈希；
 * 这里的常量/元数据是静态配置，不进快照。
 *
 * 幂等规则：同一 buff 多次施加时取剩余时间最长者，不叠加强度、不缩短时长。
 * 冲突规则：默认无冲突，可共存；每种 buff 可声明"获得时清除的其它 buff"。
 */

export type BuffKind = 'slow' | 'frozen' | 'berserk';

export interface BuffDefinition {
  /** 获得该 buff 时立即清除的其它 buff；默认空（可共存）。 */
  readonly clearBuffs?: readonly BuffKind[];
}

/** 稳定的声明顺序：用于 tick 事件分派，禁止依赖对象键的插入顺序。 */
export const BUFF_KINDS: readonly BuffKind[] = ['slow', 'frozen', 'berserk'];

export const BUFF_DEFINITIONS: Record<BuffKind, BuffDefinition> = {
  slow: {},
  frozen: {},
  berserk: {},
};

/** frozen 到期后立即施加的减速时长（用户规则，与 ice_bomb 的第二波激光解耦）。 */
export const FROZEN_CHAIN_SLOW_MS = 5000;

/** 每种 buff 独立的到期事件名：避免同类 buff 的 removeByEvent 互相清除。 */
export const BUFF_EVENTS: Record<BuffKind, string> = {
  slow: 'BuffSlowExpired',
  frozen: 'BuffFrozenExpired',
  berserk: 'BuffBerserkExpired',
};
