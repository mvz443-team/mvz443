/**
 * 实体快照的关系型状态辅助：
 * - 逻辑数值由 LogicModel 自动追踪并快照，这里只处理实体引用 / Set 与 PRNG 对象。
 * - 关系字段按实体族显式声明（logic/LogicRelations.ts），不做通用字段反射。
 */

import type { JsonValue } from "./SimulationState";
import type { RestoreContext } from "./Restorable";

const ENTITY_REF_PREFIX = "entity:";

export function encodeEntityRef(entity: unknown): JsonValue {
  if (!entity) return null;
  const id = (entity as { SnapshotId?: string }).SnapshotId
    ?? (entity as { TimerKey?: string }).TimerKey;
  return typeof id === "string" ? `${ENTITY_REF_PREFIX}${id}` : null;
}

function decodeEntityRef(value: JsonValue, context: RestoreContext): unknown {
  if (typeof value !== "string" || !value.startsWith(ENTITY_REF_PREFIX)) return null;
  return context.resolveEntity?.(value.slice(ENTITY_REF_PREFIX.length)) ?? null;
}

/** 采集单个关系字段；支持实体、实体数组、实体 Set。 */
export function captureRelationField(value: unknown): JsonValue {
  if (value instanceof Set) {
    return [...value].map(encodeEntityRef).filter((item) => item !== null);
  }
  if (Array.isArray(value)) {
    return value.map(encodeEntityRef).filter((item) => item !== null);
  }
  if (value && typeof value === "object") {
    return encodeEntityRef(value);
  }
  return null;
}

/** 采集声明的关系字段。 */
export function captureRelations(
  entity: object,
  fields: readonly string[],
): Record<string, JsonValue> {
  const obj = entity as Record<string, unknown>;
  const out: Record<string, JsonValue> = {};
  for (const field of fields) {
    if (obj[field] === undefined) continue;
    out[field] = captureRelationField(obj[field]);
  }
  return out;
}

/** 恢复关系字段；解析不到的目标会被跳过（并记录 missing）。 */
export function restoreRelations(
  entity: object,
  flags: Record<string, JsonValue>,
  context: RestoreContext,
  fields: readonly string[],
): void {
  const obj = entity as Record<string, unknown>;
  for (const field of fields) {
    if (!(field in flags)) continue;
    const snapshot = flags[field];
    const current = obj[field];

    if (current instanceof Set) {
      const next = new Set<unknown>();
      if (Array.isArray(snapshot)) {
        for (const item of snapshot) {
          const resolved = decodeEntityRef(item, context);
          if (resolved) next.add(resolved);
        }
      }
      obj[field] = next;
      continue;
    }

    if (Array.isArray(snapshot)) {
      const next: unknown[] = [];
      for (const item of snapshot) {
        const resolved = decodeEntityRef(item, context);
        if (resolved) next.push(resolved);
      }
      obj[field] = next;
      continue;
    }

    const resolved = decodeEntityRef(snapshot, context);
    if (resolved) {
      obj[field] = resolved;
    } else if (snapshot === null) {
      obj[field] = null;
    } else {
      context.report.missing.push(`relation:${field}`);
    }
  }
}

/** 采集声明字段上的 seedrandom 状态。 */
export function capturePrngs(
  entity: object,
  fields: readonly string[],
): Record<string, JsonValue> {
  const obj = entity as Record<string, unknown>;
  const out: Record<string, JsonValue> = {};
  for (const field of fields) {
    const value = obj[field] as { state?: () => unknown } | undefined;
    if (value && typeof value.state === "function") {
      out[field] = value.state() as JsonValue;
    }
  }
  return out;
}

/** 恢复 seedrandom 状态（原地 set，不替换对象）。 */
export function restorePrngs(
  entity: object,
  flags: Record<string, JsonValue>,
  fields: readonly string[],
  context: RestoreContext,
): void {
  const obj = entity as Record<string, unknown>;
  for (const field of fields) {
    const snapshot = flags[field];
    if (snapshot === undefined) continue;
    const value = obj[field] as { state?: (state: unknown) => void } | undefined;
    if (value && typeof value.state === "function") {
      value.state(snapshot);
    } else {
      context.report.missing.push(`prng:${field}`);
    }
  }
}
