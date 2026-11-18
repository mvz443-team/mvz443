import { EventBus } from "../../../utils/eventBus";
import { onlineStateManager } from "../../../store/OnlineStateManager";
import BackendWS from "../../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import type { RoomAllReadyEvent } from "../../../types/online";
import type { CardCooldownState } from "../../../pb/common";
import type { Game } from "../../scenes/Game";
import { BaseManager } from "../BaseManager";
import CombatManager from "../CombatManager";
import { PlantLibrary } from "../library/PlantLibrary";
import PlantsManager from "./PlantsManager";
import ResourceManager from "./ResourceManager";
import SyncManager from "./SyncManager";
import SoundCmd from "../../utils/cmd/SoundCmd";

/**
 * profile 只在本地帧号“刚好追上”时套用；落后超过该窗口说明本地是跳帧恢复
 * （checkpoint/备用快照），跳帧得到的状态更权威，profile 已过期。
 */
const PROFILE_APPLY_WINDOW_FRAMES = 8;

type CardpileManagerEvent = {
  onChosenCard: (pid: number, level: number) => void;
  onChosenPickaxe: () => void;
  onChosenStarShards: () => void;
  onCancelChosen: () => void;

  onCooldownStatus: (
    status: Map<number, {
      hasReloaded: boolean; // 是否已经完成冷却
      leftPercent: number; // 剩余冷却时间百分比，0-1
    }>
  ) => void;
}

export default class CardpileManager extends BaseManager {
  private static _instance: CardpileManager;
  protected scene: Game | null = null;

  public EventBus: EventBus<CardpileManagerEvent>;

  // 卡槽中选中的植物(可为null)
  prePlantPid: [number, number] | null = null; // [pid,level] | null
  // 星之碎片
  useStarShards: boolean = false;
  // 铁镐
  usePickaxe: boolean = false;

