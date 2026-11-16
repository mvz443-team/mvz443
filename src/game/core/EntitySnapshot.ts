/**
 * 实体逻辑字段的快照编解码。
 *
 * 这里只处理“会影响模拟结果的纯数据”，渲染对象（sprite/viewGroup/scene）、
 * 回调、物理句柄一律跳过。实体可以重写 `captureLogicState` / `restoreLogicState`
 * 扩展自己的字段，而不需要改动本文件。
 */

import type { JsonValue } from "./SimulationState";
import type { RestoreContext } from "./Restorable";
import TickerManager from "../managers/combat/TickerManager";

/** 这些字段属于渲染/运行时基础设施，永远不进入逻辑快照。 */
export const ENTITY_SNAPSHOT_IGNORED: ReadonlySet<string> = new Set([
  "scene", "viewGroup", "model", "tickmanager", "TimerKey", "rigidBody",
  "callback", "context", "args", "ticker", "timer",
  "animController", "attachSprites", "destroyListeners", "colliderZombie",
  "starOrbitSfx", "levelBadge", "sleepingText", "sleepingTween",
  "head", "baseSprite", "mainSprite", "sprite", "trail", "spawnSprite",
  "display", "initialized", "isDestroyQueued", "isDestroyed", "hooks",
  "view", "container", "graphics", "text", "tween", "sound",
]);

/** 默认采集的模拟字段。子类可追加或通过 ignored 排除。 */
export const DEFAULT_ENTITY_SNAPSHOT_FIELDS: readonly string[] = [
  "col", "row", "waveID", "level",
  "currentHealth", "health", "maxHealth", "originalSpeed", "speed",
  "isFlying", "isInVoid", "isDying", "isFrozen", "isStop", "isSleeping", "isTiny",
  "underAttackBy", "attacking", "attackTimer", "recoverTimer",
  "carryStarShards", "carriedStarShards", "starShardsDropped",
  "currentDamage", "currentPenetrate", "penetratePower", "penetratedPunish",
  "traveledDistanceX", "prevX", "maxDistanceX", "bounceable", "skipTiny",
  "hasAttacked", "hasPenetrated", "hasDecorated", "debuff", "debuffDuration",
  "currentStage", "armorHealth", "armorBroken", "armorKey",
  "hasTriggered", "canActivateFromSleep", "lastSkill", "callCount", "random",
  "isBuried", "hasExploded", "explosionDamage", "pendingFlyingMonsters",
  "shieldHealth", "maxShieldHealth", "damagedSum", "inBruteShoot", "isLightning",
  "buffApplied", "shellHealth", "broken", "hasStick", "vaultTargetX",
  "isAttacking", "attackedPlants", "preAttackedPlant",
  "hpTriggers", "flashTriggered", "isHidden", "summoner", "dealer",
  "offsetX", "offsetY", "hasReachedTargetY", "targetRow", "targetY", "ySpeed",
  "lowerOrUpper", "enhancement", "debufs", "ExtraData",
];

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function encodeValue(value: unknown, depth = 0): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "function") return undefined;
  if (depth > 2) return undefined;

  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const encoded = encodeValue(item, depth + 1);
      if (encoded !== undefined) items.push(encoded);
    }
    return items;
  }

  if (value instanceof Set) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const encoded = encodeValue(item, depth + 1);
      if (encoded !== undefined) items.push(encoded);
    }
    items.sort((a, b) => String(a).localeCompare(String(b)));
    return items;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // FrameTimer：只保存剩余帧，恢复时换算成 targetFrame
    if (typeof obj.targetFrame === "number" && typeof obj.interval === "number") {
      return obj.targetFrame - TickerManager.Instance.currentFrame;
    }
    if (typeof obj.remaining === "number") return obj.remaining;

    // 可快照的 PRNG（seedrandom with {state:true}）
    if (typeof obj.state === "function") {
      return encodeValue((obj.state as () => unknown)(), depth + 1);
    }

    // 实体引用：保存稳定 id，恢复时再解析
    if (typeof obj.TimerKey === "string") {
      return `entity:${obj.TimerKey}`;
    }

    // 纯对象（debuffs / ExtraData 等）只保留原始值叶子
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(obj).sort()) {
      const encoded = encodeValue(obj[key], depth + 1);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  }

  return undefined;
}

