import RAPIER, { Vector } from "@dimforge/rapier2d-deterministic-compat";
import PlantsManager from "../../managers/combat/PlantsManager";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { CombatEntity } from "../core/CombatEntity";
import { Faction } from "../Enum";
import { PlantModel, type PlantStackRole } from "../PlantModel";
import { ProjectileCmd } from "../../utils/cmd/ProjectileCmd";
import DepthHelper from "../../utils/helper/DepthHelper";
import CombatManager from "../../managers/CombatManager";
import { CollisionContext } from "../../types";
import { BaseEntity } from "../core/BaseEntity";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import SoundCmd from "../../utils/cmd/SoundCmd";
import { StarShardsBurstSfx } from "../../sfx/star/StarShardsBurstSfx";
import { getLevelBadgeTextureKey } from "../../ui/levelBadgeSvg";
import type { JsonValue } from "../../core/SimulationState";
import { PLANT_PRNG_FIELDS, PLANT_RELATION_FIELDS } from "../../core/logic/LogicRelations";

// entities/PlantEntity.ts
export abstract class PlantEntity extends CombatEntity {
  /** BaseEntity 已克隆为实例专属 Model。 */
  public declare model: PlantModel;

  public col: number;
  public row: number;

  declare public level: number;
  public baseDepth: number;

  /** 运行时状态由 Model 的字段访问器提供。 */
  declare public isSleeping: boolean;

  // 表现层容器（替代原有的 extends Sprite）
  declare public viewGroup: Phaser.GameObjects.Group;

  // 睡眠特效
  private sleepingText: Phaser.GameObjects.Text | null = null;
  private sleepingTween: Phaser.Tweens.Tween | null = null;
  private levelBadge: Phaser.GameObjects.Image | null = null;
  private initialized = false;

  constructor(scene: Game, col: number, row: number, model: PlantModel, level: number) {
    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);

    // 传入模型计算出的血量，并指定为 PLANT 阵营
    const hp = model.maxHealth.getValueAt(level);
    super(scene, x, y, hp, Faction.PLANT, model);
    this.baseDepth = DepthHelper.Plant.base(row);

