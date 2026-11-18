/**
 * Inline 快照：只用于服务端评分/对账的状态摘要，不参与确定性模拟。
 *
 * 这里刻意不包含 Rapier world、Sprite、Tween 与函数对象。
 */

import type { JsonValue, SimulationState } from "../SimulationState.ts";
import { SIMULATION_STATE_VERSION } from "../SimulationState.ts";

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
      version: SIMULATION_STATE_VERSION,
      seed: state.seed,
      frameId: state.frameId,
      values: state.values,
      // 本机专属状态不参与跨端哈希，但重连恢复必须一并还原
      // （例如卡槽冷却、输入预演）。旧 checkpoint 没有该字段时按空处理。
      localValues: state.localValues ?? {},
      timers: state.timers,
      prngs: state.prngs,
      entities: state.entities,
    } as unknown as JsonValue,
  };
}

/** 重连回放：把 inline payload 还原成可直接 restore 的 SimulationState。 */
export function restoreInlineSnapshot(snapshot: InlineSnapshot): SimulationState {
  const payload = snapshot.payload;
  if (!payload || typeof payload !== "object" || !("values" in payload)) {
    throw new Error("inline 快照缺少状态正文");
  }
  const body = payload as Record<string, JsonValue>;
  // 哈希口径变化时旧 checkpoint 不能静默升级：字段含义可能已经不同，
  // 必须让重连失败并回退到从头补帧，而不是恢复出一个“看似成功”的错状态。
  if (Number(body.version) !== SIMULATION_STATE_VERSION) {
    throw new Error(`inline 快照版本不匹配: ${String(body.version)}`);
  }
  return {
    version: SIMULATION_STATE_VERSION,
    seed: Number(body.seed) || 0,
    frameId: Number(body.frameId) || 0,
    values: (body.values ?? {}) as unknown as SimulationState["values"],
    localValues: (body.localValues ?? {}) as unknown as NonNullable<SimulationState["localValues"]>,
    timers: (body.timers ?? {}) as unknown as SimulationState["timers"],
    prngs: (body.prngs ?? []) as unknown as SimulationState["prngs"],
    entities: (body.entities ?? []) as unknown as SimulationState["entities"],
    physics: null,
  };
}

/** 体积上限：必须小于服务端 WS 读限制（handlers.SetReadLimit）。 */
export function estimateInlineSnapshotBytes(snapshot: InlineSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}

/**
 * 估算值超过阈值时不生成快照正文。
 *
 * 正文是重连恢复的唯一锚点，不能退化成只传 hash；发送侧会在 snapshot 为
 * null 时直接放弃本次 checkpoint，让服务端继续保留完整历史帧。
 */
export function buildInlineSnapshotOrHash(
  state: Parameters<typeof createInlineSnapshot>[0],
  hash: string,
  maxBytes = 128 * 1024,
): { hash: string; snapshot: InlineSnapshot | null } {
  const snapshot = createInlineSnapshot(state, hash);
  return {
    hash,
    snapshot: estimateInlineSnapshotBytes(snapshot) <= maxBytes ? snapshot : null,
  };
}
