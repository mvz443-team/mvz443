/**
 * 把运行时各单例管理器接入 SimulationState 注册中心。
 *
 * 这里只做「状态读取 / 就地恢复」，不参与任何 Phaser 渲染逻辑；
 * SimulationState 本身不依赖本文件，可在无 Phaser 的 Node 环境下单独测试。
 */

import type { EntityLogicState, JsonValue, TimerState, PrngState } from "./SimulationState";
// seedrandom 的 State 类型在 MobManager 内部使用；这里只传递 unknown 状态对象。
import { simulationState } from "./SimulationState";
import CombatManager from "../managers/CombatManager";
import TickerManager from "../managers/combat/TickerManager";
import MobManager from "../managers/combat/MobManager";
import PlantsManager from "../managers/combat/PlantsManager";
import ObstacleManager from "../managers/combat/ObstacleManager";
import ResourceManager from "../managers/combat/ResourceManager";
import CardpileManager from "../managers/combat/CardpileManager";
import GridManager from "../managers/combat/GridManager";
import SyncManager from "../managers/combat/SyncManager";
import type { Game } from "../scenes/Game";

let installed = false;

function flagValue(value: unknown, depth = 0): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  if (depth >= 2) return String(value);
  if (Array.isArray(value)) return value.map((item) => flagValue(item, depth + 1));
  if (value instanceof Set) {
    return [...value]
      .map((item) => flagValue(item, depth + 1))
      .sort((a, b) => String(a).localeCompare(String(b)));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.targetFrame === "number" && typeof obj.interval === "number") {
      const ticker = TickerManager.Instance;
      return obj.targetFrame - ticker.currentFrame;
    }
    if (typeof obj.remaining === "number") return obj.remaining;
    if (typeof obj.state === "function") return flagValue(obj.state(), depth + 1);
    if (typeof obj.TimerKey === "string") return obj.TimerKey;
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === "scene" || key === "viewGroup" || key === "model" || key === "callback") continue;
      out[key] = flagValue(obj[key], depth + 1);
    }
    return out;
  }
  return String(value);
}

function entityId(entity: unknown, fallback: string): string {
  const key = (entity as { TimerKey?: string }).TimerKey;
  return key || fallback;
}

const ENTITY_FLAGS = [
  "waveID", "level", "col", "row", "isFlying", "isInVoid", "isDying", "isFrozen",
  "isStop", "isSleeping", "isTiny", "attacking", "attackTimer", "debuffs",
  "underAttackBy", "carryStarShards", "carriedStarShards", "starShardsDropped",
  "currentDamage", "currentPenetrate", "penetratePower", "penetratedPunish",
  "traveledDistanceX", "maxDistanceX", "bounceable", "skipTiny", "hasAttacked",
  "hasPenetrated", "currentStage", "armorHealth", "armorBroken", "hasTriggered",
  "lastSkill", "callCount", "random", "isBuried", "hasExploded",
];

function toEntityState(kind: string, entity: unknown, index: number, allTimers: TimerState[]): EntityLogicState {
  const obj = entity as Record<string, unknown>;
  const id = `${entityId(entity, `${kind}-${index}`)}`;
  const timerKey = (entity as { TimerKey?: string }).TimerKey;

  const flags: Record<string, JsonValue> = {};
  for (const key of ENTITY_FLAGS) {
    if (obj[key] === undefined) continue;
    flags[key] = flagValue(obj[key]);
  }

  const rigidBody = obj.rigidBody as { translation?: () => { x: number; y: number } } | null | undefined;
  const translation = rigidBody?.translation?.();
  const hp = obj.currentHealth ?? obj.health;
  const maxHp = obj.maxHealth ?? (obj.model as { maxHealth?: number } | undefined)?.maxHealth;

  return {
    kind,
    id,
    col: typeof obj.col === "number" ? obj.col : null,
    row: typeof obj.row === "number" ? obj.row : null,
    x: translation?.x ?? (typeof obj.x === "number" ? obj.x : 0),
    y: translation?.y ?? (typeof obj.y === "number" ? obj.y : 0),
    hp: typeof hp === "number" ? hp : null,
    maxHp: typeof maxHp === "number" ? maxHp : null,
    speed: typeof obj.speed === "number" ? obj.speed : null,
    flags,
    timers: timerKey ? allTimers.filter((timer) => timer.group === timerKey) : [],
    extra: {
      originalSpeed: typeof obj.originalSpeed === "number" ? obj.originalSpeed : null,
      waveID: typeof obj.waveID === "number" ? obj.waveID : null,
    },
  };
}

function collectEntities(kind: string, entities: unknown[]): EntityLogicState[] {
  const allTimers = TickerManager.Instance.GetTimerStates();
  return entities.map((entity, index) => toEntityState(kind, entity, index, allTimers));
}

function flattenMapValues<T>(map: Map<unknown, T[]> | undefined): T[] {
  if (!map) return [];
  const result: T[] = [];
  map.forEach((items) => {
    for (const item of items) result.push(item);
  });
  return result;
}

