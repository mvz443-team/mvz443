import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import MobManager from "../../managers/combat/MobManager";
import ObstacleManager from "../../managers/combat/ObstacleManager";
import PlantsManager from "../../managers/combat/PlantsManager";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { CollisionContext } from "../../types";
import { BaseEntity } from "../core/BaseEntity";
import { CombatEntity } from "../core/CombatEntity";
import { canReachBody, readBodyLayers, type BodyLayers } from "../../core/logic/BodyTraits";
import { effectiveFaction } from "../../core/logic/FactionRelations";
import { Faction } from "../Enum";

export type SightLineDirection = -1 | 1;

export type SightLineOptions = {
  owner: CombatEntity;
  row: number | (() => number);
  direction?: SightLineDirection;
  maxDistance?: number;
  includeFactions?: Faction[];
  excludeFactions?: Faction[];
  /**
   * 排除 owner 当前的有效阵营。替代 preset 里写死的 `excludeFactions:[entity.faction]`：
   * 后者在 owner 被魅惑改阵营后仍是旧值，会让射线继续把自己人当目标。
   */
  excludeSelf?: boolean;
  /**
   * 这条判定线（= 该植物的攻击）能到达的体态层，
   * 与投射物共用 `BodyTraits.canReachBody()`。省略表示只到普通地面目标。
   */
  reach?: Partial<BodyLayers>;
  ignoreBounce?: boolean;
  originX?: number | (() => number);
};

type SightLineReflector = CombatEntity & {
  canExtendSightLineFor?: (faction: Faction) => boolean;
};

export type SightLineGroupOptions = Omit<SightLineOptions, "row" | "direction"> & {
  row?: number | (() => number);
  rows?: Array<number | (() => number)>;
  rowOffsets?: number[];
  direction?: SightLineDirection;
  directions?: SightLineDirection[];
  skipOutOfBoundsRows?: boolean;
};

export class SightLineGroup {
  private readonly lines: SightLineEntity[];

  constructor(scene: Game, options: SightLineGroupOptions) {
    const { row, rows, rowOffsets, direction, directions, skipOutOfBoundsRows = true, ...lineOptions } = options;
    const baseRow = row ?? (() => options.owner.GetRow());
    const lineRows = rows ?? (rowOffsets ?? [0]).map(offset => {
      if (typeof baseRow === "function") {
        return () => baseRow() + offset;
      }
      return baseRow + offset;
    });
    const lineDirections = directions ?? [direction ?? 1];

    this.lines = [];
    for (const lineRow of lineRows) {
      if (skipOutOfBoundsRows) {
        if (typeof lineRow !== "function" && !SightLineEntity.isValidRow(lineRow)) {
          continue;
        }
      }

      for (const lineDirection of lineDirections) {
        this.lines.push(new SightLineEntity(scene, {
          ...lineOptions,
          row: lineRow,
          direction: lineDirection,
        }));
      }
    }
  }

  public hasTarget(): boolean {
    return this.lines.some(line => line.hasTarget());
  }

  public getTargets(): CombatEntity[] {
    const targets = new Set<CombatEntity>();
    for (const line of this.lines) {
      for (const target of line.getTargets()) {
        targets.add(target);
      }
    }
    return [...targets];
  }

  public destroy(): void {
    for (const line of this.lines) {
      line.destroy();
    }
  }
}

export class SightLineEntity extends BaseEntity {
  public baseDepth = 0;

  private readonly owner: CombatEntity;
  private readonly getRow: () => number;
  private readonly getOriginX: () => number;
  private readonly direction: SightLineDirection;
  private readonly maxDistance: number;
  private readonly includeFactions?: Set<Faction>;
  private readonly excludeFactions?: Set<Faction>;
  private readonly excludeSelf: boolean;
  private readonly reach: BodyLayers;
  /** 显式配置；undefined 时按 owner 当前阵营动态推导，避免重建/魅惑后读到旧值。 */
  private readonly ignoreBounceOverride: boolean | undefined;
  private readonly candidates: Set<CombatEntity> = new Set();
  private lineLength = 1;
  private lastRequestedX = Number.NaN;
  private lastRequestedY = Number.NaN;

