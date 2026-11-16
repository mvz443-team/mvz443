/**
 * 无渲染的确定性战局模型（仅用于验证快照/恢复/追帧/断线恢复）。
 *
 * 它不是游戏渲染层的替代品，而是把“会影响模拟结果的状态类型”完整建模：
 * seed、PRNG、资源、卡槽冷却、植物、僵尸、投射物、buff/debuff 计时器、波次计数。
 *
 * 模型与真实游戏共享同一套 SimulationState 注册中心与哈希实现，
 * 因此可以直接验证：
 * - 连续运行 与 多次 capture/restore 的哈希是否一致；
 * - 弱网追帧（不同快照年龄回滚重放）是否一致；
 * - 断线冻结后恢复是否一致。
 */

import type { EntityLogicState, JsonValue, RestoreContext, SimulationState, TimerState } from "./SimulationState.ts";
import { StateRegistry, SIMULATION_STATE_VERSION } from "./SimulationState.ts";

export type ModelKind = "plant" | "mob" | "projectile";

export interface ModelEntity {
  id: string;
  kind: ModelKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  pid?: number;
  mid?: number;
  level?: number;
  shield?: number;
  damagedSum?: number;
  inBruteShoot?: boolean;
  isLightning?: number;
  cooldown?: number;
  speed?: number;
  armor?: number;
  stage?: number;
  shell?: number;
  fuse?: number;
  freeze?: number;
  slow?: number;
  damage?: number;
  penetrate?: number;
  traveled?: number;
  maxDistance?: number;
}

export interface ModelTimer {
  id: number;
  key: string;
  targetFrame: number;
  repeat: number;
  interval: number;
  group: string;
}

const PLANT_ROSTER: Array<{ pid: number; name: string }> = [
  { pid: 1, name: "dispenser" },
  { pid: 2, name: "furnace" },
  { pid: 3, name: "obsidian" },
  { pid: 4, name: "tnt" },
  { pid: 5, name: "elastic_putin" },
];

const MOB_ROSTER: Array<{ mid: number; name: string }> = [
  { mid: 1, name: "zombie" },
  { mid: 2, name: "helmet_zombie" },
  { mid: 3, name: "staged_body" },
  { mid: 4, name: "turtle_skeleton_bow" },
  { mid: 5, name: "mutant" },
];

export const DETERMINISM_ROSTER = { plants: PLANT_ROSTER, mobs: MOB_ROSTER };

/** 线性同余 PRNG，状态可完整快照。 */
class Lcg {
  public state: number;
  constructor(state: number) {
    this.state = state;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}

export class DeterminismModel {
  public readonly registry = new StateRegistry();
  public frame = 0;
  public tickerFrame = 0;
  public nextTimerId = 1;
  public energy = 50;
  public starShards = 3;
  public kills = 0;
  public spawned = 0;
  public prng: Lcg;
  public entities = new Map<string, ModelEntity>();
  public timers = new Map<number, ModelTimer>();
  public seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.prng = new Lcg(seed >>> 0 || 1);
  }

  public install(): void {
    this.registry.reset();
    this.registry.registerSeed(() => this.seed, (seed) => { this.seed = seed; });
    this.registry.registerFrame(() => this.frame, (frame) => { this.frame = frame; });
    this.registry.registerValue("frame", () => this.frame, (value) => { this.frame = Number(value) || 0; });
    this.registry.registerValue("tickerFrame", () => this.tickerFrame, (value) => { this.tickerFrame = Number(value) || 0; });
    this.registry.registerValue("nextTimerId", () => this.nextTimerId, (value) => { this.nextTimerId = Number(value) || 1; });
    this.registry.registerValue("energy", () => this.energy, (value) => { this.energy = Number(value) || 0; });
    this.registry.registerValue("starShards", () => this.starShards, (value) => { this.starShards = Number(value) || 0; });
    this.registry.registerValue("kills", () => this.kills, (value) => { this.kills = Number(value) || 0; });
    this.registry.registerValue("spawned", () => this.spawned, (value) => { this.spawned = Number(value) || 0; });
    this.registry.registerValue("prng", () => this.prng.state, (value) => { this.prng.state = Number(value) >>> 0; });
    this.registry.registerTimers(
      "timers",
      () => [...this.timers.values()]
        .map((timer) => ({
          id: timer.id,
          targetFrame: timer.targetFrame,
          repeat: timer.repeat,
          interval: timer.interval,
          group: timer.group,
        }))
        .sort((a, b) => a.id - b.id),
      (timers, context) => this.restoreTimers(timers, context),
    );
    this.registry.registerEntities(
      "entity",
      () => [...this.entities.values()].map((entity) => this.captureEntity(entity)),
      (entities, context) => this.restoreEntities(entities, context),
    );
  }

