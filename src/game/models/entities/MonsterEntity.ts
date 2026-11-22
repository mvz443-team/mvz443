import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import DepthHelper from "../../utils/helper/DepthHelper";
import type { ITickTimerHandle } from "../../core/logic/EntityTickManager";
import type { Game } from "../../scenes/Game";
import { CollisionContext } from "../../types";
import { IMonsterAnimController } from "../monster/anims/IMonsterAnimController";
import { MonsterModel } from "../MonsterModel";
import { PositionManager } from "../../managers/view/PositionManager";
import { CombatEntity } from "../core/CombatEntity";
import { Faction } from "../Enum";
import { normalizeHabitats, type TerrainHabitat } from "../../core/logic/TerrainHabitat";
import GridManager from "../../managers/combat/GridManager";
import { BaseEntity } from "../core/BaseEntity";
import { LegacyMonsterAnimController } from "../monster/anims/LegacyMonsterAnimControllers";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import { StarShardsOrbitSfx } from "../../sfx/star/StarShardsOrbitSfx";
import { DeathRotateSfx } from "../../sfx/death/DeathRotateSfx";
import { DeathSmokeSfx } from "../../sfx/death/DeathSmokeSfx";
import SoundCmd from "../../utils/cmd/SoundCmd";
import { MONSTER_PRNG_FIELDS, MONSTER_RELATION_FIELDS } from "../../core/logic/LogicRelations";
import { defaultRandom } from "../../../utils/random";
import { applyMonsterDrowning } from "../../core/logic/Drowning";
import type { EquipmentDef } from "../equipment/Equipment";

type DeathSmokeSpawn = {
  x: number;
  y: number;
  displaySize: number;
};

type BoundsGameObject = Phaser.GameObjects.GameObject & {
  getBounds: (output?: Phaser.Geom.Rectangle) => Phaser.Geom.Rectangle;
};

export abstract class MonsterEntity extends CombatEntity {
  declare public scene: Game;
  declare public model: MonsterModel;

  protected override getRelationFields(): readonly string[] {
    return MONSTER_RELATION_FIELDS;
  }

  protected override getPrngFields(): readonly string[] {
    return MONSTER_PRNG_FIELDS;
  }

  /** 快照中记录 mid，供断线恢复时重建实体。 */
  protected override captureLogicState(): Record<string, import("../../../game/core/SimulationState").JsonValue> {
    return {
      ...super.captureLogicState(),
      mid: this.model.mid,
      waveID: Number((this.model as unknown as Record<string, unknown>).waveID ?? -1),
      spawnSeq: Number(this.ExtraData?.spawnSeq ?? 0),
    };
  }

  public col: number;
  public row: number;
  declare public x: number;
  declare public y: number;
  public baseDepth: number;

  private starOrbitSfx: StarShardsOrbitSfx | null = null;
  public attacking: CombatEntity | null = null;
  protected attackTimer: ITickTimerHandle | null = null;

  public animController!: IMonsterAnimController;
  public viewGroup: Phaser.GameObjects.Group;
  public attachSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private destroyListeners: Array<(entity: MonsterEntity) => void> = [];
  private initialized = false;

  /** 纯视觉出生偏移：让同格实体的渲染不重叠，不影响物理与模拟。 */
  public offsetX: number = 0;
  public offsetY: number = 0;

  constructor(scene: Game, col: number, row: number, model: MonsterModel, waveID: number) {
    const pos = PositionManager.Instance.getZombieBottomCenter(col, row);
    super(scene, pos.x, pos.y, model.maxHealth, model.faction, model);
    this.model.initializeState(scene, col, row, waveID);
    this.col = col;
    this.row = row;

    // 出生偏移必须由 seed 决定（见 applySpawnSeed），不能使用未播种的随机源。
    this.baseDepth = DepthHelper.Mob.base(row, this.offsetY);
    this.viewGroup = scene.add.group();
  }

  /**
   * 用确定性种子计算出生偏移；spawnSeq 由 MobManager 单调分配，
   * 保证同一局同一出怪序号的偏移在所有端一致。
   */
  public applySpawnSeed(spawnSeq: number): void {
    const offset = this.model.getSpawnViewOffset(this.col, this.row, spawnSeq);
    this.offsetX = offset.x;
    this.offsetY = offset.y;
    this.baseDepth = DepthHelper.Mob.base(this.row, this.offsetY);
  }

