import { BulletEntity } from "../../models/projectiles/BulletEntity";
import { BulletConfig, BulletModel } from "../../models/projectiles/ProjectileModels";
import type { Game } from "../../scenes/Game";
import SoundCmd from "../../utils/cmd/SoundCmd";
import ProjectileDamage from "../../../constants/damage";
import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import type { ModelHost } from "../../core/logic/LogicModel";

export class SnowBallModel extends BulletModel<BulletConfig, SnowBallEntity> {
  texture = 'bullet/snowball';

  public override speed: number = legacyRapierVelocityToUnitsPerSecond(700);

  public createEntity(scene: Game, x: number, row: number, config: BulletConfig): SnowBallEntity {
    return new SnowBallEntity(scene, x, row, this, config);
  }
}

export class SnowBallEntity extends BulletEntity {
  constructor(scene: Game, x: number, row: number, model: SnowBallModel, cfg: BulletConfig) {
    super(scene, x, row, model, cfg);
    SoundCmd.PlayShootArrow();
  }
}

/** 炸弹雪球的爆炸逻辑完全属于 Model；Entity 不持有任何战斗逻辑。 */
export class BombSnowBallModel extends BulletModel<BulletConfig, BombSnowBallEntity> {
  texture = 'bullet/snowball';

  /** 爆炸伤害直接定义在 Model 上，自动进入快照。 */
  public explodeDamage: number = ProjectileDamage.bullet.bomb_fireBall_splash;

  public override onModelDestroy(host: ModelHost): void {
    if (this.explodeDamage <= 0) return;
    host.createExplosion({
      damage: this.explodeDamage,
      rightGrid: 1.75,
      leftGrid: 1.5,
      upGrid: 1,
      faction: host.faction,
      dealer: host.dealer ?? null,
    });
  }

  public createEntity(scene: Game, x: number, row: number, config: BulletConfig): BombSnowBallEntity {
    return new BombSnowBallEntity(scene, x, row, this, config);
  }
}

export const BombSnowBallData = new BombSnowBallModel();

export class BombSnowBallEntity extends SnowBallEntity { }
