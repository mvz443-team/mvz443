import { LevelScaledValue } from "../../../../utils/numbervalue";
import MobManager from "../../../managers/combat/MobManager";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { JsonValue } from "../../../core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import type { ModelHost } from "../../../core/logic/LogicModel";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { CombatEntity } from "../../../models/core/CombatEntity";
import { PlantModel } from "../../../models/PlantModel";
import { Faction } from "../../../models/Enum";
import type { Game } from "../../../scenes/Game";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import DepthHelper from "../../../utils/helper/DepthHelper";

const BOUNCING_ANVIL_EVENTS = {
  Land: "BouncingAnvilLand",
  StarShardsLand: "BouncingAnvilStarShardsLand",
  StarShardsFinish: "BouncingAnvilStarShardsFinish",
} as const;

/** 警戒线从种植中心向左右各延伸 1.4 格。 */
const WARNING_RANGE_GRID = 1.4;
/** Lv1–Lv4 的隐形激光长度。 */
const LASER_LENGTH_GRID = 0.8;
/** Lv5 起分身加入后扩展到的激光长度。 */
const CLONE_LASER_LENGTH_GRID = 1.5;
/** 普通跃击与星碎分身共用 300ms 悬空时间，落地后才结算伤害。 */
const JUMP_DURATION_MS = 300;
const LASER_DURATION_MS = 50;
/** 星之碎片固定效果：0.8 格、1500 伤害、每个目标 2 次。 */
const STAR_SHARDS_LASER_LENGTH_GRID = 0.8;
const STAR_SHARDS_DAMAGE = 1500;
const STAR_SHARDS_HITS_PER_TARGET = 2;
const STAR_SHARDS_FINISH_MS = 500;
/** 两道星碎分身起跳时的左右错位，避免完全重叠。 */
const STAR_CLONE_START_OFFSET_GRID = 0.12;
/** 星碎分身的地面投影，用于在快速跃击时提供落点参照。 */
const STAR_CLONE_SHADOW_ALPHA = 0.38;
const STAR_CLONE_SHADOW_MIN_SCALE = 0.6;
/** 空中拉伸，让起跳与落地不再像直线位移。 */
const STAR_CLONE_STRETCH_X = 0.06;
const STAR_CLONE_STRETCH_Y = 0.1;

/** Entity 表现层复用的时序配置；战斗时序仍以 Model 的 schedule 为准。 */
export const BOUNCING_ANVIL_TIMING = {
  jumpMs: JUMP_DURATION_MS,
  starShardsFinishMs: STAR_SHARDS_FINISH_MS,
} as const;

export class BouncingAnvilModel extends PlantModel {
  public override pid = 18;
  public override nameKey = "name_bouncing_anvil";
  public override descriptionKey = "bouncing_anvil_description";
  /** 暂无独立素材，当前贴图由黑曜石复制而来。 */
  public override texturePath = "plant/bouncing_anvil";

  public maxHealth = new LevelScaledValue(400);
  public cost = new LevelScaledValue(50);
  public cooldown = new LevelScaledValue(30000).setDecValue(0.85);
  public cooldownStartAtRatio = 0.5;

  public damage = new LevelScaledValue(1500);
  public isNightPlant = false;

  /** 跃击进行中；用于阻止同一次落地前重复触发。 */
  public isJumping = false;
  /** 起跳瞬间锁定的目标中心，落地时据此生成激光。 */
  public jumpTargetX = 0;
  public jumpTargetRow = 0;

  /** 星之碎片分身表现与固定伤害状态；不设置 hasTriggered，因此不会消耗本体。 */
  public starShardActive = false;
  public starShardPhase = 0;
  public starShardHasTarget = false;
  public starShardTargetCount = 0;
  public starShardTarget0X = 0;
  public starShardTarget0Row = 0;
  public starShardTarget1X = 0;
  public starShardTarget1Row = 0;

  public override readonly tickEventNames: readonly string[] = [
    ...DEFAULT_TICK_EVENT_NAMES,
    BOUNCING_ANVIL_EVENTS.Land,
    BOUNCING_ANVIL_EVENTS.StarShardsLand,
    BOUNCING_ANVIL_EVENTS.StarShardsFinish,
  ];

