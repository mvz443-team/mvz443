import { addHandAttachment, PresetMonsterModel, StagedBodyMonsterEntity } from "../../../models/entities/MonsterEntity";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";


export class BaseVindicatorEntity extends StagedBodyMonsterEntity {
  protected damageThresholds = [180];
  protected attackTween: Phaser.Tweens.Tween | null = null;
  protected weaponKey = "attach/hd_axe";

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
    addHandAttachment(this, this.weaponKey);
  }

  protected createAnimController() {
    return createZombieAnimController("vindicator", this.scene, this.x, this.y);
  }

  public override startAttacking(target: any) {
    if (!this.attackTween) {
      const sprite = this.attachSprites.get(this.weaponKey);
      if (sprite) {
        this.attackTween = this.scene.tweens.add({
          targets: sprite,
          angle: -15,
          duration: 200,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }
    }
    super.startAttacking(target);
  }

  public override stopAttacking() {
    this.attackTween?.stop();
    this.attackTween = null;
    this.attachSprites.get(this.weaponKey)?.setAngle(0);
    super.stopAttacking();
  }
}

export class VindicatorEntity extends BaseVindicatorEntity { }

export const VindicatorData = new PresetMonsterModel({
  mid: 10,
  nameKey: "Vindicator",
  level: 9999,
  weight: () => 0,
  leastWaveID: 9999,
  maxHealth: 360,
  baseSpeed: MonsterSpeed.Vindicator,
  attackDamage: 32,
  attackInterval: ZombieAttackInterval.Vindicator,
  createEntity: (scene, col, row, model, waveID) => new VindicatorEntity(scene, col, row, model, waveID),
});
