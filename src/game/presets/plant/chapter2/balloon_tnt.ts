import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import MobManager from "../../../managers/combat/MobManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { readBodyLayers } from "../../../core/logic/BodyTraits";
import type { ModelHost } from "../../../core/logic/LogicModel";
import type { JsonValue } from "../../../core/SimulationState";
import { Faction } from "../../../models/Enum";
import MobCmd from "../../../utils/cmd/MobCmd";
import DepthHelper from "../../../utils/helper/DepthHelper";
import { BALLOON_TNT_CLONE_MID } from "../../monster/summon/balloon_tnt_clone";

/** 气球TNT 的充气阶段事件；参数保持 JSON 安全。 */
const BALLOON_TNT_EVENTS = {
  Half: "BalloonTntHalf",
  Full: "BalloonTntFull",
} as const;

export const BALLOON_TNT_STAGE = {
  Deflated: 0,
  Half: 1,
  Airborne: 2,
} as const;

/**
 * 气球TNT - 第二章低矮器械。
 *
 * - 450 血、125 能量、14 秒冷却，种植后不会响应任何碰撞。
 * - 充气分三档：0 瘪气 → 1 半鼓（充气时间一半）→ 2 充满并垂直升空（非低矮）。
 *   6 秒充满，Lv5 起缩短为 3 秒。
 * - 升空后只被**飞行**怪物引爆（地面僵尸可以从下方经过，也可以把它啃掉）。
 * - 爆炸为 3x3，伤害 350（Lv9 400）。
 *
 * 星之碎片：本体立即充满，并生成一个向右飞行的气球TNT分身（见 `balloon_tnt_clone`）。
 */
export class BalloonTntModel extends PlantModel {
  public override pid = 20;
  public override nameKey = 'name_balloon_tnt';
  public override descriptionKey = 'balloon_tnt_description';
  public override texturePath = 'plant/balloon_tnt';

  public maxHealth = new LevelScaledValue(450);
  public cost = new LevelScaledValue(125);
  public cooldown = new LevelScaledValue(14000);
  public cooldownStartAtRatio = 1;
  public damage = new LevelScaledValue(350).setThreshold(9, 400);
  public isNightPlant = false;

  /** 充气阶段：0 瘪气 / 1 半鼓 / 2 充满升空。进快照。 */
  public inflateStage: number = BALLOON_TNT_STAGE.Deflated;

  public constructor() {
    super();
    // 充气完成前是低矮器械（地面子弹打不到）；充满后置回 false。
    this.tiny = true;
  }

  /** 充气时长：6 秒，Lv5 起 3 秒。 */
  public getInflateDuration(level: number): number {
    return level >= 5 ? 3000 : 6000;
  }

  public override onCreate(entity: BalloonTntEntity): void {
    const duration = this.getInflateDuration(entity.level);
    this.tickmanager.schedule(BALLOON_TNT_EVENTS.Half, Math.floor(duration / 2));
    this.tickmanager.schedule(BALLOON_TNT_EVENTS.Full, duration);
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === BALLOON_TNT_EVENTS.Half) {
      if (this.inflateStage < BALLOON_TNT_STAGE.Half) this.applyStage(BALLOON_TNT_STAGE.Half);
      return;
    }
    if (eventName === BALLOON_TNT_EVENTS.Full) {
      this.completeInflation();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  /** 星之碎片：立即充满 + 生成一个向右飞行的分身。 */
  public override onStarShards(entity: BalloonTntEntity): void {
    if (entity.currentHealth <= 0) return;

    this.completeInflation();

    const damage = this.damage.getValueAt(entity.level);
    MobCmd.Spawn(BALLOON_TNT_CLONE_MID, entity.scene, entity.col, entity.row, -10, (mob) => {
      (mob.model as unknown as { explosionDamage: number }).explosionDamage = damage;
    });
  }

  /** 充满：解除低矮、进入可引爆状态。 */
  public completeInflation(): void {
    this.applyStage(BALLOON_TNT_STAGE.Airborne);
  }

  private applyStage(stage: number): void {
    if (this.inflateStage === stage) return;
    this.inflateStage = stage;
    this.tiny = stage !== BALLOON_TNT_STAGE.Airborne;
    (this.host as BalloonTntEntity | null)?.syncInflateView();
  }

  /** 升空后固定逻辑帧轮询：只被飞行怪物引爆。 */
  public override onModelStep(host: ModelHost): void {
    const entity = host as BalloonTntEntity;
    if (this.hasExploded) return;
    if (this.inflateStage !== BALLOON_TNT_STAGE.Airborne) return;
    if (entity.currentHealth <= 0) return;

    const mobs = MobManager.Instance.MobsByLane.get(entity.row) ?? [];
    for (const mob of mobs) {
      const target = mob as unknown as PlantEntity;
      if (target.currentHealth <= 0) continue;
      if (target.faction !== Faction.ZOMBIE) continue;
      if (!readBodyLayers(target).flying) continue;
      if (Math.abs(target.x - entity.x) > PositionManager.Instance.GRID_SIZEX * 0.5) continue;

      this.explode(entity, target);
      return;
    }
  }

  public createEntity(scene: Game, col: number, row: number, level: number): BalloonTntEntity {
    return this.initializeEntity(new BalloonTntEntity(scene, col, row, level));
  }

  /** 3x3 爆炸；一次性，由 `hasExploded` 防重复。 */
  public explode(entity: BalloonTntEntity, _target?: unknown): void {
    if (this.hasExploded) return;
    this.hasExploded = true;

    entity.createExplosion({
      damage: this.damage.getValueAt(entity.level),
      leftGrid: 1.5,
      rightGrid: 1.5,
      upGrid: 1,
      downGrid: 1,
      faction: Faction.PLANT,
      dealer: entity,
    }, entity.x, undefined, entity.row);

    entity.destroySelf();
  }
}

export class BalloonTntEntity extends PlantEntity {
  /** 充气阶段定义在 Model，Entity 只负责切帧与升空偏移。 */
  declare public inflateStage: number;
  declare public tiny: boolean;

  public constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, BalloonTntData, level);
    this.syncInflateView();
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    this.syncInflateView();
  }

  protected buildView(): void {
    const size = PositionManager.Instance.getPlantDisplaySize();

    const sprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);

    this.viewGroup.add(sprite);
  }

  /**
   * 三档充气外观：帧 0 瘪气贴地、帧 1 半鼓、帧 2 充满并整体上抬一格。
   * 上抬只改渲染偏移，不改逻辑坐标与碰撞体。
   */
  public syncInflateView(): void {
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite | undefined;
    if (!sprite) return;

    const stage = (this.model as BalloonTntModel).inflateStage;
    sprite.setFrame(stage);
    const lift = stage === BALLOON_TNT_STAGE.Airborne
      ? PositionManager.Instance.GRID_SIZEY * 0.55
      : 0;
    sprite.setY(this.y - lift);
  }
}

export const BalloonTntData = new BalloonTntModel();
