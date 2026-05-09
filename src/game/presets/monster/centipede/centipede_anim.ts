import DepthHelper from "../../../utils/helper/DepthHelper";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { Game } from "../../../scenes/Game";
import type { IMonsterAnimController } from "../../../models/monster/anims/IMonsterAnimController";

type SkillPose = "mine" | "charge" | "summon" | "blast";

const CHARACTER_LOCAL_Y = -82;

export class CentipedeAnimController implements IMonsterAnimController {
  public isInAnim = false;

  private container: Phaser.GameObjects.Container;
  private character: Phaser.GameObjects.Sprite;
  private aura: Phaser.GameObjects.Image;
  private idleTween: Phaser.Tweens.Tween | null = null;
  private castTween: Phaser.Tweens.Tween | null = null;
  private highlightTimer: Phaser.Time.TimerEvent | null = null;
  private readonly baseScale: number;

  public constructor(private scene: Game, x: number, y: number) {
    this.baseScale = PositionManager.Instance.scaleFactor * 0.98;
    this.container = scene.add.container(x, y);
    this.container.setScale(this.baseScale);

    this.aura = scene.add.image(0, -68, "sfxCentipedeSummonRing")
      .setOrigin(0.5)
      .setAlpha(0.22)
      .setScale(1.65, 1.3);
    this.character = scene.add.sprite(0, -82, "sprCentipedeCharacter", 0).setOrigin(0.5, 0.88);
    this.container.add([this.aura, this.character]);
  }

  public updatePosition(x: number, y: number): void {
    this.container.setPosition(x, y + PositionManager.Instance.GRID_SIZEY * 0.54);
  }

  public setDepth(depth: number): void {
    this.container.setDepth(depth);
    this.aura.setDepth(DepthHelper.Mob.centipedePart(depth, "aura"));
    this.character.setDepth(DepthHelper.Mob.centipedePart(depth, "character"));
  }

  public highlight(): void {
    if (this.highlightTimer) return;
    this.character.setTint(0xffffff);
    this.highlightTimer = this.scene.time.delayedCall(80, () => {
      this.character.clearTint();
      this.highlightTimer = null;
    });
  }

  public startLegSwing(): void {
    if (this.idleTween) return;
    this.idleTween = this.scene.tweens.add({
      targets: this.character,
      y: this.character.y - 5,
      angle: { from: -1.5, to: 1.5 },
      duration: 280,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public stopLegSwing(): void {
    this.idleTween?.stop();
    this.idleTween = null;
    this.character.setPosition(0, CHARACTER_LOCAL_Y).setAngle(0);
  }

  public startArmSwing(): void {
    if (this.castTween) return;
    this.castTween = this.scene.tweens.add({
      targets: this.character,
      angle: { from: -4, to: 4 },
      scaleX: { from: 1, to: 1.08 },
      scaleY: { from: 1, to: 1.08 },
      duration: 220,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public stopArmSwing(): void {
    this.castTween?.stop();
    this.castTween = null;
    this.character.setAngle(0).setScale(1);
  }

  public playSkillPose(skill: SkillPose): void {
    this.stopArmSwing();
    this.character.setFrame(skill === "blast" ? 1 : 0);
    const scaleX = skill === "charge" ? this.baseScale * 1.16 : this.baseScale * 1.06;
    this.scene.tweens.add({
      targets: this.container,
      scaleX,
      scaleY: this.baseScale * 0.96,
      duration: 130,
      yoyo: true,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.container.setScale(this.baseScale);
        this.character.setFrame(0);
      },
    });
    this.scene.tweens.add({
      targets: this.aura,
      alpha: { from: 0.22, to: 0.5 },
      angle: skill === "blast" ? 35 : 18,
      duration: 180,
      yoyo: true,
      ease: "Sine.easeOut",
    });
  }

  public setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  public startArc(
    from: { x: number; y: number },
    to: { x: number; y: number },
    duration: number,
    arcHeight: number,
    onUpdate?: (x: number, y: number) => void,
    onComplete?: () => void,
  ): void {
    this.isInAnim = true;
    this.setVisible(true);

    const state = { t: 0 };
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        const t = state.t;
        const x = Phaser.Math.Linear(from.x, to.x, t);
        const y = Phaser.Math.Linear(from.y, to.y, t) - Math.sin(Math.PI * t) * arcHeight;
        this.updatePosition(x, y);
        onUpdate?.(x, y);
      },
      onComplete: () => {
        this.updatePosition(to.x, to.y);
        this.isInAnim = false;
        onComplete?.();
      },
    });
  }

  public destroy(): void {
    this.idleTween?.stop();
    this.castTween?.stop();
    this.highlightTimer?.remove(false);
    this.container.destroy(true);
  }
}

export class CentipedeMinionAnimController implements IMonsterAnimController {
  public isInAnim = false;

  private container: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Graphics;
  private orb: Phaser.GameObjects.Image;
  private pulseTween: Phaser.Tweens.Tween | null = null;
  private highlightTimer: Phaser.Time.TimerEvent | null = null;

  public constructor(private scene: Game, x: number, y: number) {
    this.container = scene.add.container(x, y);
    this.body = scene.add.graphics();
    this.orb = scene.add.image(-48, -24, "sfxCentipedeMinionOrb").setOrigin(0.5);
    this.container.add([this.body, this.orb]);
    this.container.setScale(PositionManager.Instance.scaleFactor * 1.35);
    this.redrawBody();
  }

  private redrawBody(): void {
    this.body.clear();
    this.drawCurve(9, 0x050505);
    this.drawCurve(7, 0xd6b900);
    this.drawCurve(4, 0xffec9a);
  }

  private drawCurve(width: number, color: number): void {
    this.body.lineStyle(width, color, 1);
    this.body.beginPath();
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const x = (1 - t) * (1 - t) * -36 + 2 * (1 - t) * t * 0 + t * t * 42;
      const y = (1 - t) * (1 - t) * -24 + 2 * (1 - t) * t * -48 + t * t * -22;
      if (i === 0) this.body.moveTo(x, y);
      else this.body.lineTo(x, y);
    }
    this.body.strokePath();
  }

  public updatePosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  public setDepth(depth: number): void {
    this.container.setDepth(depth);
    this.body.setDepth(DepthHelper.Mob.centipedePart(depth, "body"));
    this.orb.setDepth(DepthHelper.Mob.centipedePart(depth, "orb"));
  }

  public highlight(): void {
    if (this.highlightTimer) return;
    this.orb.setTint(0xffffff);
    this.body.setAlpha(0.7);
    this.highlightTimer = this.scene.time.delayedCall(80, () => {
      this.orb.clearTint();
      this.body.setAlpha(1);
      this.highlightTimer = null;
    });
  }

  public startLegSwing(): void {
    if (this.pulseTween) return;
    this.pulseTween = this.scene.tweens.add({
      targets: this.orb,
      scale: { from: 0.9, to: 1.15 },
      duration: 260,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public stopLegSwing(): void {
    this.pulseTween?.stop();
    this.pulseTween = null;
    this.orb.setScale(1);
  }

  public startArmSwing(): void {
    this.startLegSwing();
  }

  public stopArmSwing(): void {
    this.stopLegSwing();
  }

  public destroy(): void {
    this.pulseTween?.stop();
    this.highlightTimer?.remove(false);
    this.container.destroy(true);
  }
}