  public addDestroyListener(listener: (entity: MonsterEntity) => void) {
    this.destroyListeners.push(listener);
  }

  public addStarShards(amount = 1) {
    this.model.addStarShards(this, amount);
  }

  protected abstract buildView(): void;

  public initializeEntity(): this {
    if (this.initialized) return this;
    this.initialized = true;

    this.buildView();
    this.checkAndAddBoat();
    this.buildPhysics();

    this.playSpawnAudio();
    this.startMove();
    this.model.onCreate(this);
    // 出生时统一同步一次视图：坐姿、面罩、坐骑图层等都在此刻由 Model 状态决定。
    this.syncViewFromModel();
    return this;
  }

  protected getPhysicsBodySize(): { sizeX: number; sizeY: number } {
    return PositionManager.Instance.getZombieBodySize();
  }

  private buildPhysics() {
    const size = this.getPhysicsBodySize();
    const physicsCenter = PositionManager.Instance.getZombieBodyCenterByBottom(this.x, this.y);
    const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(physicsCenter.x, physicsCenter.y);
    rigidBodyDesc.setUserData(this);
    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.sizeX / 2, size.sizeY / 2);
    colliderDesc.setSensor(true);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    colliderDesc.setActiveCollisionTypes(
      RAPIER.ActiveCollisionTypes.DEFAULT |
      RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC
    );
    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
  }

  public override updateView(vec: { x: number, y: number }) {
    if (this.model.isDying) return;
    const nextPosition = PositionManager.Instance.getZombieBottomCenterByBody(vec.x, vec.y);
    this.x = nextPosition.x;
    this.y = nextPosition.y;

    if (!this.animController.isInAnim) {
      this.animController.updatePosition(this.x + this.offsetX, this.y + this.offsetY);
    }

    this.attachSprites.forEach((sprite) => {
      sprite.x = this.x + this.offsetX;
    });
  }

  public override stepUpdate() {
    this.model.checkOutOfBounds(this);
    // 固定逻辑帧的 Model 侧轮询（如飞行载具落地后补判脚下植物）。
    this.model.onModelStep?.(this);
    applyMonsterDrowning(this, this.model as MonsterModel);
  }

  public setVelocityX(vx: number) {
    if (!this.rigidBody || this.model.isDying) return;
    this.rigidBody.setLinvel({ x: vx, y: 0 }, true);
  }

  public startMove() {
    if (this.model.isFrozen || this.model.isStop || this.model.isDying) return;
    this.setVelocityX(-this.model.speed * this.model.speedMultiplier);
    this.animController.startLegSwing();
  }

  public stopMove() {
    this.setVelocityX(0);
    this.animController.stopLegSwing();
  }

  public startAttacking(target: CombatEntity) {
    this.model.tryStartAttack(this, target);
  }

  public stopAttacking() {
    this.model.stopAttacking(this);
  }

  /** 目标植物消失：由 Model 决定是同格接力还是放弃前进。 */
  public onAttackTargetDestroyed(target: CombatEntity | null) {
    this.model.onAttackTargetDestroyed(this, target);
  }

  public hurtTarget() {
    this.model.hurtTarget(this);
  }

  protected notifyTargetStopAttacked() {
    this.attacking?.underAttackBy.delete(this);
    this.attacking = null;
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    // 坐骑是第一道受体；爆炸让坐骑与本体各扣一次，其余按优先级路由。
    if (this.model.absorbMountDamage(this, amount, dealer, source)) {
      this.syncViewFromModel();
      return;
    }
    this.model.takeDamage(this, amount, dealer, source);
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    // buff 的手部/腿部动画速度由 Model 单向同步，回滚后也能重建。
    this.animController.setMotionSpeedScale?.(this.model.motionSpeedScale);
    // 只有配置了坐骑血条的怪物才切换坐姿与坐骑图层；普通怪的水面船表现保持原样。
    if (this.model.mountHealthMax <= 0) return;
    const mounted = this.model.hasMount();
    // speed > 0 向左走（顺时针坐姿），speed < 0 向右走（逆时针坐姿）。
    this.animController.setRidingPose?.(mounted, this.model.speed >= 0 ? 1 : -1);
    for (const key of ["boat1", "boat2", "dolphin_body", "dolphin_tail", "dolphin_fin"]) {
      this.attachSprites.get(key)?.setVisible(mounted);
    }
  }

  public onCollision(ctx: CollisionContext) {
    this.model.onCollision(this, ctx);
  }

  public ZombieDie() {
    this.model.zombieDie(this);
  }

  protected playDeathAnimation() {
    this.stopStarShardsOrbitEffect();
    this.stopMove();

    if (this.rigidBody) {
      this.scene.rapierWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }

    const targets = this.getDeathAnimationTargets();
    // 表现层只负责旋转与烟雾；实体销毁由 Model 的 DeathSettle 定时器在权威帧
    // 触发，避免在 tween onComplete 里改变击杀计数 / 波次推进造成 desync。
    const smokeSpawns = this.getDeathSmokeSpawns(this.getDeathSmokeBounds(targets));
    SfxCmd.Create(DeathRotateSfx, {
      scene: this.scene,
      targets,
      onComplete: () => this.playDeathSmokeAnimation(smokeSpawns),
    });
  }

  protected getDeathAnimationTargets(): Phaser.GameObjects.GameObject[] {
    return this.viewGroup.getChildren();
  }

  private checkAndAddBoat() {
    if (this.model.boatMounted || GridManager.Instance.RowPropertyRatio(this.row, "water") > 0) {
      const boatY = this.y + 15 * PositionManager.Instance.scaleFactor;
      const boat1 = this.scene.add.sprite(this.x, boatY, "attach/boat1")
        .setScale(PositionManager.Instance.scaleFactor * 1.4)
        .setOrigin(0.5, 1)
        .setDepth(DepthHelper.Mob.boatBack(this.baseDepth));
      const boat2 = this.scene.add.sprite(this.x, boatY, "attach/boat2")
        .setScale(PositionManager.Instance.scaleFactor * 1.4)
        .setOrigin(0.5, 1)
        .setDepth(DepthHelper.Mob.boatFront(this.baseDepth));
      this.attachSprites.set("boat1", boat1);
      this.attachSprites.set("boat2", boat2);
      this.viewGroup.addMultiple([boat1, boat2]);
    }
  }

  protected playSpawnAudio() {
    const idx = Math.floor(defaultRandom() * 3) + 1;
    SoundCmd.PlayZombieSpawn(idx);
  }

  protected playDeathSmokeAnimation(spawns = this.getDeathSmokeSpawns(null)) {
    spawns.forEach((spawn, index) => {
      SfxCmd.Create(DeathSmokeSfx, {
        scene: this.scene,
        x: spawn.x,
        y: spawn.y,
        depth: DepthHelper.Mob.deathSmoke(this.baseDepth),
        displaySize: spawn.displaySize,
        playSound: index === 0,
      });
    });
  }

  private getDeathSmokeBounds(targets: Phaser.GameObjects.GameObject[]): Phaser.Geom.Rectangle | null {
    let bounds: Phaser.Geom.Rectangle | null = null;

    targets.forEach((target) => {
      if (!this.hasBounds(target)) return;
      const targetBounds = target.getBounds();
      if (targetBounds.width <= 0 || targetBounds.height <= 0) return;

      if (!bounds) {
        bounds = new Phaser.Geom.Rectangle(
          targetBounds.x,
          targetBounds.y,
          targetBounds.width,
          targetBounds.height,
        );
        return;
      }

      Phaser.Geom.Rectangle.Union(bounds, targetBounds, bounds);
    });

    return bounds;
  }

  private hasBounds(target: Phaser.GameObjects.GameObject): target is BoundsGameObject {
    return typeof (target as Partial<BoundsGameObject>).getBounds === "function";
  }

  private getDeathSmokeSpawns(bounds: Phaser.Geom.Rectangle | null): DeathSmokeSpawn[] {
    const rect = bounds ?? this.getFallbackDeathSmokeBounds();
    const gridX = PositionManager.Instance.GRID_SIZEX;
    const gridY = PositionManager.Instance.GRID_SIZEY;
    const displaySize = Phaser.Math.Clamp(Math.min(gridX, gridY) * 0.52, 34, 52);
    const smokeCount = this.model.rank === "boss"
      ? 18
      : Phaser.Math.Clamp(Math.ceil(rect.width / Math.max(1, gridX * 0.18)) + 4, 8, 12);
    const pattern = [
      { x: 0.10, y: 0.72, size: 1.00 },
      { x: 0.22, y: 0.50, size: 0.92 },
      { x: 0.34, y: 0.68, size: 1.06 },
      { x: 0.46, y: 0.44, size: 0.88 },
      { x: 0.58, y: 0.66, size: 1.02 },
      { x: 0.70, y: 0.42, size: 0.94 },
      { x: 0.82, y: 0.62, size: 1.08 },
      { x: 0.92, y: 0.78, size: 0.90 },
      { x: 0.16, y: 0.34, size: 0.84 },
      { x: 0.28, y: 0.82, size: 0.94 },
      { x: 0.40, y: 0.26, size: 1.00 },
      { x: 0.52, y: 0.86, size: 0.86 },
      { x: 0.64, y: 0.28, size: 0.98 },
      { x: 0.76, y: 0.82, size: 0.92 },
      { x: 0.88, y: 0.36, size: 0.86 },
      { x: 0.24, y: 0.22, size: 0.80 },
      { x: 0.50, y: 0.18, size: 0.82 },
      { x: 0.74, y: 0.20, size: 0.80 },
    ];

    return pattern.slice(0, smokeCount).map((point) => ({
      x: rect.left + rect.width * point.x,
      y: rect.top + rect.height * point.y,
      displaySize: displaySize * point.size,
    }));
  }

  private getFallbackDeathSmokeBounds(): Phaser.Geom.Rectangle {
    const widthScale = this.model.rank === "boss" ? 2.4 : 1.15;
    const heightScale = this.model.rank === "boss" ? 1.7 : 1.1;
    const width = PositionManager.Instance.GRID_SIZEX * widthScale;
    const height = PositionManager.Instance.GRID_SIZEY * heightScale;

    return new Phaser.Geom.Rectangle(
      this.x + this.offsetX - width / 2,
      this.y + this.offsetY - height,
      width,
      height,
    );
  }

  private startStarShardsOrbitEffect() {
    if (this.starOrbitSfx) return;
    this.starOrbitSfx = SfxCmd.Create(StarShardsOrbitSfx, {
      scene: this.scene,
      baseDepth: this.baseDepth,
      viewGroup: this.viewGroup,
      getAnchor: () => ({
        x: this.x + this.offsetX,
        y: this.y + this.offsetY,
        active: !this.model.isDying,
      }),
    });
  }

  private stopStarShardsOrbitEffect() {
    this.starOrbitSfx?.stop();
    this.starOrbitSfx = null;
  }

  public override destroy() {
    this.stopStarShardsOrbitEffect();
    this.model.onDeath(this);
    const listeners = [...this.destroyListeners];
    this.destroyListeners.length = 0;
    listeners.forEach((listener) => listener(this));
    this.animController.destroy();
    this.attachSprites.forEach((sprite) => sprite.destroy());
    super.destroy();
  }

  /** 回滚对账：只清理表现与刚体，不触发死亡、击杀统计和 destroy listeners。 */
  protected override onSilentDestroy(): void {
    this.stopStarShardsOrbitEffect();
    this.animController.destroy();
    this.attachSprites.forEach((sprite) => sprite.destroy());
    this.destroyListeners.length = 0;
  }

  /** 快照中的 x/y 是刚体中心；逻辑坐标使用 zombie bottom-center。 */
  protected override applySnapshotPosition(x: number, y: number): void {
    const bottom = PositionManager.Instance.getZombieBottomCenterByBody(x, y);
    const dx = bottom.x - this.x;
    const dy = bottom.y - this.y;
    this.x = bottom.x;
    this.y = bottom.y;
    if (dx !== 0 || dy !== 0) {
      this.viewGroup.getChildren().forEach((child: any) => {
        if (child.x !== undefined) {
          child.x += dx;
          child.y += dy;
        }
      });
    }
    if (this.rigidBody) this.rigidBody.setTranslation({ x, y }, true);
  }
}


