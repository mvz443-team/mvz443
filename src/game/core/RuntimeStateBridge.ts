/**
 * 把运行时各单例管理器接入 SimulationState 注册中心。
 *
 * 这里只做「状态读取 / 就地恢复」，不参与任何 Phaser 渲染逻辑；
 * SimulationState 本身不依赖本文件，可在无 Phaser 的 Node 环境下单独测试。
 */

import type {
  EntityLogicState,
  JsonValue,
} from "./SimulationState";
import type { RestoreContext } from "./SimulationState";
import { simulationState } from "./SimulationState";
import CombatManager from "../managers/CombatManager";
import TickerManager from "../managers/combat/TickerManager";
import MobManager from "../managers/combat/MobManager";
import PlantsManager from "../managers/combat/PlantsManager";
import ObstacleManager from "../managers/combat/ObstacleManager";
import ResourceManager from "../managers/combat/ResourceManager";
import CardpileManager from "../managers/combat/CardpileManager";
import GridManager from "../managers/combat/GridManager";
import TileItemManager from "../managers/combat/TileItemManager";
import SyncManager from "../managers/combat/SyncManager";
import type { Game } from "../scenes/Game";
import { ProjectileCmd } from "../utils/cmd/ProjectileCmd";
import { rebindPhysicsEntities } from "./PhysicsSnapshot";
import { registerEntityLookupProvider } from "./EntityLookup";
import { logicEvents } from "./logic/LogicEvents";
import { ObstacleLibrary } from "../managers/library/ObstacleLibrary";
import { Faction } from "../models/Enum";
import { setAuthoritativeFrame } from "./logic/EntityTickManager";

let installed = false;

interface SnapshotableEntity {
  readonly SnapshotId: string;
  captureSnapshot(): EntityLogicState;
  restoreSnapshot(state: EntityLogicState, context: RestoreContext): void;
}

function collectEntities(kind: string, entities: unknown[]): EntityLogicState[] {
  return entities
    .map((entity) => entity as Partial<SnapshotableEntity>)
    .filter((entity): entity is SnapshotableEntity => typeof entity?.captureSnapshot === "function")
    .map((entity) => {
      const state = entity.captureSnapshot();
      return { ...state, kind };
    });
}

function flattenMapValues<T>(map: Map<unknown, T[]> | undefined): T[] {
  if (!map) return [];
  const result: T[] = [];
  map.forEach((items) => {
    for (const item of items) result.push(item);
  });
  return result;
}

/** 将快照写回仍然存活的同 id 实体。 */
function restoreEntityValues(
  snapshots: EntityLogicState[],
  targets: unknown[],
  context: RestoreContext,
): void {
  const byId = new Map(snapshots.map((entity) => [String(entity.id), entity]));
  for (const target of targets) {
    const entity = target as Partial<SnapshotableEntity>;
    if (typeof entity?.restoreSnapshot !== "function" || entity.SnapshotId === undefined) continue;
    const snapshot = byId.get(String(entity.SnapshotId));
    if (!snapshot) continue;
    entity.restoreSnapshot(snapshot, context);
  }
}

interface LiveSnapshotEntity {
  readonly SnapshotId: string;
  readonly IsAlive: boolean;
  destroy(): void;
  destroySilently?(): void;
}

function destroyEntitySilently(entity: LiveSnapshotEntity): void {
  if (typeof entity.destroySilently === "function") {
    entity.destroySilently();
  } else {
    entity.destroy();
  }
}

/** 植物对账：删除快照后新增的、重建快照中缺失的，再回写状态。 */
function reconcilePlants(snapshots: EntityLogicState[], context: RestoreContext): void {
  const manager = PlantsManager.Instance;
  const snapshotIds = new Set(snapshots.map((snapshot) => String(snapshot.id)));
  const liveById = new Map<string, LiveSnapshotEntity>();

  for (const plant of flattenMapValues(manager.PlantsMap) as unknown as LiveSnapshotEntity[]) {
    const id = String(plant.SnapshotId);
    if (!snapshotIds.has(id) || !plant.IsAlive) {
      manager.UnregisterPlant(plant as never);
      destroyEntitySilently(plant);
      continue;
    }
    liveById.set(id, plant);
  }

  for (const snapshot of snapshots) {
    if (liveById.has(String(snapshot.id))) continue;
    const pid = Number(snapshot.flags.pid);
    if (!pid || snapshot.col === null || snapshot.row === null) {
      context.report.missing.push(`plant:${snapshot.id}`);
      continue;
    }
    const rebuilt = manager.RebuildPlant(pid, snapshot.col, snapshot.row, Number(snapshot.flags.level) || 1);
    if (!rebuilt) {
      context.report.missing.push(`plant:${snapshot.id}`);
      continue;
    }
    rebuilt.adoptStableSnapshotKey(String(snapshot.id));
    liveById.set(String(snapshot.id), rebuilt as unknown as LiveSnapshotEntity);
  }

  restoreEntityValues(snapshots, flattenMapValues(manager.PlantsMap), context);
}

