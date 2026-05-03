import { LEGACY_BALANCE_FRAME_INTERVAL_MS } from "../../../constants/physics";
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
    this.sendQueue = new QueueSend();
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
  }

  private handleDeterminePlant = (pid: number, level: number, col: number, row: number, cost: number) => {
    this.sendQueue.sendCardPlant(pid, col, row, level, cost);
  };

  private handleDetermineUseStarShards = (pid: number, col: number, row: number, cost: number) => {
    this.sendQueue.sendStarShards(pid, col, row, cost);
  };

  private handleDetermineRemovePlant = (pid: number, col: number, row: number) => {
    this.sendQueue.sendRemovePlant(pid, col, row);
  };

  private handleRecvCardPlant = (pid: number, col: number, row: number, level: number, uid: number) => {
    this.Eventbus.emit("onRequestPlant", uid, pid, level, col, row);
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