export type MonsterRank = "normal" | "elite" | "boss";

/** 坐骑存在时谁来吃 bullet / laser；explosion 恒定同时结算二者。 */
export type MountDamagePriority = "rider" | "mount";

export type MediumEquipmentSet = {
  head?: EquipmentDef;
  mainHand?: EquipmentDef;
  offHand?: EquipmentDef;
  mount?: EquipmentDef;
};

/** 冻结中型怪物装备定义，避免运行时改写静态配置。 */
function freezeEquipmentSet(equipment?: MediumEquipmentSet): MediumEquipmentSet | undefined {
  if (!equipment) return undefined;
  const frozen: Record<string, EquipmentDef> = {};
  for (const [slot, def] of Object.entries(equipment)) {
    if (!def) continue;
    Object.freeze(def.thresholds);
    if (def.visual) Object.freeze(def.visual);
    if (def.blockHitKinds) Object.freeze(def.blockHitKinds);
    if (def.pierceHitKinds) Object.freeze(def.pierceHitKinds);
    if (def.absorbHitKinds) Object.freeze(def.absorbHitKinds);
    if (def.mountPierceHitKinds) Object.freeze(def.mountPierceHitKinds);
    frozen[slot] = Object.freeze(def);
  }
  return Object.freeze(frozen) as MediumEquipmentSet;
}