  public get hasClone(): boolean {
    return this.level >= 5;
  }

  public getLaserLength(level: number = this.level): number {
    return level >= 5 ? CLONE_LASER_LENGTH_GRID : LASER_LENGTH_GRID;
  }

  public override onModelStep(host: ModelHost): void {
    if (
      this.health <= 0 ||
      this.isSleeping ||
      this.hasTriggered ||
      this.isJumping ||
      this.starShardActive
    ) return;

    const target = this.findTriggerTarget(host);
    if (target) this.startJump(host, target);
  }

  public canTriggerOn(host: ModelHost, target: unknown): boolean {
    if (!(target instanceof MonsterEntity)) return false;
    if (target.faction === host.faction) return false;
    if (target.currentHealth <= 0 || target.model.isDying) return false;
    if (target.model.isFlying || target.model.isInVoid) return false;

    const hostRow = host.row ?? (host as unknown as PlantEntity).row;
    if (target.GetRow() !== hostRow) return false;

    return Math.abs(target.x - host.x) <= WARNING_RANGE_GRID * PositionManager.Instance.GRID_SIZEX;
  }

  public findTriggerTarget(host: ModelHost): MonsterEntity | null {
    const row = host.row ?? (host as unknown as PlantEntity).row;
    const mobs = MobManager.Instance.MobsByLane.get(row);
    if (!mobs) return null;

    let nearest: MonsterEntity | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const mob of mobs) {
      if (!(mob instanceof MonsterEntity) || !this.canTriggerOn(host, mob)) continue;

      const distance = Math.abs(mob.x - host.x);
      if (distance < nearestDistance || (distance === nearestDistance && this.isBefore(mob, nearest))) {
        nearest = mob;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  private isBefore(candidate: MonsterEntity, current: MonsterEntity | null): boolean {
    if (!current) return true;
    if (candidate.x !== current.x) return candidate.x < current.x;
    return (candidate.SnapshotId ?? "") < (current.SnapshotId ?? "");
  }

  private startJump(host: ModelHost, target: MonsterEntity): void {
    this.hasTriggered = true;
    this.isJumping = true;
    this.jumpTargetX = target.x;
    this.jumpTargetRow = target.GetRow();

    this.tickmanager.schedule(BOUNCING_ANVIL_EVENTS.Land, JUMP_DURATION_MS, {
      args: {
        x: this.jumpTargetX,
        row: this.jumpTargetRow,
        level: this.level,
      },
    });

    host.syncViewFromModel?.();
  }

  public override onStarShards(entity: BouncingAnvilEntity): void {
    if (entity.currentHealth <= 0 || this.starShardActive) return;

    const targets = this.findStarShardTargets(entity);
    const first = targets[0];
    const second = targets[1];

    this.starShardActive = true;
    this.starShardPhase = 1;
    this.starShardHasTarget = targets.length > 0;
    this.starShardTargetCount = Math.max(1, targets.length);
    this.starShardTarget0X = first?.x ?? entity.x;
    this.starShardTarget0Row = first?.GetRow() ?? entity.row;
    this.starShardTarget1X = second?.x ?? this.starShardTarget0X;
    this.starShardTarget1Row = second?.GetRow() ?? this.starShardTarget0Row;

    this.tickmanager.schedule(BOUNCING_ANVIL_EVENTS.StarShardsLand, JUMP_DURATION_MS, {
      args: {
        hasTarget: this.starShardHasTarget,
        count: this.starShardTargetCount,
        x0: this.starShardTarget0X,
        row0: this.starShardTarget0Row,
        x1: this.starShardTarget1X,
        row1: this.starShardTarget1Row,
      },
    });
    this.tickmanager.schedule(BOUNCING_ANVIL_EVENTS.StarShardsFinish, STAR_SHARDS_FINISH_MS);

    entity.syncViewFromModel();
  }

  public findStarShardTargets(host: ModelHost): MonsterEntity[] {
    const candidates: MonsterEntity[] = [];
    const seen = new Set<MonsterEntity>();

    for (const mobs of MobManager.Instance.MobsByLane.values()) {
      for (const mob of mobs) {
        if (!(mob instanceof MonsterEntity) || seen.has(mob)) continue;
        seen.add(mob);

        if (mob.faction === host.faction) continue;
        if (mob.currentHealth <= 0 || mob.model.isDying || mob.model.isInVoid) continue;
        candidates.push(mob);
      }
    }

    candidates.sort((left, right) => {
      if (right.currentHealth !== left.currentHealth) {
        return right.currentHealth - left.currentHealth;
      }
      const leftId = left.SnapshotId ?? "";
      const rightId = right.SnapshotId ?? "";
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });

    return candidates.slice(0, 2);
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === BOUNCING_ANVIL_EVENTS.Land) {
      this.land(args);
      return;
    }
    if (eventName === BOUNCING_ANVIL_EVENTS.StarShardsLand) {
      this.starShardsLand(args);
      return;
    }
    if (eventName === BOUNCING_ANVIL_EVENTS.StarShardsFinish) {
      this.starShardsFinish();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private land(args: JsonValue): void {
    const host = this.host;
    if (!host) return;

    // 星碎期间取消这次普通跃击：不造成普通激光，也不消耗铁砧。
    // 星碎结束后 onModelStep 会重新开始警戒判定。
    if (this.starShardActive) {
      this.isJumping = false;
      this.hasTriggered = false;
      host.syncViewFromModel?.();
      return;
    }

    const parsed = args && typeof args === "object" && !Array.isArray(args)
      ? args as Record<string, JsonValue>
      : null;
    const targetX = typeof parsed?.x === "number" ? parsed.x : this.jumpTargetX;
    const row = typeof parsed?.row === "number" ? parsed.row : this.jumpTargetRow;
    const level = typeof parsed?.level === "number" ? parsed.level : this.level;

    const laserLength = this.getLaserLength(level);
    const laserCenterX = targetX;
    const startX = laserCenterX - laserLength * PositionManager.Instance.GRID_SIZEX / 2;
    const scene = (host as unknown as PlantEntity).scene as Game;

    ProjectileCmd.CreateLaser(scene, startX, row, {
      damage: this.damage.getValueAt(level),
      faction: host.faction as Faction,
      dealer: host as unknown as CombatEntity,
      distance: laserLength,
      duration: LASER_DURATION_MS,
      invisible: true,
      couldAttackFlying: false,
    });

    this.isJumping = false;
    host.syncViewFromModel?.();
    host.destroySelf();
  }

  private starShardsLand(args: JsonValue): void {
    const host = this.host;
    if (!host) return;

    const parsed = args && typeof args === "object" && !Array.isArray(args)
      ? args as Record<string, JsonValue>
      : null;
    const hasTarget = parsed?.hasTarget === true;
    const count = typeof parsed?.count === "number" ? Math.max(1, parsed.count) : 1;

    if (hasTarget) {
      for (let index = 0; index < count; index++) {
        const x = index === 0 ? parsed?.x0 : parsed?.x1;
        const row = index === 0 ? parsed?.row0 : parsed?.row1;
        if (typeof x !== "number" || typeof row !== "number") continue;

        for (let hit = 0; hit < STAR_SHARDS_HITS_PER_TARGET; hit++) {
          this.createStarShardLaser(host, x, row);
        }
      }
    }

    this.starShardPhase = 2;
    host.syncViewFromModel?.();
  }

  private starShardsFinish(): void {
    this.starShardActive = false;
    this.starShardPhase = 0;
    this.starShardHasTarget = false;
    this.starShardTargetCount = 0;
    this.host?.syncViewFromModel?.();
  }

  private createStarShardLaser(host: ModelHost, centerX: number, row: number): void {
    const startX = centerX - STAR_SHARDS_LASER_LENGTH_GRID * PositionManager.Instance.GRID_SIZEX / 2;
    const scene = (host as unknown as PlantEntity).scene as Game;

    ProjectileCmd.CreateLaser(scene, startX, row, {
      damage: STAR_SHARDS_DAMAGE,
      faction: host.faction as Faction,
      dealer: host as unknown as CombatEntity,
      distance: STAR_SHARDS_LASER_LENGTH_GRID,
      duration: LASER_DURATION_MS,
      invisible: true,
      couldAttackFlying: true,
    });
  }

  public createEntity(scene: Game, col: number, row: number, level: number): BouncingAnvilEntity {
    return this.initializeEntity(new BouncingAnvilEntity(scene, col, row, level));
  }
}

export const BouncingAnvilData = new BouncingAnvilModel();

export class BouncingAnvilEntity extends PlantEntity {
  public declare model: BouncingAnvilModel;

  private declare mainSprite: Phaser.GameObjects.Sprite;
  private declare cloneSprite: Phaser.GameObjects.Sprite;
  private declare starCloneA: Phaser.GameObjects.Sprite;
  private declare starCloneB: Phaser.GameObjects.Sprite;
  private declare starShadowA: Phaser.GameObjects.Ellipse;
  private declare starShadowB: Phaser.GameObjects.Ellipse;
  private jumpTween: Phaser.Tweens.Tween | null = null;
  private starShardTween: Phaser.Tweens.Tween | null = null;
  private starShardVisualKey = "";

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, BouncingAnvilData, level);
  }

  protected override buildView(): void {
    const size = PositionManager.Instance.getPlantDisplaySize();

    const createSprite = () => this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY);

    this.mainSprite = createSprite().setDepth(this.baseDepth);
    this.cloneSprite = createSprite()
      .setDepth(this.baseDepth - 1)
      .setVisible(false);
    const createStarClone = () => {
      const sprite = createSprite().setVisible(false);
      sprite.setData("baseScaleX", sprite.scaleX);
      sprite.setData("baseScaleY", sprite.scaleY);
      return sprite;
    };
    const createStarShadow = () => this.scene.add.ellipse(
      0,
      0,
      size.sizeX * 0.62,
      size.sizeY * 0.16,
      0x000000,
      STAR_CLONE_SHADOW_ALPHA,
    )
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    this.starCloneA = createStarClone().setDepth(this.baseDepth - 2);
    this.starCloneB = createStarClone().setDepth(this.baseDepth - 2);
    this.starShadowA = createStarShadow();
    this.starShadowB = createStarShadow();

    this.viewGroup.addMultiple([
      this.starShadowA,
      this.starShadowB,
      this.starCloneA,
      this.starCloneB,
      this.cloneSprite,
      this.mainSprite,
    ]);
    this.syncViewFromModel();
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    if (
      !this.mainSprite
      || !this.cloneSprite
      || !this.starCloneA
      || !this.starCloneB
      || !this.starShadowA
      || !this.starShadowB
    ) return;

    const alive = this.currentHealth > 0;
    if (!alive) {
      this.stopStarShardVisual();
      return;
    }

    // 星碎期间由专用分身承担表现，隐藏 5 级常驻分身，避免出现三个分身。
    if (this.model.starShardActive) {
      this.stopJumpVisual();
      this.mainSprite.setVisible(true);
      this.mainSprite.setPosition(this.x, this.y);
      this.cloneSprite.setVisible(false);
      this.syncStarShardVisual();
      return;
    }

    this.stopStarShardVisual();

    const hasClone = this.model.hasClone;
    this.cloneSprite.setVisible(hasClone);

    if (this.model.isJumping) {
      this.playJumpVisual(hasClone);
      return;
    }

    this.stopJumpVisual();
    if (this.model.hasTriggered) {
      this.placeAtLandingPoint(hasClone);
      return;
    }

    const cloneX = this.x - PositionManager.Instance.GRID_SIZEX * 0.45;
    this.mainSprite.setPosition(this.x, this.y);
    this.cloneSprite.setPosition(cloneX, this.y);
  }