  // ---------------------------------------------------------------------------
  // 定时器
  // ---------------------------------------------------------------------------

  public setTimer(key: string, group: string, delayFrames: number, repeat = 0): void {
    const existing = this.findTimer(key);
    if (existing) this.timers.delete(existing.id);
    const interval = Math.max(1, Math.ceil(delayFrames));
    this.timers.set(this.nextTimerId, {
      id: this.nextTimerId,
      key,
      targetFrame: this.tickerFrame + interval,
      repeat,
      interval,
      group,
    });
    this.nextTimerId += 1;
  }

  public hasTimer(key: string): boolean {
    return this.findTimer(key) !== undefined;
  }

  private findTimer(key: string): ModelTimer | undefined {
    for (const timer of this.timers.values()) {
      if (timer.key === key) return timer;
    }
    return undefined;
  }

  private restoreTimers(timers: TimerState[], context: RestoreContext): void {
    this.tickerFrame = context.frameId;
    const next = new Map<number, ModelTimer>();
    const snapshotKeys = new Set<string>();
    for (const timer of timers) {
      const key = this.timerKeyFromGroup(timer.group);
      snapshotKeys.add(key);
      next.set(timer.id, {
        id: timer.id,
        key,
        targetFrame: timer.targetFrame,
        repeat: timer.repeat,
        interval: timer.interval,
        group: timer.group,
      });
    }
    // 快照之后新增的计时器必须删除
    this.timers = next;
    this.nextTimerId = Math.max(this.nextTimerId, ...[...next.keys()].map((id) => id + 1), 1);
    void snapshotKeys;
  }

  private timerKeyFromGroup(group: string): string {
    return group;
  }

  // ---------------------------------------------------------------------------
  // 实体
  // ---------------------------------------------------------------------------

