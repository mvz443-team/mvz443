import DepthHelper from "../../../utils/helper/DepthHelper";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { IMonsterAnimController } from "../../../models/monster/anims/IMonsterAnimController";
import type { Game } from "../../../scenes/Game";

type DeprecatedSkillPose = "mine" | "charge" | "summon" | "blast";

/**
 * @deprecated 全仓库无引用，仅作为旧版蜈蚣动画的历史参考保留。
 * 现行动画请使用 `centipede_anim.ts` 的 `CentipedeAnimController`。
 * 新代码禁止 import 本文件。
 */
export class CentipedeDeprecatedAnimController implements IMonsterAnimController {
  public isInAnim = false;

  private container: Phaser.GameObjects.Container;
  private parts: Phaser.GameObjects.Image[] = [];
  private body: Phaser.GameObjects.Sprite;
  private legs: Phaser.GameObjects.Image[] = [];
  private sickle: Phaser.GameObjects.Image;
  private legSwingTween: Phaser.Tweens.Tween | null = null;
  private armSwingTween: Phaser.Tweens.Tween | null = null;
  private highlightTimer: Phaser.Time.TimerEvent | null = null;

  public constructor(private scene: Game, x: number, y: number) {
    const scale = PositionManager.Instance.scaleFactor * 1.55;
    this.container = scene.add.container(x, y);
    this.container.setScale(scale);

    this.addSegment(115, -30, 3);
    this.addSegment(78, -36, 4);
    this.addSegment(40, -31, 5);
    this.addSegment(4, -39, 6);

    this.body = scene.add.sprite(-38, -48, "sprCentipedeDeprecatedBody", 0).setOrigin(0.5);
    this.container.add(this.body);

    const head = this.addImage("sprCentipedeDeprecatedHead", -82, -76, 9);
    head.setAngle(-8);

    const leftArm = this.addImage("sprCentipedeDeprecatedArm", -62, -58, 8);
    leftArm.setAngle(28);
    const rightArm = this.addImage("sprCentipedeDeprecatedArm", -38, -36, 7);
    rightArm.setAngle(-18);

    this.sickle = this.addImage("sprCentipedeDeprecatedSickle", -105, -88, 10);
    this.sickle.setAngle(22);

    for (const [x0, y0, angle] of [[-42, -12, -12], [-18, -10, 12], [20, -9, -16], [58, -12, 14], [95, -8, -10]] as const) {
      const leg = this.addImage("sprCentipedeDeprecatedLeg", x0, y0, 1);
      leg.setOrigin(0.5, 0);
      leg.setAngle(angle);
      this.legs.push(leg);
    }
  }

  private addImage(texture: string, x: number, y: number, depth: number): Phaser.GameObjects.Image {
    const image = this.scene.add.image(x, y, texture).setOrigin(0.5);
    image.setData("localDepth", depth);
    this.container.add(image);
    this.parts.push(image);
    return image;
  }

  private addSegment(x: number, y: number, depth: number): void {
    const segment = this.addImage("sprCentipedeDeprecatedSegment", x, y, depth);
    const joint = this.addImage("sprCentipedeDeprecatedJoint", x - 23, y + 3, DepthHelper.Mob.deprecatedCentipedeJoint(depth));
    joint.setScale(0.85);
    if (x > 80) segment.setAngle(4);
    if (x < 20) segment.setAngle(-4);
  }

  public updatePosition(x: number, y: number): void {
    this.container.setPosition(x, y - PositionManager.Instance.GRID_SIZEY * 0.08);
  }

  public setDepth(depth: number): void {
    this.container.setDepth(depth);
    for (const child of this.container.list) {
      const gameObject = child as Phaser.GameObjects.GameObject & Partial<Phaser.GameObjects.Components.Depth>;
      const localDepth = gameObject.getData?.("localDepth") ?? 0;
      gameObject.setDepth?.(DepthHelper.Mob.deprecatedCentipedeChild(depth, localDepth));
    }
  }

  public highlight(): void {
    if (this.highlightTimer) return;
    this.setTint(0xffffff);
    this.highlightTimer = this.scene.time.delayedCall(80, () => {
      this.clearTint();
      this.highlightTimer = null;
    });
  }

  public startLegSwing(): void {
    if (this.legSwingTween) return;
    this.legSwingTween = this.scene.tweens.add({
      targets: this.legs,
      angle: "+=18",
      duration: 160,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public stopLegSwing(): void {
    this.legSwingTween?.stop();
    this.legSwingTween = null;
    this.legs.forEach((leg, index) => leg.setAngle(index % 2 === 0 ? -12 : 12));
  }

  public startArmSwing(): void {
    if (this.armSwingTween) return;
    this.armSwingTween = this.scene.tweens.add({
      targets: this.sickle,
      angle: { from: 14, to: 34 },
      scaleX: { from: 1, to: 1.08 },
      scaleY: { from: 1, to: 1.08 },
      duration: 220,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public stopArmSwing(): void {
    this.armSwingTween?.stop();
    this.armSwingTween = null;
    this.sickle.setAngle(22).setScale(1);
  }

  public playSkillPose(skill: DeprecatedSkillPose): void {
    this.startArmSwing();
    this.body.setFrame(skill === "blast" ? 1 : 0);
    this.scene.tweens.add({
      targets: this.container,
      scaleX: this.container.scaleX * (skill === "charge" ? 1.12 : 1.05),
      scaleY: this.container.scaleY * 0.96,
      duration: 120,
      yoyo: true,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.stopArmSwing();
        this.body.setFrame(0);
      },
    });
  }

  public setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  public destroy(): void {
    this.legSwingTween?.stop();
    this.armSwingTween?.stop();
    this.highlightTimer?.remove(false);
    this.container.destroy(true);
  }

  private setTint(color: number): void {
    this.parts.forEach((part) => part.setTint(color));
    this.body.setTint(color);
  }

  private clearTint(): void {
    this.parts.forEach((part) => part.clearTint());
    this.body.clearTint();
  }
}