  private syncStarShardVisual(): void {
    const model = this.model;
    const count = model.starShardHasTarget
      ? Math.max(1, model.starShardTargetCount)
      : 1;
    const key = [
      model.starShardPhase,
      model.starShardHasTarget ? 1 : 0,
      count,
      model.starShardTarget0X,
      model.starShardTarget0Row,
      model.starShardTarget1X,
      model.starShardTarget1Row,
    ].join(":");

    if (key === this.starShardVisualKey) return;
    this.starShardVisualKey = key;
    this.stopStarShardTween();

    if (model.starShardPhase <= 0) {
      this.starCloneA.setVisible(false);
      this.starCloneB.setVisible(false);
      this.starShadowA.setVisible(false);
      this.starShadowB.setVisible(false);
      return;
    }

    this.starCloneA.setVisible(count >= 1);
    this.starCloneB.setVisible(count >= 2);
    this.starShadowA.setVisible(count >= 1);
    this.starShadowB.setVisible(count >= 2);

    if (model.starShardPhase === 1) {
      if (model.starShardHasTarget) this.playStarShardJump(count);
      else this.playStarShardHop();
      return;
    }

    this.landStarClones(count);
  }

  private playStarShardJump(count: number): void {
    const startX = this.x;
    const startY = this.y;
    const jumpHeight = PositionManager.Instance.GRID_SIZEY * 1.2;
    const gridX = PositionManager.Instance.GRID_SIZEX;
    const sprites = [this.starCloneA, this.starCloneB];
    const shadows = [this.starShadowA, this.starShadowB];
    const targets = [
      {
        x: this.model.starShardTarget0X,
        y: this.getLandingY(this.model.starShardTarget0Row),
        row: this.model.starShardTarget0Row,
      },
      {
        x: this.model.starShardTarget1X,
        y: this.getLandingY(this.model.starShardTarget1Row),
        row: this.model.starShardTarget1Row,
      },
    ];
    const progress = { t: 0 };

    for (let index = 0; index < count; index++) {
      const sprite = sprites[index];
      const shadow = shadows[index];
      const target = targets[index];
      const cloneStartX = startX + this.getStarCloneStartOffset(index, count) * gridX;
      this.resetStarCloneTransform(sprite);
      sprite
        .setDepth(this.getStarCloneDepth(target.row))
        .setPosition(cloneStartX, startY)
        .setVisible(true);
      shadow
        .setDepth(this.getStarShadowDepth(target.row))
        .setPosition(cloneStartX, startY)
        .setScale(1)
        .setAlpha(STAR_CLONE_SHADOW_ALPHA)
        .setVisible(true);
    }

    this.starShardTween = this.scene.tweens.add({
      targets: progress,
      t: 1,
      duration: BOUNCING_ANVIL_TIMING.jumpMs,
      ease: "Linear",
      onUpdate: () => {
        const t = progress.t;
        const travelT = t * t * (3 - 2 * t);
        const liftRatio = Math.sin(Math.PI * t);
        const lift = liftRatio * jumpHeight;
        for (let index = 0; index < count; index++) {
          const target = targets[index];
          const cloneStartX = startX + this.getStarCloneStartOffset(index, count) * gridX;
          const sprite = sprites[index];
          const shadow = shadows[index];
          const x = cloneStartX + (target.x - cloneStartX) * travelT;
          const groundY = startY + (target.y - startY) * travelT;
          const base = this.getStarCloneBaseScale(sprite);

          sprite.x = x;
          sprite.y = groundY - lift;
          sprite.setScale(
            base.x * (1 - STAR_CLONE_STRETCH_X * liftRatio),
            base.y * (1 + STAR_CLONE_STRETCH_Y * liftRatio),
          );

          shadow
            .setPosition(x, groundY)
            .setScale(1 - (1 - STAR_CLONE_SHADOW_MIN_SCALE) * liftRatio)
            .setAlpha(STAR_CLONE_SHADOW_ALPHA * (1 - 0.35 * liftRatio));
        }
      },
    });
  }

