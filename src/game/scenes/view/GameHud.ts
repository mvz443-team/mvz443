/**
 * 战斗 HUD：卡槽、底部工具栏、网络状态徽标、调试帧号文本。
 *
 * 从 Game 场景中拆出，Game 只负责创建/更新/销毁这一层。
 */
import type { Game } from "../Game";
import { PositionManager } from "../../managers/view/PositionManager";
import DepthHelper from "../../utils/helper/DepthHelper";
import BackendWS from "../../../utils/net/sync";
import CombatManager from "../../managers/CombatManager";
import { CardSlots } from "../../ui/cardslots";
import { BottomBar } from "../../ui/bottom";
import { MobileBottomBar } from "../../ui/bottom_mobile";
import NetStatusBadge, { type NetBadgeState } from "../../ui/NetStatusBadge";
import { getMobileSideBarLayout } from "../../ui/mobileSideBarLayout";

type Rect = { x: number; y: number; width: number; height: number };

export class GameHud {
  private readonly scene: Game;
  private bottomBarUi: BottomBar | MobileBottomBar | null = null;
  private cardSlotsUi: CardSlots | null = null;
  private netStatusBadge: NetStatusBadge | null = null;
  private debugFrameText: Phaser.GameObjects.Text | null = null;

  constructor(scene: Game) {
    this.scene = scene;
  }

  public create(deviceType: string, gameViewport: Rect, basicDebug: boolean): void {
    const scene = this.scene;

    if (deviceType === "mobile") {
      this.bottomBarUi = new MobileBottomBar(scene);
    } else {
      this.bottomBarUi = new BottomBar(scene);
    }
    this.cardSlotsUi = new CardSlots(scene);

    // 移动端卡槽栏会向右延伸并盖住战斗视口左侧（见 MOBILE_SIDE_BAR_RIGHT_EXTEND_RATIO），
    // 徽标必须避开这段被覆盖的区域，否则会藏在面板下面。
    const sidebarRight = deviceType === "mobile" ? getMobileSideBarLayout().bounds.width : 0;
    this.netStatusBadge = new NetStatusBadge(
      scene,
      Math.max(gameViewport.x, sidebarRight) + 8,
      gameViewport.y + 8,
      Math.max(24, Math.round(scene.scale.displaySize.width / 42)),
      DepthHelper.UI.waitingText(),
    );

    if (basicDebug) {
      const sceneBounds = PositionManager.Instance.getSceneBounds(deviceType);
      this.debugFrameText = scene.add.text(
        8,
        sceneBounds.height - 64,
        "frameId: 0\nackFrameId: 0",
        {
          fontSize: "12px",
          color: "#b8ffb5",
          backgroundColor: "rgba(0, 0, 0, 0.45)",
          padding: { x: 6, y: 4 },
        },
      ).setOrigin(0, 1).setDepth(DepthHelper.UI.debugFrameText());
    }
  }

  public update(basicDebug: boolean): void {
    this.updateNetStatusBadge();
    if (basicDebug && this.debugFrameText) {
      this.debugFrameText.setText(`frameId: ${BackendWS.FrameID}\nackFrameId: ${BackendWS.AckFrameID}`);
    }
  }

  /** 调试/E2E：卡槽能量面板当前显示的文本。 */
  public getCardSlotEnergyText(): string | null {
    return this.cardSlotsUi?.getDisplayedEnergyText() ?? null;
  }

  public updateNetStatusBadge(): void {
    if (!this.netStatusBadge) return;
    let state: NetBadgeState = { kind: "offline" };
    if (BackendWS.isDesyncOfflineMode() || CombatManager.Instance.isDesyncOffline()) {
      state = { kind: "desync" };
    } else if (BackendWS.isReconnecting()) {
      state = { kind: "reconnecting" };
    } else if (BackendWS.isOnlineMode() || BackendWS.isMockRoomMode()) {
      const latency = BackendWS.getAverageLatencyMs();
      state = latency === null ? { kind: "offline" } : { kind: "latency", latencyMs: latency };
    }
    this.netStatusBadge.update(state);
  }

  public destroy(): void {
    this.debugFrameText?.destroy();
    this.debugFrameText = null;
    this.netStatusBadge?.destroy();
    this.netStatusBadge = null;
    this.cardSlotsUi?.destroy();
    this.cardSlotsUi = null;
    this.bottomBarUi?.destroy();
    this.bottomBarUi = null;
  }
}
