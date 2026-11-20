import { EventBus } from "../../../utils/eventBus";
import { LEGACY_BALANCE_FRAME_INTERVAL_MS } from "../../../constants/physics";
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
import { getAuthoritativeFrame } from "../../core/logic/EntityTickManager";
import {
  cooldownEndFrameFromProfile,
  cooldownLeftMsAt,
  computeCooldownEndFrame,
} from "../../utils/helper/CardCooldown";

/**
 * profile 只在本地帧号“刚好追上”时套用；落后超过该窗口说明本地是跳帧恢复
 * （checkpoint/备用快照），跳帧得到的状态更权威，profile 已过期。
 */
const PROFILE_APPLY_WINDOW_FRAMES = 8;

type CardStatus = {
  level: number; // 卡片等级
  /**
   * 冷却结束的权威逻辑帧；<= 当前帧即已就绪。
   * 不逐帧递减、不进入快照，回滚后用权威种植帧重建。
   */
  cooldownEndFrame: number;
  /** 点击后等待权威确认：期间显示满冷却，确认后用权威帧换算剩余时间。 */
  previewPending: boolean;
  totalMs: number; // 总冷却时间，单位毫秒
};

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

  // 卡槽状态：冷却由权威帧推导，不保存逐帧递减的剩余毫秒。
  cardpileStatus: Map<number, CardStatus> = new Map();
  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.rightButtonReleased()) {
      this.handleRightClick();
    }
  };
  /** 待应用的本人卡槽 profile：等本地模拟追到 profile.frameId 再套用。 */
  private pendingOwnProfile: { frameId: number; cooldowns: CardCooldownState[] } | null = null;
  private readonly handleRoomAllReady = (data: RoomAllReadyEvent) => {
    // 页面刷新重连：服务端保存了刷新前每帧上报的卡槽冷却。
    // 冷却改为按帧推导后，profile 的 leftMs 会被换算成 cooldownEndFrame。
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
    if (frameId <= 0 || frameId < pending.frameId) return;
    // 超过窗口说明本地是跳帧恢复（checkpoint/快照），冷却状态已权威，丢弃 profile。
    if (frameId - pending.frameId > PROFILE_APPLY_WINDOW_FRAMES) {
      this.pendingOwnProfile = null;
      return;
    }
    this.pendingOwnProfile = null;
    this.RestoreCardpileState({ cards: pending.cooldowns }, frameId);
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
    const startFrame = this.currentFrame();
    chosenPlants.forEach(({ pid, level }) => {
      const plantModel = PlantLibrary.GetModel(pid);
      if (plantModel) {
        const totalMs = plantModel.cooldown.getValueAt(level);
        const initialMs = plantModel.cooldownStartAtRatio * totalMs;
        this.cardpileStatus.set(pid, {
          level,
          cooldownEndFrame: startFrame + Math.ceil(initialMs / this.frameIntervalMs()),
          previewPending: false,
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
    this.pendingOwnProfile = null;
    this.prePlantPid = null;
    this.useStarShards = false;
    this.usePickaxe = false;
    this.cardpileStatus.clear();
    this.EventBus.removeAllListeners();
    this.scene = null;
  }

  /** 当前显示的逻辑帧：权威帧优先，未连接时退回到实体逻辑帧。 */
  private currentFrame(): number {
    return SyncManager.Instance.recvQueue?.currentFrameId ?? getAuthoritativeFrame();
  }

  private frameIntervalMs(): number {
    return SyncManager.Instance.frameIntervalMs || LEGACY_BALANCE_FRAME_INTERVAL_MS;
  }

  /** 权威冷却剩余毫秒（不含点击预演）。 */
  private authoritativeLeftMs(status: CardStatus, currentFrame: number): number {
    return cooldownLeftMsAt(status.cooldownEndFrame, currentFrame, this.frameIntervalMs());
  }

  /** 展示用剩余毫秒：权威确认前预演保持满冷却。 */
  private displayLeftMs(status: CardStatus, currentFrame: number): number {
    return status.previewPending ? status.totalMs : this.authoritativeLeftMs(status, currentFrame);
  }

  stepUpdate() {
    // 冷却本身是全帧推导，不需要在这里递减；只广播当前帧的展示进度给 UI。
    this.EventBus.emit('onCooldownStatus', this.GetDisplayCooldownStatus());
  }

  /** 权威种植落地：以操作所在权威帧为起点重新计算冷却结束帧。 */
  reloadCard(pid: number, plantFrame?: number) {
    const status = this.cardpileStatus.get(pid);
    if (!status) return;
    const frame = plantFrame ?? getAuthoritativeFrame();
    status.cooldownEndFrame = computeCooldownEndFrame(frame, status.totalMs, this.frameIntervalMs());
    status.previewPending = false;
  }

  cooldownCard(pid: number) {
    // 立即就绪（调试指令）：冷却结束帧设为当前帧。
    const status = this.cardpileStatus.get(pid);
    if (!status) return;
    status.cooldownEndFrame = this.currentFrame();
    status.previewPending = false;
  }

  previewReloadCard(pid: number) {
    // 点击种植但权威帧未到：保持满冷却，确认后按权威帧换算已过时间。
    const status = this.cardpileStatus.get(pid);
    if (!status) return;
    status.previewPending = true;
  }

  /** 拒绝预测后清除预演冷却，使回滚后的卡槽显示与权威状态一致。 */
  public ClearPreviewCooldowns(): void {
    for (const status of this.cardpileStatus.values()) {
      status.previewPending = false;
    }
  }

  /** 只撤销指定卡片尚未被权威更新抵消的冷却预演。 */
  public ClearPreviewCooldownForCard(pid: number): void {
    const status = this.cardpileStatus.get(pid);
    if (!status || !status.previewPending) return;
    status.previewPending = false;
    this.EventBus.emit('onCooldownStatus', this.GetDisplayCooldownStatus());
  }

  /** 权威操作落地时消费一次预演冷却；没有预演时保持权威冷却不变。 */
  public ConsumePreviewCooldown(pid: number): void {
    const status = this.cardpileStatus.get(pid);
    if (!status || !status.previewPending) return;
    status.previewPending = false;
    this.EventBus.emit('onCooldownStatus', this.GetDisplayCooldownStatus());
  }

  /** 本地调试用快照：包含展示用的预演冷却。 */
  public CaptureCardpileState(): Record<string, unknown> {
    const current = this.currentFrame();
    return {
      cards: [...this.cardpileStatus.entries()]
        .map(([pid, status]) => ({
          pid,
          level: status.level,
          leftMs: this.authoritativeLeftMs(status, current),
          previewLeftMs: status.previewPending ? status.totalMs : 0,
          totalMs: status.totalMs,
          cooldownEndFrame: status.cooldownEndFrame,
        }))
        .sort((a, b) => a.pid - b.pid),
    };
  }

  /**
   * 心跳 profile 用：只保留权威冷却。
   * previewPending 是远端确认前的本地预演值，两端输入时序不同必然不一致。
   */
  public CaptureCanonicalCardpileState(): Record<string, unknown> {
    const current = this.currentFrame();
    return {
      cards: [...this.cardpileStatus.entries()]
        .map(([pid, status]) => ({
          pid,
          level: status.level,
          leftMs: this.authoritativeLeftMs(status, current),
          totalMs: status.totalMs,
        }))
        .sort((a, b) => a.pid - b.pid),
    };
  }

  /** 由服务端 profile（或回滚重建）恢复冷却：把 leftMs 换算成权威帧。 */
  public RestoreCardpileState(state: Record<string, unknown>, profileFrame?: number): void {
    this.cardpileStatus.clear();
    const frame = profileFrame ?? this.currentFrame();
    const interval = this.frameIntervalMs();
    const cards = Array.isArray(state.cards)
      ? (state.cards as Array<{ pid: number; level: number; leftMs: number; totalMs: number }>)
      : [];
    for (const card of cards) {
      const totalMs = Number(card.totalMs) || 0;
      const leftMs = Math.max(0, Math.min(totalMs, Number(card.leftMs) || 0));
      this.cardpileStatus.set(Number(card.pid), {
        level: Number(card.level) || 1,
        cooldownEndFrame: cooldownEndFrameFromProfile(frame, leftMs, interval),
        previewPending: false,
        totalMs,
      });
    }
  }

  /**
   * 回滚到权威帧后重建冷却：冷却不再进入快照，改用回放日志中的权威种植帧。
   * 早于回放窗口的种植冷却视为已就绪（冷却通常远短于窗口，且权威操作不会
   * 因本地冷却被拒，不影响一致性）。
   */
  public restoreCooldownsToFrame(frameId: number): void {
    for (const status of this.cardpileStatus.values()) {
      status.cooldownEndFrame = frameId;
      status.previewPending = false;
    }
    if (this.pendingOwnProfile && this.pendingOwnProfile.frameId <= frameId) {
      this.pendingOwnProfile = null;
    }
    const lastPlantFrames = SyncManager.Instance.recvQueue
      ?.collectLastPlantFramesBefore(frameId, BackendWS.my_id);
    if (lastPlantFrames) {
      const interval = this.frameIntervalMs();
      for (const [pid, plantFrame] of lastPlantFrames) {
        const status = this.cardpileStatus.get(pid);
        if (status) {
          status.cooldownEndFrame = computeCooldownEndFrame(plantFrame, status.totalMs, interval);
        }
      }
    }
    this.EventBus.emit('onCooldownStatus', this.GetDisplayCooldownStatus());
  }

  /** 当前卡槽冷却的展示副本；UI 首次挂载时用于同步（避免错过 stepUpdate 事件）。 */
  public GetDisplayCooldownStatus(): Map<number, { hasReloaded: boolean; leftPercent: number }> {
    const status = new Map<number, { hasReloaded: boolean; leftPercent: number }>();
    const current = this.currentFrame();
    for (const [pid, card] of this.cardpileStatus) {
      const leftMs = this.displayLeftMs(card, current);
      status.set(pid, {
        hasReloaded: leftMs <= 0,
        leftPercent: card.totalMs > 0 ? leftMs / card.totalMs : 0,
      });
    }
    return status;
  }

  /** 供控制台 / 调试钩子读取的权威剩余毫秒。 */
  public getCardLeftMs(pid: number): number {
    const status = this.cardpileStatus.get(pid);
    if (!status) return 0;
    return this.authoritativeLeftMs(status, this.currentFrame());
  }

  isCardDisplayReloaded(pid: number): boolean {
    const status = this.cardpileStatus.get(pid);
    if (!status) return false;
    return !status.previewPending && this.authoritativeLeftMs(status, this.currentFrame()) <= 0;
  }

  isCardActuallyReloaded(pid: number): boolean {
    const status = this.cardpileStatus.get(pid);
    if (!status) return false;
    return this.authoritativeLeftMs(status, this.currentFrame()) <= 0;
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
