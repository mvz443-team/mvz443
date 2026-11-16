
import DepthHelper from "../../utils/helper/DepthHelper";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { CombatEntity } from "../core/CombatEntity";
import { ProjectileEntity } from "../entities/ProjectileEntity";
import { LaserConfig, LaserModel } from "./ProjectileModels";
import SoundCmd from "../../utils/cmd/SoundCmd";

export class LaserEntity extends ProjectileEntity<LaserModel> {
  public baseDepth: number;

  constructor(scene: Game, x1: number, y1: number, x2: number, y2: number, model: LaserModel,
    row: number, cfg: LaserConfig) {
    // 计算中点作为中心
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;

    super(scene, centerX, centerY, model, cfg);
    this.currentDamage = cfg.damage;

    const distance = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2);
    const hitHeight = PositionManager.Instance.GRID_SIZEY * 0.6;
    const visualHeight = PositionManager.Instance.GRID_SIZEY * 0.2;
    const color = cfg.color ?? model.color;
    const alphaFrom = cfg.alphaFrom ?? model.alphaFrom;
    const alphaTo = cfg.alphaTo ?? model.alphaTo;

    this.baseDepth = DepthHelper.Projectile.laser(row);

    const glow = scene.add.rectangle(centerX, centerY, distance, visualHeight * 3.2, color, alphaFrom * 0.22)
      .setRotation(angle)
      .setDepth(this.baseDepth - 1);
    const beam = scene.add.rectangle(centerX, centerY, distance, visualHeight * 1.45, color, alphaFrom * 0.68)
      .setRotation(angle)
      .setDepth(this.baseDepth);
    const core = scene.add.rectangle(centerX, centerY, distance, Math.max(2, visualHeight * 0.36), 0xffffff, alphaFrom * 0.58)
      .setRotation(angle)
      .setDepth(this.baseDepth + 1);

    this.viewGroup.addMultiple([glow, beam, core]);

    // 创建旋转的物理碰撞 Sensor
    this.createSensor(distance, hitHeight, angle);

    // 处理视觉与生命周期
    if (cfg.invisible) {
      glow.setAlpha(0);
      beam.setAlpha(0);
      core.setAlpha(0);
      this.tickmanager.delayedCall({
        delay: Math.max(1, cfg.duration),
        callback: () => this.destroy(),
      });
    } else {
      SoundCmd.PlayShootLaser();
      scene.tweens.add({
        targets: [glow, beam, core],
        alpha: alphaTo,
        duration: cfg.duration,
        onComplete: () => this.destroy()
      });
      this.tickmanager.delayedCall({
        delay: cfg.duration + 80,
        callback: () => this.destroy(),
      });
    }
  }

  buildView() { }

}
