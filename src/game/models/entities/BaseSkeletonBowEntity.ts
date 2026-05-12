import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import { ProjectileCmd } from "../../utils/cmd/ProjectileCmd";
import { ArrowData } from "../../presets/bullet/arrow";
import { Faction } from "../Enum";
import type { Game } from "../../scenes/Game";
import { addHandAttachment, PresetMonsterModel } from "./MonsterEntity";
import { BaseSkeletonEntity } from "../../presets/monster/zombie/skeleton";
import { PositionManager } from "../../managers/view/PositionManager";
import { SightLineEntity } from "./SightLineEntity";

export class BaseSkeletonBowEntity extends BaseSkeletonEntity {
  protected arrowDamage = 70;
  protected arrowInterval = 3500;

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
    addHandAttachment(this, "attach/hd_bow");
    const sightLine = new SightLineEntity(scene, {
      owner: this,
      row: () => this.GetRow(),
      direction: -1,
      maxDistance: PositionManager.Instance.GRID_SIZEX * 32,
      excludeFactions: [this.faction],
      includeTiny: false,
      includeFlying: false,
      ignoreBounce: true,
    });

    this.tickmanager.addEvent({
      delay: this.arrowInterval,
      repeat: -1,
      callback: () => {
        if (this.isFrozen || this.attacking || this.currentHealth <= 0) return;
        if (!sightLine.hasTarget()) return;
        this.stopMove();
        if (this.currentHealth <= 0 || !this.scene) return;
        ProjectileCmd.Create(ArrowData, this.scene, this.x, this.row, {
          damage: this.arrowDamage,
          faction: Faction.ZOMBIE,
          speed: -legacyRapierVelocityToUnitsPerSecond(320),
        });
        this.scene.time.delayedCall(350, () => {
          if (this.currentHealth > 0 && !this.attacking) {
            this.startMove();
          }
        });
      }
    });
  }
}
