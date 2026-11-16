/**
 * Inline 快照：只用于服务端评分/对账的状态摘要，不参与确定性模拟。
 *
 * 这里刻意不包含 Rapier world、Sprite、Tween 与函数对象。
 */

import type { JsonValue, SimulationState } from "../SimulationState.ts";

export interface InlineSnapshot {
  version: 1;
  hash: string;
  payload: JsonValue;
}

export function createInlineSnapshot(state: SimulationState, hash: string): InlineSnapshot {
  return {
    version: 1,
    hash,
    payload: {
      seed: state.seed,
      frameId: state.frameId,
      values: state.values,
      timers: state.timers,
      prngs: state.prngs,
      entities: state.entities,
    },
  };
}

/** 体积上限：单包超过 8KB 时由发送侧退回只传 hash。 */
export function estimateInlineSnapshotBytes(snapshot: InlineSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}

/** 估算值超过阈值时不生成快照正文，只返回 hash，避免超过 WS 8KB 读限制。 */
export function buildInlineSnapshotOrHash(
  state: Parameters<typeof createInlineSnapshot>[0],
  hash: string,
  maxBytes = 6000,
): { hash: string; snapshot: InlineSnapshot | null } {
  const snapshot = createInlineSnapshot(state, hash);
  return {
    hash,
    snapshot: estimateInlineSnapshotBytes(snapshot) <= maxBytes ? snapshot : null,
  };
}
