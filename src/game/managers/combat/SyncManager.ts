import { LEGACY_BALANCE_FRAME_INTERVAL_MS } from "../../../constants/physics";
import { onlineStateManager } from "../../../store/OnlineStateManager";
import { EventBus } from "../../../utils/eventBus";
import EnumGameStage from "../../../utils/net/game_state";
import BackendWS from "../../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import type { Game } from "../../scenes/Game";
import QueueReceive from "../../sync/queue_receive";
import QueueSend, { type ResourceUploadSnapshot } from "../../sync/queue_send";
import { BaseManager } from "../BaseManager";
import CombatManager from "../CombatManager";
import { DeferredManager } from "../DeferredManager";
import { PlantLibrary } from "../library/PlantLibrary";
import { PositionManager } from "../view/PositionManager";
import DepthHelper from "../../utils/helper/DepthHelper";
import CardpileManager from "./CardpileManager";
import PlantsManager from "./PlantsManager";
import ResourceManager, { PlayerIdentify } from "./ResourceManager";
import { desyncDiagnostics } from "../../../utils/debug/desyncDiagnostics";
import { perfSampler } from "../../../utils/debug/perfSampler";

type SyncManagerEvent = {
  onRequestPlant: (playerId: PlayerIdentify, pid: number, level: number, col: number, row: number) => void;
  onRequestUseStarShards: (playerId: PlayerIdentify, pid: number, col: number, row: number) => void;
  onRequestRemovePlant: (pid: number, col: number, row: number) => void;
  onPredictedOperation: (operation: PredictedOperation) => void;
  onAuthoritativeOperation: (clientOpSeq: number) => void;
  onPredictedOperationRejected: (clientOpSeq: number) => void;
};

export type PredictedOperation = {
  clientOpSeq: number;
  uid: number;
  kind: "plant" | "starShards" | "removePlant";
  pid: number;
  level: number;
  col: number;
  row: number;
};

export default class SyncManager extends BaseManager {
  private static _instance: SyncManager;
  protected scene: Game | null = null;

  Eventbus: EventBus<SyncManagerEvent>;
  private queueBound: boolean = false;

  public readonly frameIntervalMs: number = LEGACY_BALANCE_FRAME_INTERVAL_MS;

  sendQueue!: QueueSend;
  recvQueue!: QueueReceive;

  // 乐观预测：点击种植后立即显示半透明虚影，服务端确认/拒绝时移除
  private deployGhosts: Map<number, Phaser.GameObjects.Sprite> = new Map();
  private deployGhostTweens: Map<number, Phaser.Tweens.Tween> = new Map();
  private readonly predictedOperations = new Map<number, PredictedOperation>();
  private readonly authoritativeOperationSeqs = new Set<number>();
  private applyingPredictedOperation = false;
  private currentResponseClientOpSeq = 0;

  /** 由 QueueReceive 在消费每个权威操作时设置，用于把回包关联到本地预测。 */
  public setCurrentOperationResponseSeq(clientOpSeq: number): void {
    this.currentResponseClientOpSeq = clientOpSeq;
  }

  constructor() {
    super();
    this.Eventbus = new EventBus<SyncManagerEvent>();
  }

  public static get Instance(): SyncManager {
    if (!this._instance) {
      this._instance = new SyncManager();
    }
    return this._instance;
  }

  public Load(): void {
    this.recvQueue = new QueueReceive();
    this.sendQueue = new QueueSend(
      () => this.frameIntervalMs,
      () => this.captureUploadResources(),
    );
    BackendWS.setQueue(this.recvQueue, this.sendQueue);
    this.bindQueueAndPlantEvents();
  }

  private bindQueueAndPlantEvents() {
    if (this.queueBound) {
      return;
    }
    this.queueBound = true;

    PlantsManager.Instance.EventBus.on("onDeterminePlant", this.handleDeterminePlant);
    PlantsManager.Instance.EventBus.on("onDetermineUseStarShards", this.handleDetermineUseStarShards);
    PlantsManager.Instance.EventBus.on("onDetermineRemovePlant", this.handleDetermineRemovePlant);

    this.recvQueue.InGameEventBus.on("onCardPlant", this.handleRecvCardPlant);
    this.recvQueue.InGameEventBus.on("onUseStarShards", this.handleRecvUseStarShards);
    this.recvQueue.InGameEventBus.on("onRemovePlant", this.handleRecvRemovePlant);
    this.recvQueue.InGameEventBus.on("onGameEnd", this.handleRecvGameEnd);
    this.recvQueue.InGameEventBus.on("onOperationRejected", this.handleOperationRejected);
  }

