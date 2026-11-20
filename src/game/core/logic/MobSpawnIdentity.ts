/**
 * 出怪 / 技能召唤实体的确定性身份。
 *
 * 约束（来自联机分叉事故）：
 * - 实体 `id` 直接进入状态哈希，序号分叉等价于整局分叉。
 * - 序号必须在派发 `DeferredManager.defer` 之前同步分配。若在延迟回调里
 *   自增，回滚重放同一命令会重复计数，同帧多命令的先后也会被渲染循环打乱。
 * - 序号本身进入 `wave` 快照，刷新式重连后必须从快照恢复，不能从 0 重来。
 */

/** 单调递增、可快照的实体序号分配器（出怪与召唤共用）。 */
export class SpawnSequence {
  private next = 0;

  /** 分配下一个序号（从 1 开始）。 */
  allocate(): number {
    this.next += 1;
    return this.next;
  }

  capture(): number {
    return this.next;
  }

  restore(value: unknown): void {
    const parsed = Number(value);
    this.next = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }

  reset(): void {
    this.next = 0;
  }
}

/**
 * 怪物稳定快照 key：`mob:<waveId>:<spawnSeq>`。
 * 技能召唤物使用负波次（当前为 -10），与正常波次（>=0）天然隔离，
 * 保证两类实体即使序号重叠也不会撞 key。
 */
export function mobSnapshotId(waveId: number, spawnSeq: number): string {
  return `mob:${waveId}:${spawnSeq}`;
}