  constructor(scene: Game, options: SightLineOptions) {
    const row = typeof options.row === "function" ? options.row() : options.row;
    const originX = typeof options.originX === "function" ? options.originX() : options.originX ?? options.owner.x;
    const maxDistance = options.maxDistance ?? PositionManager.Instance.GRID_SIZEX * 32;
    const direction = options.direction ?? 1;
    const center = SightLineEntity.calcLineSegment(originX, row, direction, maxDistance);

    super(scene, center.x, center.y);

    this.owner = options.owner;
    this.getRow = typeof options.row === "function" ? options.row : () => options.row as number;
    this.getOriginX = typeof options.originX === "function"
      ? options.originX
      : () => (options.originX as number | undefined) ?? this.owner.x;
    this.direction = direction;
    this.maxDistance = maxDistance;
    this.includeFactions = options.includeFactions ? new Set(options.includeFactions) : undefined;
    this.excludeFactions = options.excludeFactions ? new Set(options.excludeFactions) : undefined;
    this.excludeSelf = options.excludeSelf ?? false;
    this.reach = {
      tiny: options.reach?.tiny === true,
      flying: options.reach?.flying === true,
      inVoid: options.reach?.inVoid === true,
    };
    this.ignoreBounceOverride = options.ignoreBounce;

    this.buildView();
    this.buildPhysics();
  }

  protected buildView(): void { }