  private playStarShardHop(): void {
    const startX = this.x;
    const startY = this.y;
    const jumpHeight = PositionManager.Instance.GRID_SIZEY * 1.2;
    const progress = { t: 0 };
    const shadow = this.starShadowA;

    this.resetStarCloneTransform(this.starCloneA);
    this.starCloneA
      .setDepth(this.getStarCloneDepth(this.row))
      .setPosition(startX, startY)
      .setVisible(true);
    shadow
      .setDepth(this.getStarShadowDepth(this.row))
      .setPosition(startX, startY)
      .setScale(1)
      .setAlpha(STAR_CLONE_SHADOW_ALPHA)
      .setVisible(true);

    this.starShardTween = this.scene.tweens.add({
      targets: progress,
      t: 1,
      duration: BOUNCING_ANVIL_TIMING.jumpMs,
      ease: "Linear",
      onUpdate: () => {
        const liftRatio = Math.sin(Math.PI * progress.t);
        const base = this.getStarCloneBaseScale(this.starCloneA);
        this.starCloneA.x = startX;
        this.starCloneA.y = startY - liftRatio * jumpHeight;
        this.starCloneA.setScale(
          base.x * (1 - STAR_CLONE_STRETCH_X * liftRatio),
          base.y * (1 + STAR_CLONE_STRETCH_Y * liftRatio),
        );
        shadow
          .setPosition(startX, startY)
          .setScale(1 - (1 - STAR_CLONE_SHADOW_MIN_SCALE) * liftRatio)
          .setAlpha(STAR_CLONE_SHADOW_ALPHA * (1 - 0.35 * liftRatio));
      },
    });
  }