export type MonsterDefinition = {
  readonly mid: number;
  readonly nameKey: string;
  readonly texturePath?: string;
  readonly level: number;
  readonly weight: (waveID: number) => number;
  readonly leastWaveID?: number;
  readonly leastWaveIDByStageID?: (stageID: number) => number;
  readonly rank?: MonsterRank;
  /** 是否免疫 buff（golem / centipede 系列为 true）；与 rank 无关。 */
  readonly buffImmune?: boolean;
  readonly maxHealth: number;
  readonly baseSpeed: number;
  /** 空手近战伤害；武器加成单独由 EquipmentDef.weaponDamage 提供。 */
  readonly baseAttackDamage: number;
  readonly attackInterval?: number;
  /** 躯体破损阶段阈值；属于 Model 配置，不在 Entity 构造函数里定义。 */
  readonly damageThresholds?: readonly number[];
  readonly isDefaultFlying?: boolean;
  readonly isDefaultInVoid?: boolean;
  readonly couldCarryStarShards?: boolean;
  /** 能刷在哪、能活在哪的地形通行域；缺省为仅地面。 */
  readonly habitats?: readonly TerrainHabitat[];
  /** 木船僵尸：强制挂载木船表现，不依赖出生行地形。 */
  readonly boatMounted?: boolean;
  /** 飞行载具（气球等）血量；配置后该怪物有第二条血条，归零即迫降。 */
  readonly vehicleHealth?: number;
  /** 坐骑血量（木船/海豚等）；骑手与坐骑是同一实体的两层。 */
  readonly mountHealth?: number;
  /** 坐骑存在时 bullet/laser 的结算对象；explosion 恒定同时打二者。缺省优先坐骑。 */
  readonly mountDamagePriority?: MountDamagePriority;
  /** 是否会被不合适的地形溺亡；缺省 true。 */
  readonly canDrown?: boolean;
  /** 阵营；默认为僵尸。友方召唤物（例如气球TNT分身）可以配成 PLANT。 */
  readonly faction?: Faction;
  /** 中型怪物装备槽；不配置时沿用旧 mountHealth/vehicleHealth 字段。 */
  readonly equipment?: MediumEquipmentSet;
  /** 骨架弓手类：箭伤害与射击间隔。 */
  readonly arrowDamage?: number;
  readonly arrowInterval?: number;
  readonly createEntity: (scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) => MonsterEntity;
};