  private buildPhysics(): void {
    const segment = this.getLineSegment();
    this.lineLength = segment.length;
    this.x = segment.x;
    this.y = segment.y;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.x, this.y);
    rigidBodyDesc.setUserData(this);
    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.segment(
      { x: -this.lineLength / 2, y: 0 },
      { x: this.lineLength / 2, y: 0 },
    );
    colliderDesc.setSensor(true);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    colliderDesc.setActiveCollisionTypes(
      RAPIER.ActiveCollisionTypes.DEFAULT |
      RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC
    );

    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
    this.rigidBody.setNextKinematicTranslation({ x: this.x, y: this.y });
    this.lastRequestedX = this.x;
    this.lastRequestedY = this.y;
  }

  public hasTarget(): boolean {
    const row = this.getRow();
    if (!SightLineEntity.isValidRow(row)) return false;

    const originX = this.getOriginX();
    const reflectors = this.shouldIgnoreBounce()
      ? undefined
      : PlantsManager.Instance.GetSightLineReflectorsByLane(row) as SightLineReflector[];

    const mobs = MobManager.Instance.MobsByLane.get(row);
    if (mobs) {
      for (const mob of mobs) {
        if (this.canSee(mob, row, originX, reflectors)) {
          return true;
        }
      }
    }

    const plants = PlantsManager.Instance.GetPlantsByLane(row);
    if (plants) {
      for (const plant of plants) {
        if (this.canSee(plant, row, originX, reflectors)) {
          return true;
        }
      }
    }

    const obstacles = ObstacleManager.Instance.GetObstaclesByLane(row);
    if (obstacles) {
      for (const obstacle of obstacles) {
        if (this.canSee(obstacle, row, originX, reflectors)) {
          return true;
        }
      }
    }

    return false;
  }

  public getTargets(): CombatEntity[] {
    const found = new Set<CombatEntity>();
    const row = this.getRow();
    if (!SightLineEntity.isValidRow(row)) return [];
    const originX = this.getOriginX();
    const reflectors = this.shouldIgnoreBounce()
      ? undefined
      : PlantsManager.Instance.GetSightLineReflectorsByLane(row) as SightLineReflector[];

    const mobs = MobManager.Instance.MobsByLane.get(row);
    if (mobs) {
      for (const mob of mobs) {
        if (this.canSee(mob, row, originX, reflectors)) {
          found.add(mob);
        }
      }
    }

    const plants = PlantsManager.Instance.GetPlantsByLane(row);
    if (plants) {
      for (const plant of plants) {
        if (this.canSee(plant, row, originX, reflectors)) {
          found.add(plant);
        }
      }
    }

    const obstacles = ObstacleManager.Instance.GetObstaclesByLane(row);
    if (obstacles) {
      for (const obstacle of obstacles) {
        if (this.canSee(obstacle, row, originX, reflectors)) {
          found.add(obstacle);
        }
      }
    }

    return [...found];
  }

  public override stepUpdate(): void {
    if (this.owner.currentHealth <= 0) {
      this.destroy();
      return;
    }

    const sensor = this.getLineSegment();
    if (this.rigidBody && (sensor.x !== this.lastRequestedX || sensor.y !== this.lastRequestedY)) {
      this.rigidBody.setNextKinematicTranslation({ x: sensor.x, y: sensor.y });
      this.lastRequestedX = sensor.x;
      this.lastRequestedY = sensor.y;
    }
  }

  public onCollision(ctx: CollisionContext): void {
    if (ctx.targetEntity instanceof CombatEntity) {
      this.candidates.add(ctx.targetEntity);
    }
  }

  public getCollisionCandidates(): CombatEntity[] {
    this.pruneCandidates();
    return [...this.candidates];
  }

  private getLineSegment(): { x: number; y: number; length: number } {
    const row = this.getRow();
    const originX = this.getOriginX();
    const sensor = SightLineEntity.calcLineSegment(originX, row, this.direction, this.maxDistance);
    this.lineLength = sensor.length;
    return sensor;
  }

  private static calcLineSegment(
    originX: number,
    row: number,
    direction: SightLineDirection,
    maxDistance: number,
  ): { x: number; y: number; length: number } {
    const y = PositionManager.Instance.getRowCenterY(row);
    const startX = originX;
    const endX = originX + direction * maxDistance;
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);

    return {
      x: (minX + maxX) / 2,
      y,
      length: Math.max(1, maxX - minX),
    };
  }

  private canSee(
    target: CombatEntity,
    row: number,
    originX: number,
    reflectors?: SightLineReflector[],
  ): boolean {
    if (target === this.owner) return false;
    if (target.currentHealth <= 0) return false;
    if (!this.matchFaction(effectiveFaction(target), effectiveFaction(this.owner))) return false;
    if (!canReachBody(this.reach, readBodyLayers(target))) return false;
    if (target.GetRow() !== row) return false;

    return this.isInBaseRay(target.x, originX) || this.isInBounceRay(target, originX, reflectors);
  }

  /**
   * 每次查询都读取 owner 当前有效阵营，而不是构造时缓存。
   * checkpoint 重建实体时 `onCreate` 先于 `restoreSnapshot` 执行，
   * 缓存值会停留在模板阵营；这里动态推导可保证回滚后判定一致。
   */
  private shouldIgnoreBounce(): boolean {
    return this.ignoreBounceOverride ?? effectiveFaction(this.owner) === Faction.ZOMBIE;
  }

  private matchFaction(faction: Faction | null, ownerFaction: Faction | null): boolean {
    if (faction === null) return false;
    if (this.includeFactions && !this.includeFactions.has(faction)) return false;
    if (this.excludeFactions?.has(faction)) return false;
    if (this.excludeSelf && ownerFaction !== null && faction === ownerFaction) return false;
    return true;
  }

  private isInBaseRay(x: number, originX: number): boolean {
    const distance = (x - originX) * this.direction;
    return distance >= 0 && distance <= this.maxDistance;
  }

  private isInBounceRay(target: CombatEntity, originX: number, reflectors?: SightLineReflector[]): boolean {
    if (!reflectors || reflectors.length === 0) return false;
    const ownerFaction = effectiveFaction(this.owner);
    if (ownerFaction === null) return false;

    for (const reflector of reflectors) {
      if (!reflector.canExtendSightLineFor?.(ownerFaction)) continue;

      const toReflector = (reflector.x - originX) * this.direction;
      if (toReflector < 0 || toReflector > this.maxDistance) continue;

      const fromReflectorToTarget = (reflector.x - target.x) * this.direction;
      if (fromReflectorToTarget < 0) continue;
      if (toReflector + fromReflectorToTarget <= this.maxDistance) {
        return true;
      }
    }

    return false;
  }

  private pruneCandidates(): void {
    for (const target of this.candidates) {
      if (target.currentHealth <= 0) {
        this.candidates.delete(target);
      }
    }
  }

  public static isValidRow(row: number): boolean {
    return row >= 0 && row < PositionManager.Instance.getRowCount();
  }
}