  private landStarClones(count: number): void {
    const sprites = [this.starCloneA, this.starCloneB];
    const shadows = [this.starShadowA, this.starShadowB];
    const targets = [
      {
        x: this.model.starShardTarget0X,
        row: this.model.starShardTarget0Row,
      },
      {
        x: this.model.starShardTarget1X,
        row: this.model.starShardTarget1Row,
      },
    ];

    for (let index = 0; index < count; index++) {
      const sprite = sprites[index];
      const shadow = shadows[index];
      let row = this.row;
      if (this.model.starShardHasTarget) {
        row = targets[index].row;
        sprite
          .setDepth(this.getStarCloneDepth(row))
          .setPosition(targets[index].x, this.getLandingY(row));
      } else {
        sprite
          .setDepth(this.getStarCloneDepth(row))
          .setPosition(this.x, this.y);
      }
      sprite.setVisible(true);
      shadow
        .setDepth(this.getStarShadowDepth(row))
        .setPosition(sprite.x, sprite.y)
        .setScale(1)
        .setAlpha(STAR_CLONE_SHADOW_ALPHA)
        .setVisible(true);
      this.playStarLandingImpact(sprite.x, sprite.y, row);
    }

    this.playStarLandingSquash(count);
  }

  private playStarLandingImpact(x: number, y: number, row: number): void {
    const scale = PositionManager.Instance.scaleFactor;
    const glow = this.scene.add.circle(
      x,
      y - 6 * scale,
      6 * scale,
      0xfff2a6,
      0.55,
    ).setDepth(this.getStarCloneDepth(row) + 1);

    this.scene.tweens.add({
      targets: glow,
      scale: 3,
      alpha: 0,
      duration: 180,
      ease: "Sine.easeOut",
      onComplete: () => glow.destroy(),
    });

    const ring = this.scene.add.circle(
      x,
      y - 6 * scale,
      7 * scale,
      0x000000,
      0,
    )
      .setStrokeStyle(Math.max(1, 2 * scale), 0xffd166, 0.9)
      .setDepth(this.getStarCloneDepth(row) + 2);

    this.scene.tweens.add({
      targets: ring,
      scale: 2.6,
      alpha: 0,
      duration: 200,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  private playStarLandingSquash(count: number): void {
    const sprites = [this.starCloneA, this.starCloneB];
    const shadows = [this.starShadowA, this.starShadowB];
    const bases = sprites.map((sprite) => this.getStarCloneBaseScale(sprite));
    const progress = { t: 0 };
    const duration = Math.max(
      1,
      BOUNCING_ANVIL_TIMING.starShardsFinishMs - BOUNCING_ANVIL_TIMING.jumpMs,
    );

    this.starShardTween = this.scene.tweens.add({
      targets: progress,
      t: 1,
      duration,
      ease: "Linear",
      onUpdate: () => {
        const squash = Math.sin(Math.PI * progress.t);
        const shrink = 1 - 0.25 * progress.t;
        for (let index = 0; index < count; index++) {
          const sprite = sprites[index];
          const shadow = shadows[index];
          const base = bases[index];
          sprite.setScale(
            base.x * (1 + 0.22 * squash) * shrink,
            base.y * (1 - 0.3 * squash) * shrink,
          );
          sprite.setAlpha(1 - 0.55 * progress.t);
          shadow
            .setScale(1 + 0.35 * squash)
            .setAlpha(STAR_CLONE_SHADOW_ALPHA * (1 - progress.t));
        }
      },
    });
  }

  private getStarCloneStartOffset(index: number, count: number): number {
    if (count < 2) return 0;
    return index === 0 ? -STAR_CLONE_START_OFFSET_GRID : STAR_CLONE_START_OFFSET_GRID;
  }

  private getStarCloneDepth(_row: number): number {
    // 星碎分身是短暂的全局特效；固定在战斗层之上，避免被本体、僵尸或行深度遮挡。
    return DepthHelper.Sfx.explosion();
  }

  private getStarShadowDepth(row: number): number {
    // 投影留在对应行的地表层，避免像一块黑色贴片盖在敌人身上。
    return DepthHelper.Plant.sfx(DepthHelper.Plant.base(row));
  }

  private getStarCloneBaseScale(sprite: Phaser.GameObjects.Sprite): { x: number; y: number } {
    return {
      x: (sprite.getData("baseScaleX") as number | undefined) ?? 1,
      y: (sprite.getData("baseScaleY") as number | undefined) ?? 1,
    };
  }

  private resetStarCloneTransform(sprite: Phaser.GameObjects.Sprite): void {
    const base = this.getStarCloneBaseScale(sprite);
    sprite.setScale(base.x, base.y).setAlpha(1);
  }

  private stopStarShardVisual(): void {
    this.starShardVisualKey = "";
    this.stopStarShardTween();
    if (this.starCloneA) {
      this.resetStarCloneTransform(this.starCloneA);
      this.starCloneA.setVisible(false);
    }
    if (this.starCloneB) {
      this.resetStarCloneTransform(this.starCloneB);
      this.starCloneB.setVisible(false);
    }
    if (this.starShadowA) {
      this.starShadowA.setScale(1).setAlpha(STAR_CLONE_SHADOW_ALPHA).setVisible(false);
    }
    if (this.starShadowB) {
      this.starShadowB.setScale(1).setAlpha(STAR_CLONE_SHADOW_ALPHA).setVisible(false);
    }
  }

  private stopStarShardTween(): void {
    if (!this.starShardTween) return;
    this.starShardTween.stop();
    this.starShardTween.remove();
    this.starShardTween = null;
  }

  private playJumpVisual(hasClone: boolean): void {
    this.stopJumpVisual();

    const targetY = this.getLandingY(this.model.jumpTargetRow);
    const targets = hasClone
      ? [this.mainSprite, this.cloneSprite]
      : [this.mainSprite];
    const startPositions = targets.map((sprite) => ({ x: sprite.x, y: sprite.y }));
    const jumpHeight = PositionManager.Instance.GRID_SIZEY * 1.2;
    const progress = { t: 0 };

    this.jumpTween = this.scene.tweens.add({
      targets: progress,
      t: 1,
      duration: JUMP_DURATION_MS,
      ease: "Linear",
      onUpdate: () => {
        const t = progress.t;
        const lift = Math.sin(Math.PI * t) * jumpHeight;
        targets.forEach((sprite, index) => {
          const start = startPositions[index];
          sprite.x = start.x + (this.model.jumpTargetX - start.x) * t;
          sprite.y = start.y + (targetY - start.y) * t - lift;
        });
      },
    });
  }

  private stopJumpVisual(): void {
    if (!this.jumpTween) return;
    this.jumpTween.stop();
    this.jumpTween.remove();
    this.jumpTween = null;
  }

  private placeAtLandingPoint(hasClone: boolean): void {
    const targetY = this.getLandingY(this.model.jumpTargetRow);
    this.mainSprite.setPosition(this.model.jumpTargetX, targetY);
    this.cloneSprite.setPosition(this.model.jumpTargetX, targetY);
    this.cloneSprite.setVisible(hasClone);
  }

  private getLandingY(row: number): number {
    return PositionManager.Instance.getPlantBottomCenter(0, row).y;
  }
}

export default BouncingAnvilData;