  private unbindQueueAndPlantEvents() {
    if (!this.queueBound) {
      return;
    }
    this.queueBound = false;

    PlantsManager.Instance.EventBus.off("onDeterminePlant", this.handleDeterminePlant);
    PlantsManager.Instance.EventBus.off("onDetermineUseStarShards", this.handleDetermineUseStarShards);
    PlantsManager.Instance.EventBus.off("onDetermineRemovePlant", this.handleDetermineRemovePlant);

    this.recvQueue?.InGameEventBus.off("onCardPlant", this.handleRecvCardPlant);
    this.recvQueue?.InGameEventBus.off("onUseStarShards", this.handleRecvUseStarShards);
    this.recvQueue?.InGameEventBus.off("onRemovePlant", this.handleRecvRemovePlant);
    this.recvQueue?.InGameEventBus.off("onGameEnd", this.handleRecvGameEnd);
    this.recvQueue?.InGameEventBus.off("onOperationRejected", this.handleOperationRejected);
  }

  private handleDeterminePlant = (pid: number, level: number, col: number, row: number, cost: number) => {
    if (CombatManager.Instance.isDesyncOffline()) {
      this.applyLocalOperation(() => {
        this.Eventbus.emit("onRequestPlant", BackendWS.my_id, pid, level, col, row);
      });
      return;
    }
    const clientOpSeq = this.sendQueue.sendCardPlant(pid, col, row, level, cost);
    const predicted: PredictedOperation = {
      clientOpSeq,
      uid: BackendWS.my_id,
      kind: "plant",
      pid,
      level,
      col,
      row,
    };
    this.predictedOperations.set(clientOpSeq, predicted);
    this.Eventbus.emit("onPredictedOperation", predicted);
    desyncDiagnostics.record("sync", "prediction queued (visual only)", {
      clientOpSeq,
      kind: predicted.kind,
      pid,
      level,
      col,
      row,
      frameId: this.GetFrameID(),
    });
    // 点击即反馈只放半透明虚影；Model 实体必须等权威帧到达后再创建，
    // 否则本地会提前推进实体计时器/事件序号，和远端从第 1 个逻辑帧就分叉。
    if (BackendWS.isRoomSessionMode()) {
      this.spawnDeployGhost(clientOpSeq, pid, col, row);
    }
  };

  private handleDetermineUseStarShards = (pid: number, col: number, row: number, cost: number) => {
    if (CombatManager.Instance.isDesyncOffline()) {
      this.Eventbus.emit("onRequestUseStarShards", BackendWS.my_id, pid, col, row);
      return;
    }
    const clientOpSeq = this.sendQueue.sendStarShards(pid, col, row, cost) ?? 0;
    if (clientOpSeq > 0) {
      const predicted: PredictedOperation = {
        clientOpSeq,
        uid: BackendWS.my_id,
        kind: "starShards",
        pid,
        level: 1,
        col,
        row,
      };
      this.predictedOperations.set(clientOpSeq, predicted);
      this.Eventbus.emit("onPredictedOperation", predicted);
    }
  };

  private handleDetermineRemovePlant = (pid: number, col: number, row: number) => {
    if (CombatManager.Instance.isDesyncOffline()) {
      this.Eventbus.emit("onRequestRemovePlant", pid, col, row);
      return;
    }
    const clientOpSeq = this.sendQueue.sendRemovePlant(pid, col, row) ?? 0;
    if (clientOpSeq > 0) {
      const predicted: PredictedOperation = {
        clientOpSeq,
        uid: BackendWS.my_id,
        kind: "removePlant",
        pid,
        level: 1,
        col,
        row,
      };
      this.predictedOperations.set(clientOpSeq, predicted);
      this.Eventbus.emit("onPredictedOperation", predicted);
    }
  };