    this.col = col;
    this.row = row;
    this.model.level = level;
  }

  public get pid() {
    return this.model.pid;
  }

  /** 错落角色由 Model 决定；转发给 PlantTargeting 做目标/伤害路由。 */
  public get stackRole(): PlantStackRole {
    return this.model.stackRole;
  }

  public override createExplosion(config: Record<string, unknown>, x?: number, _y?: number, row?: number): void {
    ProjectileCmd.CreateExplosion(
      this.scene,
      x ?? this.x,
      row ?? this.row,
      config as unknown as Parameters<typeof ProjectileCmd.CreateExplosion>[3],
    );
  }

  private buildPhysics() {
    const physicBodySize = PositionManager.Instance.getPlantBodySize();
    const physicsCenter = PositionManager.Instance.getPlantBodyCenterByBottom(this.x, this.y);
    const hitbox = this.scene.add.zone(physicsCenter.x, physicsCenter.y, physicBodySize.sizeX, physicBodySize.sizeY).setOrigin(0.5, 0.5);
    this.viewGroup.add(hitbox);
    // 配置 Rapier 物理描述
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic() // 或 kinematicPositionBased()
      .setTranslation(physicsCenter.x, physicsCenter.y);

    rigidBodyDesc.setUserData(this);

    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(physicBodySize.sizeX / 2, physicBodySize.sizeY / 2);
    // 【关键2】: 设为传感器 (Sensor)，这样就不会发生物理阻挡，只会触发事件
    colliderDesc.setSensor(true);
    // 【关键3】: 激活碰撞事件监听
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
  }

  // 由具体子类覆盖，或者根据 Model 决定如何构建图像
  protected abstract buildView(): void;

  protected override getRelationFields(): readonly string[] {
    return PLANT_RELATION_FIELDS;
  }

  protected override getPrngFields(): readonly string[] {
    return PLANT_PRNG_FIELDS;
  }

  /** 快照中记录 pid，供断线恢复时重建实体。 */
  protected override captureLogicState(): Record<string, JsonValue> {
    return {
      ...super.captureLogicState(),
      pid: this.model.pid,
      level: Number((this.model as unknown as Record<string, unknown>).level ?? 1),
    };
  }

  private AttachBadgeView(): void {
    if (this.scene.params?.gameSettings?.showCardLevelInGame === false) {
      return;
    }
    const textureKey = getLevelBadgeTextureKey(this.level);
    if (!this.scene.textures.exists(textureKey)) {
      return;
    }

    const bodySize = PositionManager.Instance.getPlantBodySize();
    const badgeSize = Math.min(20, bodySize.sizeX * 0.35);
    const badgeX = this.x;
    const badgeY = this.y - bodySize.sizeY * 0.25;

    const badge = this.scene.add.image(badgeX, badgeY, textureKey);
    badge.setDisplaySize(badgeSize, badgeSize);
    badge.setDepth(DepthHelper.Plant.badge(this.baseDepth));
    this.viewGroup.add(badge);
    this.levelBadge = badge;
  }

  private showSleepingSfx(): void {
    if (this.sleepingText) {
      this.sleepingText.setVisible(true);
      return;
    }

    const bodySize = PositionManager.Instance.getPlantBodySize();
    const text = this.scene.add.text(
      this.x + bodySize.sizeX * 0.15,
      this.y - bodySize.sizeY * 0.95,
      "ZZZ",
      {
        fontSize: `${Math.max(14, Math.round(bodySize.sizeY * 0.22))}px`,
        color: "#d8f4ff",
        stroke: "#24506b",
        strokeThickness: 3,
        fontStyle: "bold",
      },
    )
      .setOrigin(0.5, 0.5)
      .setDepth(DepthHelper.Plant.sfx(this.baseDepth));

    this.viewGroup.add(text);
    this.sleepingText = text;
    this.sleepingTween = this.scene.tweens.add({
      targets: text,
      x: text.x + bodySize.sizeX * 0.18,
      y: text.y - bodySize.sizeY * 0.12,
      alpha: 0.55,
      duration: 900,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private hideSleepingSfx(): void {
    if (this.sleepingTween) {
      this.sleepingTween.stop();
      this.sleepingTween.remove();
      this.sleepingTween = null;
    }

    if (this.sleepingText) {
      this.viewGroup.remove(this.sleepingText, true, true);
      this.sleepingText = null;
    }
  }

  public initializeEntity(): this {
    if (this.initialized) return this;
    this.initialized = true;

    // 稳定 key 让快照恢复后计时器组仍能对齐（重建实体得到同一 group）。
    // 同一格允许承载植物叠加（例如 lily + 普通植物），因此把创建序号也纳入 key，
    // 避免同格同 pid 的实体共享 SnapshotId / timer group。
    const existingCount = PlantsManager.Instance.PlantsMap.get(`${this.col}-${this.row}`)?.length ?? 0;
    this.adoptStableSnapshotKey(`plant:${this.col}:${this.row}:${this.model.pid}:${existingCount}`);
    // 子类字段初始化完成后，把同名逻辑字段迁入寄存器并安装访问器。

    this.buildView();
    this.AttachBadgeView();
    this.buildPhysics();

    PlantsManager.Instance.RegisterPlant(this);

    if (this.model.isNightPlant && CombatManager.Instance.combatStatus.dayOrNight === true) {
      this.setSleeping(true);
    }
    this.model.onCreate(this);
    return this;
  }

  /** 同格植物列表（仅查询，供 Model 决定护盾路由/优先级）。 */
  public getCellPlants(): PlantEntity[] {
    return [...(PlantsManager.Instance.PlantsMap.get(`${this.col}-${this.row}`) ?? [])];
  }

  public takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity) {
    // 同格护盾植物（南瓜护照）先挡伤害；路由判定在 Model。
    if (this.model.redirectDamageToShield(this, amount, dealer, source)) return;
    SoundCmd.PlayPlant('plantHit');
    super.takeDamage(amount, dealer, source);
  }

  public onHurt(amount: number, realDamage: number, dealer?: BaseEntity, source?: BaseEntity): void {
    this.model.onHurt(this, amount, realDamage, dealer, source);
  }

  public useStarShards() {
    SfxCmd.Create(StarShardsBurstSfx, {
      scene: this.scene,
      x: this.x,
      y: this.y,
      baseDepth: this.baseDepth,
    });
    this.model.onStarShards(this);
  }

  onDeath() {
    this.model.onDeath(this);
  }

  onCollision(_ctx: CollisionContext): void {
    // 植物碰到，不在植物这里处理
  }

  public updateView(vec: Vector) {
    // 计算物理引擎带来的坐标位移量 (Delta)
    const nextPosition = PositionManager.Instance.getPlantBottomCenterByBody(vec.x, vec.y);
    const dx = nextPosition.x - this.x;
    const dy = nextPosition.y - this.y;

    // 如果没有发生移动，则直接跳过，节省性能
    if (dx === 0 && dy === 0) return;

    // 更新基类当前的绝对坐标
    this.x = nextPosition.x;
    this.y = nextPosition.y;

    // 遍历所有部件，并给它们加上偏移量
    const children = this.viewGroup.getChildren();
    for (let i = 0; i < children.length; i++) {
      const part = children[i] as any;
      if (!part) continue;

      // 对于其它所有视觉部件（底座、头部等），使用增量叠加！
      // 这种做法的巨大优势是：即使此时正在被 Tween 控制向左平移（开火动画），
      // 增量也能完美保留它的相对动画，不会产生任何抽搐或坐标冲突。
      part.x += dx;
      part.y += dy;
    }

    // 如果你需要支持植物倾倒（被物理引擎砸歪），也可以在此处引入 rotation 的同步
  }

  public destroy() {
    this.currentHealth = 0;
    this.hideSleepingSfx();
    for (const attacker of [...this.underAttackBy]) {
      // 不要直接 stopAttacking：同格可能还有内部植物（例如护盾碎了露出器械），
      // 由 Model 在权威帧做一次性接触重检，决定换目标还是继续前进。
      // 这里用鸭子类型而不是 instanceof：信号链路不能依赖具体子类，
      // 也不该因为模块身份/重建实例差异而静默丢事件。
      const listener = attacker as unknown as {
        onAttackTargetDestroyed?: (target: PlantEntity) => void;
      };
      listener.onAttackTargetDestroyed?.(this);
    }
    this.underAttackBy.clear();
    this.model.onDeath(this);
    // 清理所有绑定的事件和定时器

    // 通知Manager移除自己
    PlantsManager.Instance.RegisterDestroy(this);
    super.destroy(); // 调用父类的destroy，清理实体
  }

  /** 回滚对账：不执行 Model 死亡、掉落或攻击者状态修改。 */
  protected override onSilentDestroy(): void {
    this.hideSleepingSfx();
    PlantsManager.Instance.RegisterDestroy(this);
  }

  /** 快照中的 x/y 是刚体中心；视图与逻辑坐标必须转换回 bottom-center。 */
  protected override applySnapshotPosition(x: number, y: number): void {
    const bottom = PositionManager.Instance.getPlantBottomCenterByBody(x, y);
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

  public setSleeping(value: boolean): void {
    if (this.isSleeping === value) return;

    this.isSleeping = value;
    if (value) {
      this.showSleepingSfx();
    } else {
      this.hideSleepingSfx();
    }

    this.model.onSleepStateChange(this, value);
  }
}