  private captureEntity(entity: ModelEntity): EntityLogicState {
    const flags: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(entity)) {
      if (key === "id" || key === "kind" || key === "x" || key === "y"
        || key === "hp" || key === "maxHp" || value === undefined) continue;
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      flags[key] = value as JsonValue;
    }
    return {
      kind: "entity",
      id: entity.id,
      col: null,
      row: null,
      x: entity.x,
      y: entity.y,
      hp: entity.hp,
      maxHp: entity.maxHp,
      speed: entity.speed ?? null,
      flags,
      timers: [],
      extra: { modelKind: entity.kind },
    };
  }

  private restoreEntities(snapshots: EntityLogicState[], context: RestoreContext): void {
    const snapshotIds = new Set(snapshots.map((snapshot) => String(snapshot.id)));
    for (const [id, entity] of [...this.entities]) {
      if (!snapshotIds.has(id)) this.entities.delete(id);
    }
    for (const snapshot of snapshots) {
      let entity = this.entities.get(String(snapshot.id));
      if (!entity) {
        entity = this.recreateEntity(snapshot);
        if (!entity) {
          context.report.missing.push(`model-entity:${snapshot.id}`);
          continue;
        }
        this.entities.set(entity.id, entity);
      }
      entity.x = snapshot.x;
      entity.y = snapshot.y;
      entity.hp = snapshot.hp ?? entity.hp;
      entity.maxHp = snapshot.maxHp ?? entity.maxHp;
      entity.speed = snapshot.speed ?? entity.speed;
      // 清除快照中不存在的可选字段（与真实 EntitySnapshot 行为一致）
      for (const key of Object.keys(entity)) {
        if (["id", "kind", "x", "y", "hp", "maxHp", "speed"].includes(key)) continue;
        if (!(key in snapshot.flags)) {
          delete (entity as unknown as Record<string, unknown>)[key];
        }
      }
      for (const [key, value] of Object.entries(snapshot.flags)) {
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
          (entity as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  private recreateEntity(snapshot: EntityLogicState): ModelEntity | undefined {
    const kind = snapshot.extra.modelKind;
    if (kind !== "plant" && kind !== "mob" && kind !== "projectile") return undefined;
    const entity: ModelEntity = {
      id: String(snapshot.id),
      kind,
      x: snapshot.x,
      y: snapshot.y,
      hp: snapshot.hp ?? 0,
      maxHp: snapshot.maxHp ?? 0,
      speed: snapshot.speed ?? undefined,
    };
    for (const [key, value] of Object.entries(snapshot.flags)) {
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
        (entity as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return entity;
  }

  // ---------------------------------------------------------------------------
  // 场景 / 逻辑
  // ---------------------------------------------------------------------------

  public addPlant(pid: number, col: number, row: number, level = 1): ModelEntity {
    const id = `plant:${col}:${row}:${pid}`;
    const entity: ModelEntity = {
      id, kind: "plant", pid, level, x: col * 100, y: row * 50,
      hp: 100, maxHp: 100, cooldown: 0,
    };
    if (pid === 3) { entity.shield = 200; entity.maxHp = 100; }
    if (pid === 4) { entity.fuse = 200; }
    if (pid === 5) { entity.isLightning = 0; }
    this.entities.set(id, entity);
    if (pid === 1 || pid === 3) this.setTimer(`attack:${id}`, `attack:${id}`, 20, -1);
    if (pid === 2) this.setTimer(`energy:${id}`, `energy:${id}`, 30, -1);
    if (pid === 4) this.setTimer(`fuse:${id}`, `fuse:${id}`, 200, 0);
    return entity;
  }

  public addMob(mid: number, row: number): ModelEntity {
    this.spawned += 1;
    const id = `mob:${this.spawned}`;
    const entity: ModelEntity = {
      id, kind: "mob", mid, x: 900, y: row * 50,
      hp: 100, maxHp: 100, speed: 2, armor: 0, stage: 0, shell: mid === 4 ? 50 : 0,
    };
    if (mid === 2) entity.armor = 100;
    if (mid === 3) entity.stage = 2;
    this.entities.set(id, entity);
    this.setTimer(`move:${id}`, `move:${id}`, 1, -1);
    return entity;
  }

  public addProjectile(x: number, row: number, damage: number, penetrate = 1): ModelEntity {
    const id = `projectile:${this.nextTimerId}`;
    const entity: ModelEntity = {
      id, kind: "projectile", x, y: row * 50,
      hp: 1, maxHp: 1, damage, penetrate, traveled: 0, maxDistance: 800,
    };
    this.entities.set(id, entity);
    return entity;
  }

  public applyStarshards(pid: number, targetId?: string): void {
    if (this.starShards <= 0) return;
    this.starShards -= 1;
    const target = targetId ? this.entities.get(targetId) : undefined;

    switch (pid) {
      case 3: // obsidian：回满护盾
        if (target) target.shield = 200;
        break;
      case 4: // tnt：立即引爆
        if (target) target.fuse = 0;
        break;
      case 5: // elastic：闪电窗口
        if (target) target.isLightning = 5000;
        break;
      case 1: // dispenser：爆发射击
        if (target) target.inBruteShoot = true;
        break;
      case 2: // furnace：能量
        this.energy += 450;
        break;
      default:
        break;
    }
  }

  /** 冻结 / 减速 / 即时伤害等效果，走计时器而非瞬时字段。 */
  public castFreeze(targetId: string, durationFrames: number): void {
    const target = this.entities.get(targetId);
    if (!target) return;
    target.freeze = durationFrames;
    this.setTimer(`freeze:${targetId}`, `freeze:${targetId}`, durationFrames, 0);
  }

  public castDamage(targetId: string, amount: number): void {
    const target = this.entities.get(targetId);
    if (!target) return;
    this.applyDamage(target, amount);
  }

  private applyDamage(target: ModelEntity, amount: number): void {
    let remaining = amount;
    if (target.shield && target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    if (target.armor && target.armor > 0) {
      const absorbed = Math.min(target.armor, remaining);
      target.armor -= absorbed;
      remaining -= absorbed;
    }
    if (target.shell && target.shell > 0) {
      const absorbed = Math.min(target.shell, remaining);
      target.shell -= absorbed;
      remaining -= absorbed;
    }
    target.hp -= remaining;
    if (target.hp <= 0) {
      this.entities.delete(target.id);
      if (target.kind === "mob") this.kills += 1;
    }
  }

  /** 推进一个逻辑帧。所有输入都由帧号决定，保证可重放。 */
  public step(): void {
    this.frame += 1;
    this.tickerFrame += 1;

    // 1. 到点计时器（按 id 稳定顺序）
    const due = [...this.timers.values()]
      .filter((timer) => timer.targetFrame <= this.tickerFrame)
      .sort((a, b) => a.id - b.id);
    for (const timer of due) {
      this.onTimer(timer);
      if (timer.repeat < 0 || timer.repeat > 0) {
        if (timer.repeat > 0) timer.repeat -= 1;
        timer.targetFrame = this.tickerFrame + timer.interval;
      } else {
        this.timers.delete(timer.id);
      }
    }

    // 2. 脚本化出怪 / 星碎 / 冻结，按帧号固定触发
    if (this.frame === 5) this.addPlant(1, 2, 1);
    if (this.frame === 10) this.addMob(1, 1);
    if (this.frame === 20) this.addPlant(2, 3, 2);
    if (this.frame === 30) this.addMob(2, 2);
    if (this.frame === 40) this.addPlant(3, 4, 1);
    if (this.frame === 50) this.addMob(3, 1);
    if (this.frame === 60) this.addPlant(4, 5, 2);
    if (this.frame === 70) this.addMob(4, 2);
    if (this.frame === 80) this.addPlant(5, 6, 1);
    if (this.frame === 90) this.addMob(5, 1);
    if (this.frame === 95) this.castFreeze("mob:2", 25);
    if (this.frame === 100) this.applyStarshards(5, "plant:6:1:5");
    if (this.frame === 110) this.applyStarshards(3, "plant:4:1:3");
    if (this.frame === 120) this.applyStarshards(1, "plant:2:1:1");
    if (this.frame === 130) this.castDamage("mob:1", 60);

    // 3. 僵尸移动 / 攻击
    for (const entity of [...this.entities.values()]) {
      if (entity.kind !== "mob") continue;
      if ((entity.freeze ?? 0) > 0) continue;
      entity.x -= entity.speed ?? 0;
      if (entity.x < 100) this.applyDamage(entity, 999);
    }

    // 4. 投射物前进 / 命中
    for (const entity of [...this.entities.values()]) {
      if (entity.kind !== "projectile") continue;
      entity.x -= 12;
      entity.traveled = (entity.traveled ?? 0) + 12;
      for (const target of [...this.entities.values()]) {
        if (target.kind !== "mob") continue;
        if (Math.abs(target.x - entity.x) < 20) {
          this.applyDamage(target, entity.damage ?? 0);
          entity.penetrate = (entity.penetrate ?? 1) - 1;
          if ((entity.penetrate ?? 0) <= 0) {
            this.entities.delete(entity.id);
          }
          break;
        }
      }
      if ((entity.traveled ?? 0) > (entity.maxDistance ?? 0)) this.entities.delete(entity.id);
    }
  }

  private onTimer(timer: ModelTimer): void {
    if (timer.key.startsWith("attack:")) {
      const id = timer.key.slice("attack:".length);
      const plant = this.entities.get(id);
      if (!plant) return;
      const row = Math.round(plant.y / 50);
      this.addProjectile(plant.x + 40, row, plant.inBruteShoot ? 25 : 10, 1);
      return;
    }
    if (timer.key.startsWith("energy:")) {
      this.energy += 25;
      return;
    }
    if (timer.key.startsWith("fuse:")) {
      const id = timer.key.slice("fuse:".length);
      const plant = this.entities.get(id);
      if (!plant) return;
      this.applyDamage(plant, 999);
      return;
    }
    if (timer.key.startsWith("freeze:")) {
      const id = timer.key.slice("freeze:".length);
      const target = this.entities.get(id);
      if (target) target.freeze = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // 快照
  // ---------------------------------------------------------------------------

  public capture(): SimulationState {
    return this.registry.capture();
  }

  public hash(): { h32: string; h64: string } {
    return this.registry.hash();
  }

  public snapshotJson(): string {
    return JSON.stringify(this.capture());
  }

  public restoreJson(json: string): void {
    this.registry.restore(JSON.parse(json) as SimulationState, {
      mode: "in-place",
      resolveEntity: (id) => this.entities.get(id),
    });
  }

  public restore(state: SimulationState): void {
    this.registry.restore(state, { mode: "in-place", resolveEntity: (id) => this.entities.get(id) });
  }

  public cloneSnapshot(): SimulationState {
    return JSON.parse(JSON.stringify(this.capture())) as SimulationState;
  }
}

export { SIMULATION_STATE_VERSION };