  /** 权威帧到达时确认本地预测；只允许操作发起者确认自己的 seq。 */
  public confirmPredictedOperation(clientOpSeq: number, uid?: number): boolean {
    if (clientOpSeq <= 0 || this.authoritativeOperationSeqs.has(clientOpSeq)) return false;
    this.authoritativeOperationSeqs.add(clientOpSeq);
    const predicted = this.predictedOperations.get(clientOpSeq);
    if (!predicted || (uid !== undefined && predicted.uid !== uid)) {
      return false;
    }
    this.predictedOperations.delete(clientOpSeq);
    this.removeGhost(clientOpSeq);
    this.Eventbus.emit("onAuthoritativeOperation", clientOpSeq);
    return true;
  }

  /** 拒绝回包撤销本地虚影与预演资源。 */
  public rejectPredictedOperation(clientOpSeq: number): void {
    this.rollbackPredictedOperation(clientOpSeq);
  }

  private handleRecvCardPlant = (pid: number, col: number, row: number, level: number, uid: number) => {
    if (uid === BackendWS.my_id) {
      this.confirmPredictedOperation(this.currentResponseClientOpSeq, uid);
      this.clearGhostsAt(col, row);
    }
    // 无论是否命中本地预测，Model 变更都只由权威帧执行一次。
    desyncDiagnostics.record("sync", "authoritative plant applied", {
      uid,
      pid,
      level,
      col,
      row,
      frameId: this.GetFrameID(),
    });
    this.Eventbus.emit("onRequestPlant", uid, pid, level, col, row);
  };

  /** 单机/分叉离线模式下直接执行本地操作；联机预测不经过这里。 */
  private applyLocalOperation(operation: () => void): void {
    if (this.applyingPredictedOperation) return;
    this.applyingPredictedOperation = true;
    try {
      operation();
      DeferredManager.Instance.flush();
    } finally {
      this.applyingPredictedOperation = false;
    }
  }

  private spawnDeployGhost(clientOpSeq: number, pid: number, col: number, row: number) {
    const scene = this.scene;
    const model = PlantLibrary.GetModel(pid);
    if (!scene || !model) {
      return;
    }
    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);
    const size = PositionManager.Instance.getPlantDisplaySize();
    const sprite = scene.add.sprite(x, y, model.texturePath, 1)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setAlpha(0.35)
      .setTint(0x88ccff)
      .setDepth(DepthHelper.Plant.base(row));

    const tween = scene.tweens.add({
      targets: sprite,
      alpha: { from: 0.2, to: 0.55 },
      duration: 140,
      yoyo: true,
      repeat: -1,
    });

    this.deployGhosts.set(clientOpSeq, sprite);
    this.deployGhostTweens.set(clientOpSeq, tween);

