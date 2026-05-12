import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import MobManager from "../../managers/combat/MobManager";
import PlantsManager from "../../managers/combat/PlantsManager";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { CollisionContext } from "../../types";
import { BaseEntity } from "../core/BaseEntity";
import { CombatEntity } from "../core/CombatEntity";
import { Faction } from "../Enum";
import { MonsterEntity } from "./MonsterEntity";

export type SightLineDirection = -1 | 1;

export type SightLineOptions = {
  owner: CombatEntity;
  row: number | (() => number);
  direction?: SightLineDirection;
  maxDistance?: number;
  includeFactions?: Faction[];
  excludeFactions?: Faction[];
  includeTiny?: boolean;
  includeFlying?: boolean;
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
};

export class SightLineGroup {
  private readonly lines: SightLineEntity[];

  constructor(scene: Game, options: SightLineGroupOptions) {
    const { row, rows, rowOffsets, direction, directions, ...lineOptions } = options;
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
  private readonly includeTiny: boolean;
  private readonly includeFlying: boolean;
  private readonly ignoreBounce: boolean;
  private readonly candidates: Set<CombatEntity> = new Set();
  private lineLength = 1;

  constructor(scene: Game, options: SightLineOptions) {
    const row = typeof options.row === "function" ? options.row() : options.row;
    const originX = typeof options.originX === "function" ? options.originX() : options.originX ?? options.owner.x;
    const maxDistance = options.maxDistance ?? PositionManager.Instance.GRID_SIZEX * 32;
    const direction = options.direction ?? 1;
    const center = SightLineEntity.calcLineSegment(originX, row, direction, maxDistance, options.ignoreBounce ?? options.owner.faction === Faction.ZOMBIE);

    super(scene, center.x, center.y);

    this.owner = options.owner;
    this.getRow = typeof options.row === "function" ? options.row : () => options.row as number;
    this.getOriginX = typeof options.originX === "function" ? options.originX : () => options.originX ?? this.owner.x;
    this.direction = direction;
    this.maxDistance = maxDistance;
    this.includeFactions = options.includeFactions ? new Set(options.includeFactions) : undefined;
    this.excludeFactions = options.excludeFactions ? new Set(options.excludeFactions) : undefined;
    this.includeTiny = options.includeTiny ?? false;
    this.includeFlying = options.includeFlying ?? false;
    this.ignoreBounce = options.ignoreBounce ?? this.owner.faction === Faction.ZOMBIE;

    this.buildView();
    this.buildPhysics();
  }

  protected buildView(): void {
    const zone = this.scene.add.zone(this.x, this.y, this.lineLength, 1).setOrigin(0.5, 0.5);
    this.viewGroup.add(zone);
  }

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
  }

  public hasTarget(): boolean {
    return this.getTargets().length > 0;
  }

  public getTargets(): CombatEntity[] {
    this.pruneCandidates();
    const found = new Set<CombatEntity>();

    for (const target of this.candidates) {
      if (this.canSee(target)) {
        found.add(target);
      }
    }

    for (const target of this.collectRowEntities()) {
      if (this.canSee(target)) {
        found.add(target);
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
    if (this.rigidBody) {
      this.rigidBody.setNextKinematicTranslation({ x: sensor.x, y: sensor.y });
    }
  }

  public override updateView(vec: { x: number; y: number }): void {
    const dx = vec.x - this.x;
    const dy = vec.y - this.y;
    this.x = vec.x;
    this.y = vec.y;

    for (const child of this.viewGroup.getChildren() as Phaser.GameObjects.Zone[]) {
      child.x += dx;
      child.y += dy;
      child.setSize(this.lineLength, 1);
    }
  }

  public onCollision(ctx: CollisionContext): void {
    if (ctx.targetEntity instanceof CombatEntity) {
      this.candidates.add(ctx.targetEntity);
    }
  }

  private getLineSegment(): { x: number; y: number; length: number } {
    const row = this.getRow();
    const originX = this.getOriginX();
    const sensor = SightLineEntity.calcLineSegment(originX, row, this.direction, this.maxDistance, this.ignoreBounce);
    this.lineLength = sensor.length;
    return sensor;
  }

  private static calcLineSegment(
    originX: number,
    row: number,
    direction: SightLineDirection,
    maxDistance: number,
    ignoreBounce: boolean,
  ): { x: number; y: number; length: number } {
    const bounds = PositionManager.Instance.getWorldBounds();
    const y = PositionManager.Instance.getRowCenterY(row);
    const startX = ignoreBounce
      ? originX
      : direction > 0 ? bounds.left : bounds.right;
    const endX = ignoreBounce
      ? originX + direction * maxDistance
      : originX + direction * maxDistance;
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);

    return {
      x: (minX + maxX) / 2,
      y,
      length: Math.max(1, maxX - minX),
    };
  }

  private collectRowEntities(): CombatEntity[] {
    const row = this.getRow();
    const result: CombatEntity[] = [];

    const mobs = MobManager.Instance.MobsByLane.get(row) ?? [];
    result.push(...mobs);

    for (const plants of PlantsManager.Instance.PlantsMap.values()) {
      for (const plant of plants) {
        if (plant.row === row) {
          result.push(plant);
        }
      }
    }

    return result;
  }

  private canSee(target: CombatEntity): boolean {
    if (target === this.owner) return false;
    if (target.currentHealth <= 0) return false;
    if (!this.matchFaction(target.faction)) return false;
    if (!this.includeTiny && target.isTiny) return false;
    if (!this.includeFlying && target instanceof MonsterEntity && target.isFlying) return false;
    if (target.GetRow() !== this.getRow()) return false;

    return this.isInBaseRay(target.x) || this.isInBounceRay(target);
  }

  private matchFaction(faction: Faction): boolean {
    if (this.includeFactions && !this.includeFactions.has(faction)) return false;
    if (this.excludeFactions?.has(faction)) return false;
    return true;
  }

  private isInBaseRay(x: number): boolean {
    const distance = (x - this.getOriginX()) * this.direction;
    return distance >= 0 && distance <= this.maxDistance;
  }

  private isInBounceRay(target: CombatEntity): boolean {
    if (this.ignoreBounce) return false;

    const originX = this.getOriginX();
    for (const reflector of this.collectReflectors()) {
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

  private collectReflectors(): SightLineReflector[] {
    const row = this.getRow();
    const reflectors: SightLineReflector[] = [];

    for (const plants of PlantsManager.Instance.PlantsMap.values()) {
      for (const plant of plants) {
        if (plant.row !== row) continue;
        const reflector = plant as SightLineReflector;
        if (reflector.canExtendSightLineFor?.(this.owner.faction)) {
          reflectors.push(reflector);
        }
      }
    }

    return reflectors;
  }

  private pruneCandidates(): void {
    for (const target of this.candidates) {
      if (target.currentHealth <= 0) {
        this.candidates.delete(target);
      }
    }
  }
}
