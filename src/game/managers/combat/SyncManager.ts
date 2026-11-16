import {
  LEGACY_BALANCE_FRAME_INTERVAL_MS,
  normalizeGameUpdateIntervalMs
} from "../../../constants/physics";
import { onlineStateManager } from "../../../store/OnlineStateManager";
import { EventBus } from "../../../utils/eventBus";
import EnumGameStage from "../../../utils/net/game_state";
import BackendWS from "../../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import type { Game } from "../../scenes/Game";
import QueueReceive from "../../sync/queue_receive";
import QueueSend from "../../sync/queue_send";
import { BaseManager } from "../BaseManager";
import CombatManager from "../CombatManager";
import { PlantLibrary } from "../library/PlantLibrary";
import { PositionManager } from "../view/PositionManager";
import DepthHelper from "../../utils/helper/DepthHelper";
import PlantsManager from "./PlantsManager";
import { PlayerIdentify } from "./ResourceManager";

type SyncManagerEvent = {
  onRequestPlant: (playerId: PlayerIdentify, pid: number, level: number, col: number, row: number) => void;
  onRequestUseStarShards: (playerId: PlayerIdentify, pid: number, col: number, row: number) => void;
  onRequestRemovePlant: (pid: number, col: number, row: number) => void;
};

export default class SyncManager extends BaseManager {
  private static _instance: SyncManager;
  protected scene: Game | null = null;

  Eventbus: EventBus<SyncManagerEvent>;
  private queueBound: boolean = false;

  public frameIntervalMs: number = LEGACY_BALANCE_FRAME_INTERVAL_MS;

  sendQueue!: QueueSend;
  recvQueue!: QueueReceive;

  // 乐观预测：点击种植后立即显示半透明虚影，服务端确认/拒绝时移除
  private deployGhosts: Map<number, Phaser.GameObjects.Sprite> = new Map();
  private deployGhostTweens: Map<number, Phaser.Tweens.Tween> = new Map();

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
    this.sendQueue = new QueueSend(() => this.frameIntervalMs);
    BackendWS.setQueue(this.recvQueue, this.sendQueue);
    this.bindQueueAndPlantEvents();
  }

  public setFrameIntervalMs(frameIntervalMs: number) {
    this.frameIntervalMs = normalizeGameUpdateIntervalMs(frameIntervalMs);
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
    const clientOpSeq = this.sendQueue.sendCardPlant(pid, col, row, level, cost);
    // 点击即反馈：先放半透明虚影，等服务端确认帧到达后再由真实实体接管。
    if (BackendWS.isRoomSessionMode()) {
      this.spawnDeployGhost(clientOpSeq, pid, col, row);
    }
  };

  private handleDetermineUseStarShards = (pid: number, col: number, row: number, cost: number) => {
    this.sendQueue.sendStarShards(pid, col, row, cost);
  };

  private handleDetermineRemovePlant = (pid: number, col: number, row: number) => {
    this.sendQueue.sendRemovePlant(pid, col, row);
  };

  private handleRecvCardPlant = (pid: number, col: number, row: number, level: number, uid: number) => {
    if (uid === BackendWS.my_id) {
      this.clearGhostsAt(col, row);
    }
    this.Eventbus.emit("onRequestPlant", uid, pid, level, col, row);
  };

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

    // 网络异常或确认帧长期未到时自动清理，避免虚影永久残留。
    setTimeout(() => this.removeGhost(clientOpSeq), 2000);
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

  private handleOperationRejected = (rejection: { clientOpSeq: number }) => {
    // 服务端明确拒绝：仅撤销虚影表现，不触碰物理世界，也不回滚已确认状态。
    this.removeGhost(rejection.clientOpSeq);
  };

  private handleRecvUseStarShards = (pid: number, col: number, row: number, uid: number) => {
    this.Eventbus.emit("onRequestUseStarShards", uid, pid, col, row);
  };

  private handleRecvRemovePlant = (pid: number, col: number, row: number) => {
    this.Eventbus.emit("onRequestRemovePlant", pid, col, row);
  };

  private handleRecvGameEnd = (isWin: boolean) => {
    onlineStateManager.updateGameStage(EnumGameStage.PostGame);
    PhaserEventBus.emit(PhaserEvents.RoomGameEnd, { isWin });
  };

  public update(): boolean {
    const frameReady = this.recvQueue.Consume();
    if (!frameReady && BackendWS.isRoomSessionMode() && !CombatManager.Instance.isPaused) {
      this.sendQueue.ensureBlankFrame(this.recvQueue.currentFrameId);
    }
    if (this.scene?.waitText) {
      this.scene.setWaitTextVisibleTarget(BackendWS.isOnlineMode() && !frameReady && !CombatManager.Instance.isPaused);
    }
    return frameReady;
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
    this.scene = null;
    if (this.recvQueue) {
      this.recvQueue.Reset();
    }
    if (this.sendQueue) {
      this.sendQueue.Reset();
    }
    BackendWS.disconnectQueues();
    this.frameIntervalMs = LEGACY_BALANCE_FRAME_INTERVAL_MS;
  }
}