    // 网络异常或确认帧长期未到时自动清理，避免虚影和预测记录永久残留。
    setTimeout(() => {
      this.predictedOperations.delete(clientOpSeq);
      this.removeGhost(clientOpSeq);
    }, 2000);
  }

  private removeGhost(clientOpSeq: number) {
    this.deployGhostTweens.get(clientOpSeq)?.remove();
    this.deployGhostTweens.delete(clientOpSeq);
    this.deployGhosts.get(clientOpSeq)?.destroy();
    this.deployGhosts.delete(clientOpSeq);
  }

  private clearGhostsAt(col: number, row: number) {
    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);
    for (const [seq, sprite] of this.deployGhosts) {
      if (Math.abs(sprite.x - x) < 1 && Math.abs(sprite.y - y) < 1) {
        this.removeGhost(seq);
      }
    }
  }

  private clearAllGhosts() {
    for (const seq of [...this.deployGhosts.keys()]) {
      this.removeGhost(seq);
    }
  }

  private handleOperationRejected = (rejection: { uid: number; clientOpSeq: number }) => {
    // clientOpSeq 由各客户端独立递增，不同玩家可能撞号；
    // 只有自己的拒绝回包才能撤销自己的预测。
    if (rejection.uid !== BackendWS.my_id) return;
    // 服务端明确拒绝：撤销本地虚影与预演资源，Model 从未被预测改动。
    this.rejectPredictedOperation(rejection.clientOpSeq);
  };

  private handleRecvUseStarShards = (pid: number, col: number, row: number, uid: number) => {
    if (uid === BackendWS.my_id) {
      this.confirmPredictedOperation(this.currentResponseClientOpSeq, uid);
    }
    this.Eventbus.emit("onRequestUseStarShards", uid, pid, col, row);
  };

  private handleRecvRemovePlant = (pid: number, col: number, row: number, uid: number) => {
    if (uid === BackendWS.my_id) {
      this.confirmPredictedOperation(this.currentResponseClientOpSeq, uid);
    }
    this.Eventbus.emit("onRequestRemovePlant", pid, col, row);
  };

  /** 拒绝回包只撤销表现层预测；Model 从未被本地预测改动。 */
  private rollbackPredictedOperation(clientOpSeq: number): void {
    const predicted = this.predictedOperations.get(clientOpSeq);
    if (!predicted) return;
    this.predictedOperations.delete(clientOpSeq);
    this.removeGhost(clientOpSeq);
    ResourceManager.Instance.ClearPreviewDeltas();
    CardpileManager.Instance.ClearPreviewCooldowns();
    this.Eventbus.emit("onPredictedOperationRejected", clientOpSeq);
  }

  private handleRecvGameEnd = (isWin: boolean) => {
    onlineStateManager.updateGameStage(EnumGameStage.PostGame);
    PhaserEventBus.emit(PhaserEvents.RoomGameEnd, { isWin });
  };

  private static readonly WAIT_TOLERANCE_MS = 1000;

  public update(): boolean {
    if (CombatManager.Instance.isDesyncOffline()) {
      this.recvQueue.currentFrameId += 1;
      this.recvQueue.lastAckFrameId = this.recvQueue.currentFrameId;
      return true;
    }
    const consumeStarted = perfSampler.now();
    const frameReady = this.recvQueue.Consume();
    perfSampler.record("recvQueue.Consume", perfSampler.now() - consumeStarted);
    if (!frameReady && BackendWS.isRoomSessionMode() && !CombatManager.Instance.isPaused) {
      const blankStarted = perfSampler.now();
      this.sendQueue.ensureBlankFrame(this.recvQueue.currentFrameId);
      perfSampler.record("ensureBlankFrame", perfSampler.now() - blankStarted);
    }
    return frameReady;
  }

  /** 每个渲染帧检查一次权威帧缺口，避免固定步停摆时 UI 状态被永久锁住。 */
  public updateNetworkWaiting(deltaMs: number): void {
    const waiting = BackendWS.isOnlineMode()
      && !CombatManager.Instance.isPaused
      && !this.recvQueue.ConsumeIsReady();
    if (!waiting) {
      this.waitElapsedMs = 0;
    } else {
      this.waitElapsedMs += Math.max(0, deltaMs);
    }
    const shouldShow = waiting && this.waitElapsedMs >= SyncManager.WAIT_TOLERANCE_MS;
    if (this.scene?.isFrameWaiting() !== shouldShow) {
      this.scene?.toggleFrameWaiting(shouldShow);
      BackendWS.setWaitingFrame(shouldShow);
    }
  }

  private waitElapsedMs: number = 0;

  /** 每帧心跳上报的本机资源 profile；未进入房间会话时不携带。 */
  private captureUploadResources(): ResourceUploadSnapshot | null {
    if (!BackendWS.isRoomSessionMode()) return null;
    const resourceState = CardpileManager.Instance.CaptureCanonicalCardpileState() as {
      cards: Array<{ pid: number; level: number; leftMs: number; totalMs: number }>;
    };
    return {
      energy: ResourceManager.Instance.getEnergy("mine"),
      starShards: ResourceManager.Instance.getStarShards("mine"),
      cardCooldowns: (resourceState.cards ?? []).map((card) => ({
        pid: card.pid,
        level: card.level,
        leftMs: card.leftMs,
        totalMs: card.totalMs,
      })),
    };
  }

  public GetFrameID() {
    return this.recvQueue?.currentFrameId ?? 0;
  }

  public GetNextFrameID() {
    return this.GetFrameID() + 1;
  }

  public Reset() {
    this.unbindQueueAndPlantEvents();
    this.clearAllGhosts();
    this.predictedOperations.clear();
    this.authoritativeOperationSeqs.clear();
    this.applyingPredictedOperation = false;
    this.currentResponseClientOpSeq = 0;
    this.scene = null;
    if (this.recvQueue) {
      this.recvQueue.Reset();
    }
    if (this.sendQueue) {
      this.sendQueue.Reset();
    }
    BackendWS.disconnectQueues();
  }
}