/** 将现有实体的数值字段就地恢复到最新快照（实体身份必须已存在）。 */
function restoreEntityValues(entities: EntityLogicState[], targets: unknown[]): void {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  targets.forEach((target, index) => {
    const snapshot = byId.get(entityId(target, `unknown-${index}`));
    if (!snapshot) return;
    const obj = target as Record<string, unknown>;
    if (snapshot.hp !== null && typeof obj.currentHealth === "number") obj.currentHealth = snapshot.hp;
    if (snapshot.hp !== null && typeof obj.health === "number") obj.health = snapshot.hp;
    if (snapshot.speed !== null && typeof obj.speed === "number") obj.speed = snapshot.speed;
    const prngState = snapshot.flags.random;
    const random = obj.random as { state?: (state: JsonValue) => void } | undefined;
    if (prngState && typeof random?.state === "function") random.state(prngState);
  });
}

/**
 * 安装所有状态源。重复调用安全。
 */
export function installRuntimeStateSources(): void {
  if (installed) return;
  installed = true;

  const combat = CombatManager.Instance;
  const ticker = TickerManager.Instance;
  const mobs = MobManager.Instance;
  const resources = ResourceManager.Instance;
  const cardpile = CardpileManager.Instance;
  const grid = GridManager.Instance;

  simulationState.registerSeed(
    () => combat.seed,
    (seed) => { combat.seed = seed; },
  );

  simulationState.registerFrame(
    () => SyncManager.Instance.recvQueue.currentFrameId,
    (frameId) => { SyncManager.Instance.recvQueue.currentFrameId = frameId; },
  );

  simulationState.registerValue("combat.dayOrNight", () => combat.combatStatus.dayOrNight);
  simulationState.registerValue("combat.isGameEnd", () => combat.isGameEnd);
  simulationState.registerValue("combat.isPaused", () => combat.isPaused);
  // elapsedFrameTime 由各端 rAF delta 累加，天然不同，不能进入跨端一致性哈希。
  simulationState.registerValue("ticker.currentFrame", () => ticker.currentFrame, (value) => {
    ticker.currentFrame = Number(value) || 0;
  });
  simulationState.registerValue("resources", () => resources.GetResourceState(), (value) => {
    resources.RestoreResourceState(value as Record<string, number>);
  });
  simulationState.registerValue("cardpile", () => [...cardpile.cardpileStatus.entries()]
    .map(([pid, status]) => ({ pid, level: status.level, leftMs: status.leftMs, totalMs: status.totalMs }))
    .sort((a, b) => a.pid - b.pid));
  simulationState.registerValue("wave", () => mobs.GetWaveState(), (value) => {
    mobs.RestoreWaveState(value as Record<string, number | boolean>);
  });
  simulationState.registerValue("waves", () => mobs.GetWaves() as unknown as JsonValue, (value) => {
    mobs.RestoreWaves(value as unknown as Parameters<typeof mobs.RestoreWaves>[0]);
  });
  simulationState.registerValue("grid", () => grid.GridProperties);

  simulationState.registerTimers("ticker", () => ticker.GetTimerStates(), (timers) => {
    ticker.RestoreTimerStates(timers, ticker.currentFrame);
  });

  simulationState.registerPrng({
    capture: (): PrngState => {
      const snapshot = mobs.CapturePrngState();
      return { name: "mob.alea", seed: snapshot.seed, state: snapshot.state as unknown as JsonValue };
    },
    restore: (snapshot) => {
      mobs.RestorePrngState({ seed: snapshot.seed, state: snapshot.state });
    },
  });

  simulationState.registerEntities(
    "mob",
    () => collectEntities("mob", flattenMapValues(mobs.MobsByLane)),
    (entities) => restoreEntityValues(entities, flattenMapValues(mobs.MobsByLane)),
  );
  simulationState.registerEntities(
    "plant",
    () => collectEntities("plant", flattenMapValues(PlantsManager.Instance.PlantsMap)),
    (entities) => restoreEntityValues(entities, flattenMapValues(PlantsManager.Instance.PlantsMap)),
  );
  simulationState.registerEntities(
    "obstacle",
    () => collectEntities("obstacle", flattenMapValues(ObstacleManager.Instance.ObstaclesMap)),
    (entities) => restoreEntityValues(entities, flattenMapValues(ObstacleManager.Instance.ObstaclesMap)),
  );
}

/**
 * 在 Phaser 场景创建 Rapier 世界后调用，使物理世界快照也参与 hash。
 * 物理快照只用于校验；恢复物理世界需要整体替换引用与实体刚体，
 * 因此这里不注册 restore，避免把实体引用留在已销毁的旧世界上。
 */
export function registerPhysicsSource(scene: Game): void {
  simulationState.registerPhysics({
    capture: () => {
      try {
        return scene.rapierWorld?.takeSnapshot?.() ?? null;
      } catch {
        return null;
      }
    },
  });
}
