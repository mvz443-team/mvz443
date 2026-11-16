import DepthHelper from "../../utils/helper/DepthHelper";
import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import { PositionManager } from "../../managers/view/PositionManager";
import { BulletEntity } from "../../models/projectiles/BulletEntity";
import { BulletConfig, BulletModel } from "../../models/projectiles/ProjectileModels";
import type { Game } from "../../scenes/Game";
import SoundCmd from "../../utils/cmd/SoundCmd";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import { RocketSmokeSfx } from "../../sfx/trail/RocketSmokeSfx";
import type { ModelHost } from "../../core/logic/LogicModel";

export interface HFireWorkConfig extends BulletConfig {
  explodeDamage?: number;
}

/** 爆炸伤害与爆炸效果都由 Model 定义。 */
export class HFireWorkModel extends BulletModel<HFireWorkConfig, HFireWorkEntity> {
  texture = 'bullet/Hfirework';
  public override speed = legacyRapierVelocityToUnitsPerSecond(500);
  public explodeDamage: number = 0;

  public override onModelDestroy(host: ModelHost): void {
    if (this.explodeDamage <= 0) return;
    host.createExplosion({
      damage: this.explodeDamage,
      rightGrid: 0.5,
      leftGrid: 0.25,
      upGrid: 0,
      faction: host.faction,
      dealer: host.dealer ?? null,
    });
  }

  public createEntity(scene: Game, x: number, row: number, config: HFireWorkConfig): HFireWorkEntity {
    return new HFireWorkEntity(scene, x, row, this, config);
  }
}

export class HFireWorkEntity extends BulletEntity {
  public declare model: HFireWorkModel;
  /** 纯表现：烟雾节流计时器不参与回滚。 */
  private smokeTimer: number = 0;

  constructor(scene: Game, x: number, row: number, model: HFireWorkModel, cfg: HFireWorkConfig) {
    super(scene, x, row, model, cfg);
    this.model.explodeDamage = cfg.explodeDamage ?? 0;

    const size = PositionManager.Instance.getBulletDisplaySize();
    this.sprite.setDisplaySize(size.sizeX * 2, size.sizeY / 2);
    SoundCmd.PlayShootFirework();
  }

  stepUpdate(): void {
    super.stepUpdate();

    this.smokeTimer++;
    if (this.smokeTimer < 5) return;
    this.smokeTimer = 0;

    if (this.rigidBody) {
      const vel = this.rigidBody.linvel();
      const angle = Math.atan2(vel.y, vel.x);
      const offsetX = -Math.cos(angle) * this.sprite.displayWidth * 0.5;
      const offsetY = -Math.sin(angle) * this.sprite.displayHeight * 0.5;

      SfxCmd.Create(RocketSmokeSfx, {
        scene: this.scene,
        x: this.x + offsetX,
        y: this.y + offsetY,
        size: this.sprite.displayHeight * 2,
        depth: DepthHelper.Projectile.trail(this.baseDepth),
      });
    }
  }
}
