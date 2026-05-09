import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import { BaseEntity } from "../../../models/core/BaseEntity";
import DepthHelper from "../../../utils/helper/DepthHelper";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { BaseVindicatorEntity } from "./vindicator";
import { BulletEntity } from "../../../models/projectiles/BulletEntity";
import SoundCmd from "../../../utils/cmd/SoundCmd";


export class ShieldVindicatorEntity extends BaseVindicatorEntity {
  private shieldHealth = 1000;

  // Zombie sprites are not flipped by velocity (see src/game/sprite/zombie.ts),
  // so facing is a constant -X for all zombies regardless of how they're moving.
  private readonly facingX: -1 | 1 = -1;

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
    const shield = this.scene.add.sprite(
      this.x + this.offsetX - PositionManager.Instance.GRID_SIZEX * 0.42,
      this.y - PositionManager.Instance.GRID_SIZEY * 0.7 + this.offsetY,
      "attach/hd_shield",
    );
    shield.setScale(PositionManager.Instance.scaleFactor * 2.2).setOrigin(0.5, 0.35).setFrame(0).setDepth(DepthHelper.Mob.attachment(this.baseDepth, "shield"));
    this.attachSprites.set("shield", shield);
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (this.shieldHealth > 0 && this.shouldShieldBlock(source)) {
      const blocked = amount * 0.5;
      if (this.shieldHealth > blocked) {
        this.shieldHealth -= blocked;
        this.attachSprites.get("shield")?.setFrame(this.shieldHealth > 500 ? 0 : 1);
        SoundCmd.PlayShieldHit("ironHit");
        this.animController.highlight();
        return;
      }
      this.shieldHealth = 0;
      this.attachSprites.get("shield")?.setVisible(false);
    }
    super.takeDamage(amount, dealer, source);
  }

  private shouldShieldBlock(source?: BaseEntity): boolean {
    if (!(source instanceof BulletEntity)) return false;
    const bulletVx = source.rigidBody?.linvel().x ?? 0;
    // Bullet must be travelling opposite the zombie's facing — i.e. heading
    // into the shield from the front. Same-sign velocity means the bullet
    // is overtaking from behind, so the shield does not engage.
    return bulletVx * this.facingX < 0;
  }
}

export const VindicatorSoliderData = new PresetMonsterModel({
  mid: 11,
  nameKey: "VindicatorSolider",
  level: 4,
  weight: () => 3500,
  leastWaveID: 14,
  maxHealth: 360,
  baseSpeed: MonsterSpeed.VindicatorSolider,
  attackDamage: 32,
  attackInterval: ZombieAttackInterval.VindicatorSolider,
  createEntity: (scene, col, row, model, waveID) => new ShieldVindicatorEntity(scene, col, row, model, waveID),
});