/** 怪物对账：删除快照后新增的、重建快照中缺失的，再回写状态。 */
function reconcileMobs(snapshots: EntityLogicState[], context: RestoreContext): void {
  const manager = MobManager.Instance;
  const snapshotIds = new Set(snapshots.map((snapshot) => String(snapshot.id)));
  const liveById = new Map<string, LiveSnapshotEntity>();

  for (const mob of flattenMapValues(manager.MobsByLane) as unknown as LiveSnapshotEntity[]) {
    const id = String(mob.SnapshotId);
    if (!snapshotIds.has(id) || !mob.IsAlive) {
      manager.RemoveMonsterSilently(mob as never);
      destroyEntitySilently(mob);
      continue;
    }
    liveById.set(id, mob);
  }

  for (const snapshot of snapshots) {
    if (liveById.has(String(snapshot.id))) continue;
    const mid = Number(snapshot.flags.mid);
    const waveId = Number(snapshot.flags.waveID) || 0;
    const spawnSeq = Number(snapshot.flags.spawnSeq) || 0;
    if (!mid || !spawnSeq) {
      context.report.missing.push(`mob:${snapshot.id}`);
      continue;
    }
    const rebuilt = manager.RebuildMonster(mid, snapshot.col ?? 0, snapshot.row ?? 0, waveId, spawnSeq);
    if (!rebuilt) {
      context.report.missing.push(`mob:${snapshot.id}`);
      continue;
    }
    rebuilt.adoptStableSnapshotKey(String(snapshot.id));
    liveById.set(String(snapshot.id), rebuilt as unknown as LiveSnapshotEntity);
  }

  restoreEntityValues(snapshots, flattenMapValues(manager.MobsByLane), context);
}

