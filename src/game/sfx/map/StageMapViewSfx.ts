/*
 * Visual: stage-map events — ground collapse dust and the "lights out" flicker.
 * This file only touches Phaser view objects; all authoritative state lives in
 * the level script + PresetEventManager and is registered in RuntimeStateBridge.
 *
 * 通用实现：格子与闪烁次数由调用方（关卡脚本经 ctx）传入，不绑定具体关卡。
 *
 * 崩塌表现分三段（纯表现，不写任何逻辑状态）：
 *   1. 从背景纹理 crop 出每个待崩塌土地格的图层，贴合原位置盖住地图；
 *   2. 该土地图层猛烈颤抖（逐帧随机抖动 + 轻微旋转）；
 *   3. 向外爆发泥土碎块与冲击环，同时土地层下坠、缩小、淡出，露出下面的水面。
 */
import type { Game } from "../../scenes/Game";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import DepthHelper from "../../utils/helper/DepthHelper";
import { LOGICAL_BATTLE_HEIGHT, LOGICAL_BATTLE_WIDTH } from "../../../constants/gameLayout";
import { PositionManager } from "../../managers/view/PositionManager";
import type { GridCell } from "../../stages/types";

export interface CollapseSfxArgs extends BaseSfxArgs {
  cells: readonly GridCell[];
}

/** 颤抖总时长（ms）。 */
const SHAKE_MS = 300;
/** 下坠淡出时长（ms）。 */
const FALL_MS = 460;
/** 崩塌碎块配色（由深到浅的土层 + 灰尘）。 */
const DEBRIS_COLORS = [0x8a7048, 0x705b3c, 0x51422e, 0xa89a80, 0xc4b08a] as const;

/** 崩塌瞬间的土地 crop + 颤抖 + 碎块爆发，纯视觉。 */
export class CollapseSfx extends BaseSfx<CollapseSfxArgs> {
  play(): void {
    const scene = this.scene;
    const size = PositionManager.Instance.getGridSize();
    const offset = PositionManager.Instance.getGridOffset();
    const bg = scene.background;

    // 更强的镜头震动：与土地颤抖同步，强化"地面塌陷"的体感。
    try {
      scene.cameras.main.shake(SHAKE_MS + FALL_MS, 0.006);
    } catch {
      /* 视图不可用时忽略 */
    }

    // 背景是按 LOGICAL_BATTLE_* 拉伸显示的；crop 用纹理源像素坐标，需换算缩放比。
    const texKey = bg?.texture?.key;
    const texW = bg?.width ?? 0;
    const texH = bg?.height ?? 0;
    const scaleX = bg && texW > 0 ? bg.displayWidth / texW : 1;
    const scaleY = bg && texH > 0 ? bg.displayHeight / texH : 1;
    const canCrop = !!bg && !!texKey && texW > 0 && texH > 0;

    for (const cell of this.args.cells) {
      try {
        const centerX = offset.x + (cell.col + 0.5) * size.width;
        const centerY = offset.y + (cell.row + 0.5) * size.height;
        const left = centerX - size.width / 2;
        const top = centerY - size.height / 2;

        // 1) 从背景纹理裁出这块原始土地，位置、缩放、原点都与背景一致，
        //    于是 crop 后渲染出来的区域正好落在该格的世界坐标上。
        let land: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null = null;
        if (canCrop) {
          const cropX = Math.max(0, (left - bg.x) / scaleX);
          const cropY = Math.max(0, (top - bg.y) / scaleY);
          const cropW = Math.min(texW - cropX, size.width / scaleX);
          const cropH = Math.min(texH - cropY, size.height / scaleY);
          if (cropW > 0 && cropH > 0) {
            // 枢轴放在该 crop 区域的下沿中心：frame 像素仍按 1:1 落在原世界坐标上，
            // 但缩放/旋转会以格子自身为支点，而不是整张背景的左上角（否则会往左上飘）。
            const cropCenterX = cropX + cropW / 2;
            const cropBottomY = cropY + cropH;
            land = scene.add.image(cropCenterX, cropBottomY, texKey)
              .setOrigin(cropCenterX / texW, cropBottomY / texH)
              .setDisplaySize(bg.displayWidth, bg.displayHeight)
              .setCrop(cropX, cropY, cropW, cropH)
              .setDepth(DepthHelper.Scene.presetImage() + 2);
          }
        }
        // 背景纹理不可用时的兜底：纯色土块（同样以底边中心为支点）。
        if (!land) {
          land = scene.add.rectangle(
            centerX, centerY + size.height * 0.47,
            size.width * 0.94, size.height * 0.94, 0x6b5a3a, 0.92,
          ).setOrigin(0.5, 1)
            .setDepth(DepthHelper.Scene.presetImage() + 2);
        }

        this.shakeThenFall(land, size);
        this.burstDebris(centerX, centerY, size);
        this.burstShockwave(centerX, centerY, size);
      } catch (error) {
        console.warn("[CollapseSfx] skipped a tile.", error);
      }
    }
  }