/** 采集指定对象的逻辑字段。 */
export function captureEntityFields(
  target: object,
  fields: readonly string[],
  extraLogic?: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const obj = target as Record<string, unknown>;
  const out: Record<string, JsonValue> = {};

  for (const key of fields) {
    if (ENTITY_SNAPSHOT_IGNORED.has(key)) continue;
    const encoded = encodeValue(obj[key]);
    if (encoded !== undefined) out[key] = encoded;
  }

  if (extraLogic) {
    for (const [key, value] of Object.entries(extraLogic)) out[key] = value;
  }
  return out;
}

function decodeEntityRef(value: JsonValue, context: RestoreContext): unknown {
  if (typeof value !== "string" || !value.startsWith("entity:")) return undefined;
  return context.resolveEntity?.(value.slice("entity:".length));
}

/**
 * 把快照字段写回对象。
 * 只回写类型兼容的字段；无法解析的引用会写入 report.missing，而不是静默丢弃。
 */
export function restoreEntityFields(
  target: object,
  flags: Record<string, JsonValue>,
  context: RestoreContext,
  snapshotFields: readonly string[] = DEFAULT_ENTITY_SNAPSHOT_FIELDS,
): void {
  const obj = target as Record<string, unknown>;

  // 回滚必须清除“快照时不存在的可选逻辑字段”（例如后来才施加的 freeze），
  // 否则残留状态会让重放与连续运行分叉。
  // 仅限快照字段白名单，避免误删 baseDepth/faction 等基础属性。
  for (const key of snapshotFields) {
    if (ENTITY_SNAPSHOT_IGNORED.has(key) || key in flags) continue;
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const current = obj[key];
    if (
      typeof current === "number" ||
      typeof current === "boolean" ||
      typeof current === "string" ||
      current === null ||
      Array.isArray(current) ||
      current instanceof Set
    ) {
      delete obj[key];
    }
  }

  for (const key of Object.keys(flags).sort()) {
    if (ENTITY_SNAPSHOT_IGNORED.has(key)) continue;
    const value = flags[key];
    const current = obj[key];

    // PRNG：调用 state(...) 还原内部状态
    if (key === "random" && current && typeof (current as { state?: unknown }).state === "function") {
      (current as { state: (state: JsonValue) => void }).state(value);
      continue;
    }

    // 实体引用：恢复为仍然存活的对象
    if (typeof value === "string" && value.startsWith("entity:")) {
      const entity = decodeEntityRef(value, context);
      if (entity !== undefined) obj[key] = entity;
      else context.report.missing.push(`entity-ref:${key}`);
      continue;
    }

    // Set<实体> 或 Set<原始值>
    if (current instanceof Set && Array.isArray(value)) {
      const restored = new Set<unknown>();
      for (const item of value) {
        if (typeof item === "string" && item.startsWith("entity:")) {
          const entity = decodeEntityRef(item, context);
          if (entity !== undefined) restored.add(entity);
        } else if (isPrimitive(item)) {
          restored.add(item);
        }
      }
      obj[key] = restored;
      continue;
    }

    // 定时器：快照里是剩余帧
    if (
      typeof value === "number" &&
      current &&
      typeof current === "object" &&
      typeof (current as { targetFrame?: unknown }).targetFrame === "number"
    ) {
      (current as { targetFrame: number }).targetFrame = context.frameId + Math.max(0, Math.round(value));
      continue;
    }

    // 纯对象：浅层回写原始值（ExtraData / debuffs 的 remaining 等）
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (current && typeof current === "object") {
        for (const [subKey, subValue] of Object.entries(value)) {
          if (typeof subValue === "number" || typeof subValue === "string" || typeof subValue === "boolean" || subValue === null) {
            (current as Record<string, unknown>)[subKey] = subValue;
          }
        }
      }
      continue;
    }

    // 原始值 / 数组：类型兼容才写回
    if (Array.isArray(value)) {
      if (Array.isArray(current) || current === undefined) obj[key] = [...value];
      continue;
    }
    if (isPrimitive(value)) {
      const compatible =
        current === undefined ||
        current === null ||
        typeof current === typeof value;
      if (compatible) obj[key] = value;
      else if (typeof current === "number" && typeof value === "boolean") obj[key] = value ? 1 : 0;
      else context.report.missing.push(`type-mismatch:${key}`);
    }
  }
}
