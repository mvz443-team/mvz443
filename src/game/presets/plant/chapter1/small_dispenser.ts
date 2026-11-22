import DepthHelper from "../../../utils/helper/DepthHelper";
import ProjectileDamage from "../../../../constants/damage";
import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import createShootBurstAnim from "../../../sprite/shoot_anim";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { SightLineEntity } from "../../../models/entities/SightLineEntity";
import { SnowBallModel, BombSnowBallModel } from "../../bullet/snowball";
import { registerProjectileModel } from "../../../utils/cmd/ProjectileModelRegistry";

export class FireBallModel extends BombSnowBallModel {
  public static override readonly projectileKind: string = "fireball";
  public override texture = 'bullet/fireball';
}

registerProjectileModel(FireBallModel.projectileKind, FireBallModel);

export class SmallDispenserModel extends PlantModel {
  public override pid = 5;
  public override nameKey = 'name_small_dispenser';
  public override descriptionKey = 'small_dispenser_description';
  public override texturePath = 'plant/small_dispenser';

  public maxHealth = new LevelScaledValue(300);
  public cost = new LevelScaledValue(0);

  public cooldown = new LevelScaledValue(10000);
  public cooldownStartAtRatio = 0;

  public damage = new LevelScaledValue(ProjectileDamage.bullet.snowBall).setIncRatio(1.3);
  public isNightPlant = true;

  LevelThresholds1 = 3; // 增加攻击距离的等级阈值
  LevelThresholds2 = 7;

  constructor() {
    super();
    // 低矮植物：只有带 tiny 的投射物能命中。
    this.tiny = true;
  }

  public override createEntity(scene: Game, col: number, row: number, level: number): SmallDispenserEntity {
    return this.initializeEntity(new SmallDispenserEntity(scene, col, row, level));
  }

  public override onCreate(entity: SmallDispenserEntity): void {
    // 精英2, 白天不睡觉
    if (entity.level >= this.LevelThresholds2) {
      PlantCmd.SetSleeping(entity, false);
    }

    let maxDistanceGrid = 3.6;
    if (entity.level >= this.LevelThresholds1) {
      maxDistanceGrid = 5.6;
    }
    const sightLine = new SightLineEntity(entity.scene, {
      owner: entity,
      row: () => entity.GetRow(),
      direction: 1,
      maxDistance: maxDistanceGrid * PositionManager.Instance.GRID_SIZEX,
      excludeSelf: true,
      // 雪球能打到潜水僵尸的非攻击态（tiny），判定线必须同样覆盖低矮层。
      reach: { tiny: true },
    });

    entity.model.tickmanager.addEvent({
      startAt: 500,
      delay: 1000,
      loop: true,
      callback: () => {
        if (entity.isSleeping || entity.currentHealth <= 0) return;

        if (sightLine.hasTarget()) {
          entity.playShootAnimation();

          ProjectileCmd.Create(SnowBallModel, entity.scene, entity.x, entity.row, {
            damage: this.damage.getValueAt(entity.level),
            maxDistance: maxDistanceGrid * PositionManager.Instance.GRID_SIZEX,
            faction: entity.faction,
            dealer: entity,
            tiny: true
          });
        }
      }
    });
  }

  public override onStarShards(entity: SmallDispenserEntity): void {
    if (entity.isSleeping) {
      PlantCmd.SetSleeping(entity, false);
    }

    const dmg = new LevelScaledValue(ProjectileDamage.bullet.bomb_fireBall).setIncRatio(1.2).getValueAt(entity.level);

    ProjectileCmd.Create(FireBallModel, entity.scene, entity.x, entity.row, {
      damage: dmg,
      maxDistance: PositionManager.Instance.GRID_SIZEY * 12,
      faction: entity.faction,
      dealer: entity
    });
  }
}

export const SmallDispenserData = new SmallDispenserModel();

export class SmallDispenserEntity extends PlantEntity {
  private declare mainSprite: Phaser.GameObjects.Sprite;

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, SmallDispenserData, level);
  }

  protected override buildView() {
    const size = PositionManager.Instance.getPlantDisplaySize();

    this.mainSprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);

    this.viewGroup.add(this.mainSprite);
  }

  public playShootAnimation() {
    if (this.currentHealth <= 0) return;

    // original logic uses width*1/3, height/7
    const width = this.mainSprite.displayWidth;
    const height = this.mainSprite.displayHeight;

    createShootBurstAnim(
      this.scene,
      this.x + width * (1 / 3),
      this.y - height / 7,
      16,
      DepthHelper.Plant.sfx(this.baseDepth)
    );
  }
}