  // 卡槽状态
  cardpileStatus: Map<number, {
    level: number; // 卡片等级
    leftMs: number; // 正式剩余冷却时间，单位毫秒
    previewLeftMs: number; // 表现层预演剩余冷却时间，单位毫秒；远端确认前保持满值不倒计时
    totalMs: number; // 总冷却时间，单位毫秒
  }> = new Map();
  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.rightButtonReleased()) {
      this.handleRightClick();
    }
  };
  /** 是否已经用权威快照恢复过冷却；之后到达的 profile 不得回退冷却。 */
  private restoredFromSnapshot = false;
  /** 待应用的本人卡槽 profile：等本地模拟追到 profile.frameId 再套用。 */
  private pendingOwnProfile: { frameId: number; cooldowns: CardCooldownState[] } | null = null;
  private readonly handleRoomAllReady = (data: RoomAllReadyEvent) => {
    // 页面刷新重连：服务端保存了刷新前每帧上报的卡槽冷却。
    // 快照恢复更新，发生过后以快照为准。
    if (this.restoredFromSnapshot) return;
    const ownProfile = data.resources?.find((profile) => profile.playerId === data.myId);
    if (!ownProfile || ownProfile.cardCooldowns.length === 0) return;
    // 不能在 AllReady 到达时立刻套用：页面刷新后本地要从初始冷却重演，
    // 提前覆盖会让重演期间扣冷却的时序与在线端分叉。先登记，等帧号追上。
    // 本地帧号已越过 profile 帧号说明状态来自 checkpoint/快照，那份更权威。
    const profileFrame = Number(ownProfile.frameId) || 0;
    const localFrame = SyncManager.Instance.recvQueue?.currentFrameId ?? 0;
    if (profileFrame <= localFrame) return;
    this.pendingOwnProfile = {
      frameId: profileFrame,
      cooldowns: ownProfile.cardCooldowns.map((cooldown) => ({ ...cooldown })),
    };
  };

  /** 每帧固定步调用：本地帧号追上 profile 帧号后才覆盖冷却。 */
  public applyPendingOwnProfile(frameId: number): void {
    const pending = this.pendingOwnProfile;
    if (!pending) return;
    if (this.restoredFromSnapshot) {
      this.pendingOwnProfile = null;
      return;
    }
    if (frameId <= 0 || frameId < pending.frameId) return;
    // 超过窗口说明本地是跳帧恢复（checkpoint/快照），冷却状态已权威，丢弃 profile。
    if (frameId - pending.frameId > PROFILE_APPLY_WINDOW_FRAMES) {
      this.pendingOwnProfile = null;
      return;
    }
    this.pendingOwnProfile = null;
    this.cardpileStatus.clear();
    for (const cooldown of pending.cooldowns) {
      const pid = Number(cooldown.pid);
      if (!Number.isFinite(pid)) continue;
      const totalMs = Number(cooldown.totalMs) || 0;
      const leftMs = Math.max(0, Math.min(totalMs, Number(cooldown.leftMs) || 0));
      this.cardpileStatus.set(pid, {
        level: Number(cooldown.level) || 1,
        leftMs,
        previewLeftMs: 0,
        totalMs,
      });
    }
  }

  constructor() {
    super();
    this.EventBus = new EventBus<CardpileManagerEvent>();
  }

  /**
   * 房间会话下，服务端 AllReady 会下发 canonical loadout。
   * 两端必须使用同一份卡组与等级，否则首次种植就会产生属性分叉。
   */
  private resolveChosenPlants(): Array<{ pid: number; level: number }> {
    if (BackendWS.isRoomSessionMode()) {
      const canonicalCards = onlineStateManager.getOwnCanonicalLoadout()?.loadout?.cards;
      if (canonicalCards && canonicalCards.length > 0) {
        return canonicalCards.map((card) => ({ pid: card.pid, level: card.level }));
      }
    }
    return this.scene?.params.plants || [];
  }

  public Load(): void {
    // FUTURE: 当前版本卡片槽位依然是外置的，因此先监听这些全局事件用来发送 选择卡片的消息，
    // 后续版本如果卡片槽位组件化了，这些事件就可以直接在组件内发出，不需要通过全局事件总线了

    // 获取本用户选择的卡组并更新；联机/房间会话优先使用服务端下发的 canonical loadout
    const chosenPlants = this.resolveChosenPlants();
    chosenPlants.forEach(({ pid, level }) => {
      const plantModel = PlantLibrary.GetModel(pid);
      if (plantModel) {
        const totalMs = plantModel.cooldown.getValueAt(level);
        const leftMs = plantModel.cooldownStartAtRatio * totalMs;
        this.cardpileStatus.set(pid, {
          level,
          leftMs,
          previewLeftMs: 0,
          totalMs,
        });
      }
    });


    // 监听右键取消选择以取消高亮
    this.scene?.input.on('pointerup', this.handlePointerUp);

    PhaserEventBus.on(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    // 重连时 AllReady 可能早于本 Manager 的 Load 到达，先应用缓存。
    const roomAllReady = onlineStateManager.getRoomAllReady();
    if (roomAllReady) {
      this.handleRoomAllReady(roomAllReady);
    }
  }

  public setScene(scene: Game) {
    this.scene = scene;
  }

  public static get Instance(): CardpileManager {
    if (!this._instance) {
      this._instance = new CardpileManager();
    }
    return this._instance;
  }

  public Reset() {
    this.scene?.input.off('pointerup', this.handlePointerUp);
    PhaserEventBus.off(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    this.restoredFromSnapshot = false;
    this.pendingOwnProfile = null;
    this.prePlantPid = null;
    this.useStarShards = false;
    this.usePickaxe = false;
    this.cardpileStatus.clear();
    this.EventBus.removeAllListeners();
    this.scene = null;
  }

  stepUpdate() {
    const elasp = SyncManager.Instance.frameIntervalMs;
    const newStatus = new Map<number, {
      hasReloaded: boolean;
      leftPercent: number;
    }>();

    for (const pid of this.cardpileStatus.keys()) {
      const status = this.cardpileStatus.get(pid);
      if (status) {
        const { leftMs, totalMs, previewLeftMs } = status;
        const newLeftMs = Math.max(0, leftMs - elasp);
        const displayLeftMs = Math.max(newLeftMs, previewLeftMs);
        this.cardpileStatus.set(pid, {
          ...status,
          leftMs: newLeftMs,
        });
        newStatus.set(pid, {
          hasReloaded: displayLeftMs === 0,
          leftPercent: totalMs > 0 ? displayLeftMs / totalMs : 0,
        });
      }
    }
    this.EventBus.emit('onCooldownStatus', newStatus);
  }

  reloadCard(pid: number) {
    // 开始冷却某张卡片，通常在使用后调用
    const status = this.cardpileStatus.get(pid);
    if (status) {
      status.leftMs = status.totalMs;
      status.previewLeftMs = 0;
      this.cardpileStatus.set(pid, status);
    }
  }

  cooldownCard(pid: number) {
    // 立即冷却某张卡片
    const status = this.cardpileStatus.get(pid);
    if (status) {
      status.leftMs = 0;
      status.previewLeftMs = 0;
      this.cardpileStatus.set(pid, status);
    }
  }

  previewReloadCard(pid: number) {
    const status = this.cardpileStatus.get(pid);
    if (status) {
      status.previewLeftMs = Math.max(status.previewLeftMs, status.totalMs);
      this.cardpileStatus.set(pid, status);
    }
  }

  /** 拒绝预测后清除预演冷却，使回滚后的卡槽显示与权威状态一致。 */
  public ClearPreviewCooldowns(): void {
    for (const status of this.cardpileStatus.values()) {
      status.previewLeftMs = 0;
    }
  }

  /** 本地调试用快照：包含表现层预演冷却。 */
  public CaptureCardpileState(): Record<string, unknown> {
    return {
      cards: [...this.cardpileStatus.entries()]
        .map(([pid, status]) => ({ pid, ...status }))
        .sort((a, b) => a.pid - b.pid),
    };
  }

  /**
   * 跨端一致性哈希使用：只保留权威冷却状态。
   * previewLeftMs 是远端确认前的本地预演值，两端输入时序不同必然不一致。
   */
  public CaptureCanonicalCardpileState(): Record<string, unknown> {
    return {
      cards: [...this.cardpileStatus.entries()]
        .map(([pid, status]) => ({
          pid,
          level: status.level,
          leftMs: status.leftMs,
          totalMs: status.totalMs,
        }))
        .sort((a, b) => a.pid - b.pid),
    };
  }

  public RestoreCardpileState(state: Record<string, unknown>): void {
    this.cardpileStatus.clear();
    this.restoredFromSnapshot = true;
    const cards = Array.isArray(state.cards)
      ? (state.cards as Array<{ pid: number; level: number; leftMs: number; previewLeftMs?: number; totalMs: number }>)
      : [];
    for (const card of cards) {
      this.cardpileStatus.set(Number(card.pid), {
        level: Number(card.level) || 1,
        leftMs: Number(card.leftMs) || 0,
        previewLeftMs: 0,
        totalMs: Number(card.totalMs) || 0,
      });
    }
  }

  /** 当前卡槽冷却的展示副本；UI 首次挂载时用于同步（避免错过 stepUpdate 事件）。 */
  public GetDisplayCooldownStatus(): Map<number, { hasReloaded: boolean; leftPercent: number }> {
    const status = new Map<number, { hasReloaded: boolean; leftPercent: number }>();
    for (const [pid, card] of this.cardpileStatus) {
      const leftMs = Math.max(card.leftMs, card.previewLeftMs);
      status.set(pid, {
        hasReloaded: leftMs <= 0,
        leftPercent: card.totalMs > 0 ? leftMs / card.totalMs : 0,
      });
    }
    return status;
  }

  isCardDisplayReloaded(pid: number): boolean {
    const status = this.cardpileStatus.get(pid);
    if (!status) {
      return false;
    }
    return Math.max(status.leftMs, status.previewLeftMs) <= 0;
  }

  isCardActuallyReloaded(pid: number): boolean {
    const status = this.cardpileStatus.get(pid);
    if (!status) {
      return false;
    }
    return status.leftMs <= 0;
  }

  // 获得当前选择的对象，用于左键后执行
  public GetCurrentChoice(): {
    type: 'plant' | 'pickaxe' | 'starshards' | null;
    pid?: number;
    level?: number;
  } {
    if (this.prePlantPid) {
      return {
        type: 'plant',
        pid: this.prePlantPid[0],
        level: this.prePlantPid[1],
      };
    } else if (this.usePickaxe) {
      return {
        type: 'pickaxe',
      };
    } else if (this.useStarShards) {
      return {
        type: 'starshards',
      };
    } else {
      return {
        type: null,
      };
    }
  }

  cancelSelection() {
    // 取消选择
    const hadSelection = this.prePlantPid !== null || this.useStarShards || this.usePickaxe;
    this.prePlantPid = null;
    this.useStarShards = false;
    this.usePickaxe = false;
    if (hadSelection) {
      this.EventBus.emit('onCancelChosen');
    }
  }

  private handleRightClick() {
    // 取消选择
    this.cancelSelection();
  }

  ClickCard(pid: number, level: number) {
    if (!this.CouldOperateCardpile()) {
      return;
    }

    // 如果点击的是相同的卡片，那么取消选择
    if (this.prePlantPid && this.prePlantPid[0] === pid) {
      this.cancelSelection();
      return;
    }
    // 选择卡片
    // 切换选择时不需要发出 cancel（避免 UI 闪烁），这里只做状态清理
    this.prePlantPid = null;
    this.useStarShards = false;
    this.usePickaxe = false;
    this.prePlantPid = [pid, level];
    this.EventBus.emit('onChosenCard', pid, level);
  }

  ClickPickaxe() {
    if (!this.CouldOperateCardpile()) {
      return;
    }
    // 如果已经选中，那么再次点击镐子会取消选择
    if (this.usePickaxe) {
      this.cancelSelection();
      return;
    }

    // 选择镐
    this.prePlantPid = null;
    this.useStarShards = false;
    this.usePickaxe = false;
    this.usePickaxe = true;
    SoundCmd.PlayPlant('RemovePlant');
    this.EventBus.emit('onChosenPickaxe');
  }

  ClickStarShards() {
    if (!this.CouldOperateCardpile()) {
      return;
    }
    // 如果已经选中，那么再次点击星碎会取消选择
    if (this.useStarShards) {
      this.cancelSelection();
      return;
    }

    // 选择星星碎片
    this.prePlantPid = null;
    this.useStarShards = false;
    this.usePickaxe = false;

    // 如果自己有多余的星之碎片，那么才允许选择
    if (!ResourceManager.Instance.StarShardsSufficient(1, 'mine')) {
      PlantsManager.Instance.EventBus.emit('onStarshardsInsufficient');
      return;
    }

    this.useStarShards = true;
    this.EventBus.emit('onChosenStarShards');
  }

  CouldOperateCardpile(): boolean {
    // 当前是否能够操作卡片槽，主要用于控制在某些状态下（比如游戏暂停）无法选择卡片
    if (!this.scene) return false;
    if (CombatManager.Instance.isGameEnd) return false;
    if (this.scene.params.gameSettings.isBluePrint && !BackendWS.isOnlineMode()) {
      return true; // 蓝图模式下离线仍然可以操作卡片槽
    }
    return CombatManager.Instance.isPaused === false;
  }
}