  /** 阶段 2+3：猛烈颤抖，随后下坠、缩小、淡出并销毁图层。 */
  private shakeThenFall(
    land: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
    size: { width: number; height: number },
  ): void {
    const scene = this.scene;
    const baseX = land.x;
    const baseY = land.y;
    const amp = Math.max(3, size.width * 0.022);
    const driver = { t: 0 };

    scene.tweens.add({
      targets: driver,
      t: 1,
      duration: SHAKE_MS,
      ease: "Linear",
      onUpdate: () => {
        if (this.stopped) return;
        // 逐帧随机抖动，形成"猛烈颤抖"而非单次平移。
        land.x = baseX + Phaser.Math.Between(-amp, amp);
        land.y = baseY + Phaser.Math.Between(-amp, amp);
        land.setAngle(Phaser.Math.Between(-3, 3));
      },
      onComplete: () => {
        if (this.stopped || !land.scene) return;
        land.x = baseX;
        land.y = baseY;
        land.setAngle(0);
        // 支点在格子底边中心：把高度压扁（顶边向下塌陷），同时整体下沉并淡出，
        // 形成"中间向下垮掉、逐渐消失"的倒塌感，而不是整块平移/缩向左上角。
        scene.tweens.add({
          targets: land,
          y: baseY + size.height * 0.18,
          alpha: 0,
          scaleY: 0.12,
          scaleX: 0.9,
          duration: FALL_MS,
          ease: "Quad.easeIn",
          onComplete: () => land.destroy(),
        });
      },
    });
  }

  /** 阶段 3a：从土地格向四周迸射的泥土碎块（带重力感的下坠）。 */
  private burstDebris(centerX: number, centerY: number, size: { width: number; height: number }): void {
    const scene = this.scene;
    const count = 11;
    const depth = DepthHelper.Scene.presetImage() + 6;
    for (let i = 0; i < count; i++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const startR = Phaser.Math.FloatBetween(0, Math.min(size.width, size.height) * 0.18);
      const spread = Phaser.Math.FloatBetween(size.width * 0.28, size.width * 0.72);
      const startX = centerX + Math.cos(angle) * startR;
      const startY = centerY + Math.sin(angle) * startR;
      const endX = centerX + Math.cos(angle) * spread;
      // 向下偏移模拟重力：碎块最终落向下方，而不是水平匀速飞出。
      const endY = centerY + Math.sin(angle) * spread * 0.55 + size.height * 0.55;
      const pieceSize = Phaser.Math.FloatBetween(size.width * 0.045, size.width * 0.115);
      const color = DEBRIS_COLORS[Math.floor(Math.random() * DEBRIS_COLORS.length)];
      const piece = scene.add.rectangle(startX, startY, pieceSize, pieceSize, color, 1)
        .setDepth(depth)
        .setAngle(Phaser.Math.Between(0, 360));
      scene.tweens.add({
        targets: piece,
        x: endX,
        y: endY,
        angle: piece.angle + Phaser.Math.Between(-260, 260),
        alpha: 0,
        scale: 0.3,
        duration: Phaser.Math.Between(Math.floor(FALL_MS * 0.8), FALL_MS + 260),
        ease: "Cubic.easeOut",
        onComplete: () => piece.destroy(),
      });
    }
  }

  /** 阶段 3b：快速扩张的冲击环，让爆发更有层次。 */
  private burstShockwave(centerX: number, centerY: number, size: { width: number; height: number }): void {
    const scene = this.scene;
    const ring = scene.add.circle(centerX, centerY, size.width * 0.16)
      .setFillStyle(0x000000, 0)
      .setStrokeStyle(2, 0xd8c39a, 0.75)
      .setDepth(DepthHelper.Scene.presetImage() + 5)
      .setScale(0.35);
    scene.tweens.add({
      targets: ring,
      scale: 1.7,
      alpha: 0,
      duration: 380,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }
}

export interface LightRemovalSfxArgs extends BaseSfxArgs {
  flickerCount: number;
}

/**
 * 地图光照取消：一张全屏暗色遮罩闪烁 N 次后消失。自包含（自建自毁）。
 * 本 SFX 不写任何逻辑状态；"取消光照"由关卡脚本的 dayOrNight 快照完成。
 */
export class LightRemovalSfx extends BaseSfx<LightRemovalSfxArgs> {
  play(): void {
    const scene = this.scene;
    const count = Math.max(1, Math.floor(this.args.flickerCount));
    let overlay: Phaser.GameObjects.Rectangle | null = null;
    try {
      overlay = scene.add.rectangle(
        LOGICAL_BATTLE_WIDTH / 2,
        LOGICAL_BATTLE_HEIGHT / 2,
        LOGICAL_BATTLE_WIDTH,
        LOGICAL_BATTLE_HEIGHT,
        0x000000,
        0.6,
      ).setDepth(DepthHelper.Mob.sceneFlash()).setAlpha(0);
    } catch (error) {
      console.warn("[LightRemovalSfx] overlay unavailable.", error);
      return;
    }
    scene.tweens.add({
      targets: overlay,
      alpha: 0.6,
      duration: 130,
      yoyo: true,
      repeat: count - 1,
      ease: "Sine.easeInOut",
      onComplete: () => overlay?.destroy(),
    });
  }
}

/** 崩塌表现入口。 */
export function playCollapseSfx(scene: Game, cells: readonly GridCell[]): void {
  SfxCmd.Create(CollapseSfx, { scene, cells });
}

/** 光照闪烁表现入口。 */
export function playLightRemovalSfx(scene: Game, flickerCount: number): void {
  SfxCmd.Create(LightRemovalSfx, { scene, flickerCount });
}