export class PresetMonsterModel extends MonsterModel {
  public constructor(def: MonsterDefinition) {
    super();
    // 定义对象只读；数组也冻结，避免运行时意外改写配置。
    const definition: MonsterDefinition = Object.freeze({
      ...def,
      habitats: Object.freeze([...normalizeHabitats(def.habitats)]),
      damageThresholds: Object.freeze([...(def.damageThresholds ?? [])]),
      equipment: freezeEquipmentSet(def.equipment),
    });
    this.setConfigValue("definition", definition);
  }

  public getWeight(waveID: number): number {
    return this.weight(waveID);
  }

  public createEntity(scene: Game, col: number, row: number, waveID: number): MonsterEntity {
    return this.initializeEntity(this.definition.createEntity(scene, col, row, this, waveID));
  }
}

export abstract class BaseMonsterEntity extends MonsterEntity {
  declare public model: PresetMonsterModel;
  private readonly handAttachmentKeys = new Set<string>();
  private readonly fixedAttachmentOffsets = new Map<string, { x: number; y: number }>();

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
    this.ExtraData.waveId = waveID;
    this.model.health = model.maxHealth;
    this.model.healthMax = model.maxHealth;
  }

  protected abstract createAnimController(): IMonsterAnimController;

  protected buildView(): void {
    if (this.animController) return;
    this.animController = this.createAnimController();
    this.animController.setDepth(this.baseDepth);
    this.animController.updatePosition(this.x + this.offsetX, this.y + this.offsetY);
    this.syncRegisteredAttachments();
  }

  public override updateView(vec: { x: number, y: number }): void {
    super.updateView(vec);
    this.syncRegisteredAttachments();
  }

  public registerHandAttachment(key: string) {
    this.handAttachmentKeys.add(key);
    this.syncHandAttachment(key);
  }

  /** 装备渲染层统一入口：只记录固定件偏移，不保存业务数值。 */
  public registerEquipmentAttachment(key: string) {
    this.registerFixedAttachment(key);
  }

  private registerFixedAttachment(key: string) {
    const sprite = this.attachSprites.get(key);
    if (!sprite) return;

    this.fixedAttachmentOffsets.set(key, {
      x: sprite.x - (this.x + this.offsetX),
      y: sprite.y - (this.y + this.offsetY),
    });
    this.syncFixedAttachment(key);
  }

  private syncRegisteredAttachments() {
    this.handAttachmentKeys.forEach((key) => this.syncHandAttachment(key));
    this.fixedAttachmentOffsets.forEach((_offset, key) => this.syncFixedAttachment(key));
  }

  private syncHandAttachment(key: string) {
    const sprite = this.attachSprites.get(key);
    if (!sprite) return;

    const anchor = this.animController?.getHandAnchor?.() ?? {
      x: this.x + this.offsetX - PositionManager.Instance.GRID_SIZEX * 0.42,
      y: this.y + this.offsetY - PositionManager.Instance.GRID_SIZEY * 0.7,
    };
    sprite.setPosition(anchor.x, anchor.y);
  }

  private syncFixedAttachment(key: string) {
    const sprite = this.attachSprites.get(key);
    const offset = this.fixedAttachmentOffsets.get(key);
    if (!sprite || !offset) return;

    const x = this.x + this.offsetX + offset.x;
    const y = this.y + this.offsetY + offset.y;

    // 飞行中僵尸把整套纸片零件刚性旋转 90°，固定挂件（帽子等）必须跟随同一旋转。
    const pivot = this.animController?.getHangPivot?.() ?? null;
    if (pivot) {
      const dx = x - pivot.x;
      const dy = y - pivot.y;
      sprite.setPosition(pivot.x + dy, pivot.y - dx);
      sprite.setAngle(-90);
      return;
    }

    sprite.setPosition(x, y);
    sprite.setAngle(0);
  }

  public getLegacyController() {
    return this.animController as LegacyMonsterAnimController<any> | undefined;
  }

  protected getAnimTargets() {
    return this.getLegacyController()?.getTargets() ?? [];
  }

  protected syncHealth() {
    this.model.health = this.currentHealth;
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    this.model.takeDamage(this, amount, dealer, source);
  }

  protected onHurt(_amount: number, _realDamage: number, _dealer?: BaseEntity, _source?: BaseEntity): void { }

  protected onDeath(): void {
    this.model.zombieDie(this);
  }

  protected override getDeathAnimationTargets(): Phaser.GameObjects.GameObject[] {
    return [...new Set([...this.getAnimTargets(), ...this.attachSprites.values()])];
  }
}

export abstract class StagedBodyMonsterEntity extends BaseMonsterEntity {
  declare private currentStage: number;

  protected updateBodyDamageStage() {
    this.model.updateBodyDamageStage(this, this.model.damageThresholds);
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    super.takeDamage(amount, dealer, source);
    this.updateBodyDamageStage();
  }
}

