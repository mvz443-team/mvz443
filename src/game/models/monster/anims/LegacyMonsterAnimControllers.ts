import GolemAnim, { GolemAnimProps } from "../../../sprite/golem";
import { FlyingZombieAnim } from "../../../sprite/flying_zombie";
import { BalloonTntAnim } from "../../../sprite/balloon_tnt";
import {
  NormalZombieAnimProps,
  newNormalEvokerAnim,
  newNormalSkeletonAnim,
  newNormalVindicatorAnim,
  newNormalZombieAnim,
} from "../../../sprite/normal_zombie";
import IMutantAnim, { MutantAnimProps } from "../../../sprite/zombie_mutant";
import type { Game } from "../../../scenes/Game";
import type { IMonsterAnimController, MonsterHandAnchor } from "./IMonsterAnimController";

type LegacyAnimLike = {
  updatePosition(x: number, y: number): void;
  setDepth(depth: number): void;
  getHandAnchor?(): MonsterHandAnchor | null;
  highlight(): void;
  twinkle?(): void;
  startLegSwing(): void;
  stopLegSwing(): void;
  startArmSwing(): void;
  stopArmSwing(): void;
  destroy(): void;
  isInAnim?: boolean;
  setDivingPose?(diving: boolean): void;
  head?: Phaser.GameObjects.Sprite;
};

const TARGET_KEYS = [
  "body",
  "head",
  "armLeft",
  "armRight",
  "legLeft",
  "legRight",
  "upperArmLeft",
  "upperArmRight",
  "lowerArmLeft",
  "lowerArmRight",
  "upperLegLeft",
  "upperLegRight",
  "lowerLegLeft",
  "lowerLegRight",
  "handObject",
  "backObject",
  "dirt",
  "balloon",
] as const;

export class LegacyMonsterAnimController<TAnim extends LegacyAnimLike> implements IMonsterAnimController {
  public constructor(public readonly raw: TAnim) { }

  public get isInAnim() {
    return this.raw.isInAnim;
  }

  public updatePosition(x: number, y: number): void {
    this.raw.updatePosition(x, y);
  }

  public setDepth(depth: number): void {
    this.raw.setDepth(depth);
  }

  public getHandAnchor(): MonsterHandAnchor | null {
    return this.raw.getHandAnchor?.() ?? null;
  }

  public highlight(): void {
    this.raw.highlight();
  }

  public twinkle?(): void {
    this.raw.twinkle?.();
  }

  public startLegSwing(): void {
    this.raw.startLegSwing();
  }

  public stopLegSwing(): void {
    this.raw.stopLegSwing();
  }

  public startArmSwing(): void {
    this.raw.startArmSwing();
  }

  public stopArmSwing(): void {
    this.raw.stopArmSwing();
  }

  public setAirborne(airborne: boolean): void {
    (this.raw as { setAirborne?: (value: boolean) => void }).setAirborne?.(airborne);
  }

  public getHangPivot(): MonsterHandAnchor | null {
    return (this.raw as { getHangPivot?: () => MonsterHandAnchor | null }).getHangPivot?.() ?? null;
  }

  public setRidingPose(riding: boolean, facing: 1 | -1 = 1): void {
    (this.raw as { setRidingPose?: (value: boolean, facing?: 1 | -1) => void })
      .setRidingPose?.(riding, facing);
  }

  public setDivingPose(diving: boolean): void {
    this.raw.setDivingPose?.(diving);
  }

  public getHeadAnchor(): MonsterHandAnchor | null {
    const head = this.raw.head;
    return head ? { x: head.x, y: head.y } : null;
  }

  public destroy(): void {
    this.raw.destroy();
  }

  public getTargets(): Phaser.GameObjects.GameObject[] {
    const targets: Phaser.GameObjects.GameObject[] = [];
    for (const key of TARGET_KEYS) {
      const value = (this.raw as Record<string, unknown>)[key];
      if (value instanceof Phaser.GameObjects.GameObject) {
        targets.push(value);
      }
    }
    return targets;
  }
}

export function createZombieAnimController(
  type: "zombie" | "skeleton" | "evoker" | "vindicator",
  scene: Game,
  x: number,
  y: number,
) {
  const map = {
    zombie: newNormalZombieAnim,
    skeleton: newNormalSkeletonAnim,
    evoker: newNormalEvokerAnim,
    vindicator: newNormalVindicatorAnim,
  } as const;

  return new LegacyMonsterAnimController(map[type](scene, x, y));
}

/** 气球TNT 分身：单个漂浮 sprite，只做表现。 */
export function createBalloonTntAnimController(scene: Game, x: number, y: number) {
  return new LegacyMonsterAnimController(new BalloonTntAnim(scene, x, y));
}

/** 飞行中僵尸：气球在上方，僵尸整体旋转 90° 悬吊在下方。 */
export function createFlyingZombieAnimController(scene: Game, x: number, y: number) {
  return new LegacyMonsterAnimController(new FlyingZombieAnim(scene, x, y, NormalZombieAnimProps));
}

export function createGolemAnimController(scene: Game, x: number, y: number, props: GolemAnimProps) {
  return new LegacyMonsterAnimController(new GolemAnim(scene, x, y, props));
}

export function createMutantAnimController(scene: Game, x: number, y: number, props: MutantAnimProps) {
  return new LegacyMonsterAnimController(new IMutantAnim(scene, x, y, props));
}