/** 障碍物对账：与植物/怪物一样支持删除快照后新增实体与重建缺失实体。 */
function reconcileObstacles(snapshots: EntityLogicState[], context: RestoreContext): void {
  const manager = ObstacleManager.Instance;
  const snapshotIds = new Set(snapshots.map((snapshot) => String(snapshot.id)));
  const liveById = new Map<string, LiveSnapshotEntity>();

  for (const obstacle of flattenMapValues(manager.ObstaclesMap) as unknown as LiveSnapshotEntity[]) {
    const id = String(obstacle.SnapshotId);
    if (!snapshotIds.has(id) || !obstacle.IsAlive) {
      manager.UnregisterObstacle(obstacle as never);
      destroyEntitySilently(obstacle);
      continue;
    }
    liveById.set(id, obstacle);
  }

  for (const snapshot of snapshots) {
    if (liveById.has(String(snapshot.id))) continue;
    const oid = Number(snapshot.flags.oid);
    if (!oid || snapshot.col === null || snapshot.row === null) {
      context.report.missing.push(`obstacle:${snapshot.id}`);
      continue;
    }
    const model = ObstacleLibrary.GetModel(oid);
    const scene = manager.getScene();
    if (!model || !scene) {
      context.report.missing.push(`obstacle:${snapshot.id}`);
      continue;
    }
    const factionRaw = Number(snapshot.flags.faction);
    const faction = factionRaw === Faction.PLANT || factionRaw === Faction.NEUTRAL
      ? factionRaw
      : Faction.ZOMBIE;
    const rebuilt = model.createEntity(scene, snapshot.col, snapshot.row, {
      hp: Number(snapshot.hp) || 1,
      faction,
      waveId: Number(snapshot.flags.waveId) || -1,
    });
    rebuilt.adoptStableSnapshotKey(String(snapshot.id));
    liveById.set(String(snapshot.id), rebuilt as unknown as LiveSnapshotEntity);
  }

  restoreEntityValues(snapshots, flattenMapValues(manager.ObstaclesMap), context);
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
  const tileitems = TileItemManager.Instance;

  simulationState.registerSeed(
    () => combat.seed,
    (seed) => { combat.seed = seed; },
  );

  simulationState.registerFrame(
    () => SyncManager.Instance.recvQueue.currentFrameId,
    (frameId) => {
      SyncManager.Instance.recvQueue.currentFrameId = frameId;
      SyncManager.Instance.recvQueue.lastAckFrameId = frameId;
      // 快照回滚后，后续实体创建/计时器必须以快照帧为基准。
      setAuthoritativeFrame(frameId);
    },
  );

  simulationState.registerValue(
    "combat.dayOrNight",
    () => combat.combatStatus.dayOrNight,
    (value) => { combat.combatStatus.dayOrNight = Boolean(value); },
  );
  simulationState.registerValue("combat.isGameEnd", () => combat.isGameEnd, (value) => {
    combat.isGameEnd = Boolean(value);
  });
  simulationState.registerValue("combat.isPaused", () => combat.isPaused, (value) => {
    combat.isPaused = Boolean(value);
  });
  // elapsedFrameTime 由各端 rAF delta 累加，天然不同，不能进入跨端一致性哈希。
  simulationState.registerValue(
    "ticker.currentFrame",
    () => ticker.currentFrame,
    (value) => { ticker.currentFrame = Number(value) || 0; },
  );
  simulationState.registerValue(
    "ticker.nextTimerId",
    () => ticker.getNextTimerId(),
    (value) => { ticker.setNextTimerId(Number(value) || 1); },
  );
  simulationState.registerValue(
    "ticker.frameInterval",
    () => ticker.frameInterval,
    () => { /* 逻辑帧间隔固定为 50ms，不接受旧快照覆盖。 */ },
  );
  simulationState.registerValue("resources", () => resources.CaptureCanonicalResourceState(), (value) => {
    resources.RestoreResourceState(value as Record<string, number>);
  });
  // 卡槽冷却只属于本机玩家：两端卡组不同，放入跨端哈希会在首个 20 帧采样点
  // 必然分叉。它仍需要进入快照，供本地回滚/重连恢复。
  simulationState.registerLocalValue(
    "cardpile",
    () => cardpile.CaptureCanonicalCardpileState() as unknown as JsonValue,
    (value) => { cardpile.RestoreCardpileState(value as Record<string, unknown>); },
  );
  simulationState.registerValue("wave", () => mobs.GetWaveState(), (value) => {
    mobs.RestoreWaveState(value as Record<string, number | boolean>);
  });
  simulationState.registerValue("waves", () => mobs.GetWaves() as unknown as JsonValue, (value) => {
    mobs.RestoreWaves(value as unknown as Parameters<typeof mobs.RestoreWaves>[0]);
  });
  simulationState.registerValue(
    "mob.spawn",
    () => mobs.CaptureSpawnState() as unknown as JsonValue,
    (value) => { mobs.RestoreSpawnState(value as Record<string, unknown> | null); },
  );
  simulationState.registerValue(
    "tileitem",
    () => tileitems.CaptureTileItemState() as unknown as JsonValue,
    (value) => { tileitems.RestoreTileItemState(value as Record<string, unknown>); },
  );
  // 关卡脚本会改写格子属性（water/void）。checkpoint 恢复后必须恢复，
  // 否则重连端会把水面当普通地面，种植校验与出怪行选择立即分叉。
  simulationState.registerValue(
    "grid",
    () => grid.GridProperties,
    (value) => {
      grid.setGridProperty(
        value as unknown as Parameters<typeof grid.setGridProperty>[0],
      );
    },
  );
  simulationState.registerValue(
    "logic.events",
    () => logicEvents.snapshot() as unknown as JsonValue,
    (value) => { logicEvents.restore(value as unknown as ReturnType<typeof logicEvents.snapshot>); },
  );

  simulationState.registerTimers("ticker", () => ticker.GetTimerStates(), (timers, context) => {
    ticker.RestoreTimerStates(timers, context);
  });

  simulationState.registerPrng({
    capture: () => {
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
    (entities, context) => reconcileMobs(entities, context),
  );
  simulationState.registerEntities(
    "plant",
    () => collectEntities("plant", flattenMapValues(PlantsManager.Instance.PlantsMap)),
    (entities, context) => reconcilePlants(entities, context),
  );
  simulationState.registerEntities(
    "obstacle",
    () => collectEntities("obstacle", flattenMapValues(ObstacleManager.Instance.ObstaclesMap)),
    (entities, context) => reconcileObstacles(entities, context),
  );
  simulationState.registerEntities(
    "projectile",
    () => ProjectileCmd.captureProjectileSnapshots(),
    (entities, context) => ProjectileCmd.restoreProjectileSnapshots(entities, context),
  );

  registerEntityLookupProvider(() => flattenMapValues(mobs.MobsByLane));
  registerEntityLookupProvider(() => flattenMapValues(PlantsManager.Instance.PlantsMap));
  registerEntityLookupProvider(() => flattenMapValues(ObstacleManager.Instance.ObstaclesMap));
  registerEntityLookupProvider(() => ProjectileCmd.getActiveProjectiles());
}

/**
 * 在 Phaser 场景创建 Rapier 世界后调用。
 * 恢复时会重建整个世界并重绑实体刚体。
 */
export function registerPhysicsSource(scene: Game): void {
  simulationState.registerPhysics({
    capture: () => {
      try {
        // 高频状态采样不应序列化 Rapier world；checkpoint 只保存 Model 逻辑状态，
        // 物理世界由实体位置/速度/刚体绑定在恢复时重建。
        return null;
      } catch {
        return null;
      }
    },
    restore: (bytes) => {
      scene.restorePhysicsWorld(bytes);
      rebindPhysicsEntities(scene.rapierWorld);
    },
  });
}
