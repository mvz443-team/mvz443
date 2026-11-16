import Denque from "denque";
import {
  InGameOperation,
  InGameResponse
} from "../../pb/response";
import { EventBus } from "../../utils/eventBus";
import BackendWS from "../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../EventBus";

type InGameEvent = {
  onCardPlant: (pid: number, col: number, row: number, level: number, uid: number) => void;
  onRemovePlant: (pid: number, col: number, row: number) => void;
  onUseStarShards: (pid: number, col: number, row: number, uid: number) => void;
  onGameEvent: (eventType: number, message: string) => void;
  onGameEnd: (isWin: boolean) => void;
  onError: (message: string) => void;
  onOperationRejected: (error: {
    message: string;
    uid: number;
    clientOpSeq: number;
    col: number;
    row: number;
    processFrameId: number;
  }) => void;
};

const GameEndEventType = 0x4000;

const inGameOperationTypePriority: Record<string, number> = {
  removePlant: 0,
  useStarShards: 1,
  cardPlant: 2,
  gameEvent: 3,
  error: 4
};

export default class QueueReceive {
  private readonly backupRetainFrames: number = 120;
  InGameEventBus: EventBus<InGameEvent>;
  queues: Denque<InGameResponse>;

  currentFrameId: number = 0;
  lastAckFrameId: number = 0;

  // 只保留 lastAckFrameId 即可判断重复帧，无需整局累积 Set
  private readonly maxBufferedResponses: number = 64;
  bufferedResponses: Map<number, InGameResponse> = new Map<number, InGameResponse>();

  constructor() {
    this.queues = new Denque();
    this.InGameEventBus = new EventBus<InGameEvent>();
  }

  Reset() {
    this.queues.clear();
    this.bufferedResponses.clear();
    this.currentFrameId = 0;
    this.lastAckFrameId = 0;
  }

  handleInGameResponse(response: InGameResponse) {
    // console.log("[QueueReceive] enqueue response", {
    //   frameId: response.frameId,
    //   operationCount: response.operations.length,
    //   queueLengthBefore: this.queues.length,
    //   bufferedCount: this.bufferedResponses.size,
    //   currentFrameId: this.currentFrameId,
    //   lastAckFrameId: this.lastAckFrameId
    // });
    this.queues.push(response);
  }

  handleGameEndResponse(isWin: boolean, endFrameId?: number) {
    // 旧服务端未提供权威帧号时才退回本地 +1；否则必须对齐服务端结束帧。
    const frameId = endFrameId && endFrameId > this.currentFrameId
      ? endFrameId
      : this.currentFrameId + 1;
    this.handleInGameResponse({
      frameId,
      operations: [{
        processFrameId: frameId,
        operationIndex: Number.MAX_SAFE_INTEGER,
        payload: {
          oneofKind: "gameEvent",
          gameEvent: {
            eventType: GameEndEventType,
            message: isWin ? "1" : "0"
          }
        }
      }]
    });
  }

  public ConsumeInGameOperation(operation: InGameOperation): void {
    switch (operation.payload.oneofKind) {
      case "cardPlant": {
        const cardPlant = operation.payload.cardPlant;
        if (cardPlant.base) {
          this.InGameEventBus.emit(
            "onCardPlant",
            cardPlant.pid,
            cardPlant.base.col,
            cardPlant.base.row,
            cardPlant.level,
            cardPlant.base.uid
          );
          return;
        }
        break;
      }
      case "removePlant": {
        const removePlant = operation.payload.removePlant;
        if (removePlant.base) {
          this.InGameEventBus.emit("onRemovePlant", removePlant.pid, removePlant.base.col, removePlant.base.row);
          return;
        }
        break;
      }
      case "useStarShards": {
        const useStarShards = operation.payload.useStarShards;
        if (useStarShards.base) {
          this.InGameEventBus.emit(
            "onUseStarShards",
            useStarShards.pid,
            useStarShards.base.col,
            useStarShards.base.row,
            useStarShards.base.uid
          );
          return;
        }
        break;
      }
      case "gameEvent": {
        const gameEvent = operation.payload.gameEvent;
        if (gameEvent) {
          if (gameEvent.eventType === GameEndEventType) {
            this.InGameEventBus.emit("onGameEnd", gameEvent.message === "1");
            return;
          }
          this.InGameEventBus.emit("onGameEvent", gameEvent.eventType, gameEvent.message);
          return;
        }
        break;
      }
      case "error": {
        const error = operation.payload.error;
        if (error) {
          const rejection = {
            message: error.message,
            uid: error.uid,
            clientOpSeq: error.clientOpSeq,
            col: error.col,
            row: error.row,
            processFrameId: error.processFrameId,
          };
          this.InGameEventBus.emit("onOperationRejected", rejection);
          // 只有操作者需要撤销预测，其他客户端仅记录日志。
          if (rejection.uid === BackendWS.my_id) {
            PhaserEventBus.emit(PhaserEvents.InGameOperationRejected, rejection);
          }
          return;
        }
        break;
      }
      default:
        console.warn("Unknown game operation type:", operation.payload.oneofKind);
        return;
    }
    console.warn("No operation function defined for:", operation.payload.oneofKind);
  }

  private getOperationUid(operation: InGameOperation): number {
    switch (operation.payload.oneofKind) {
      case "removePlant":
        return operation.payload.removePlant.base?.uid ?? Number.MAX_SAFE_INTEGER;
      case "useStarShards":
        return operation.payload.useStarShards.base?.uid ?? Number.MAX_SAFE_INTEGER;
      case "cardPlant":
        return operation.payload.cardPlant.base?.uid ?? Number.MAX_SAFE_INTEGER;
      default:
        return Number.MAX_SAFE_INTEGER;
    }
  }

  private compareInGameOperations(a: InGameOperation, b: InGameOperation): number {
    if (a.processFrameId !== b.processFrameId) {
      return a.processFrameId - b.processFrameId;
    }

    const aTypePriority = inGameOperationTypePriority[a.payload.oneofKind ?? ""] ?? Number.MAX_SAFE_INTEGER;
    const bTypePriority = inGameOperationTypePriority[b.payload.oneofKind ?? ""] ?? Number.MAX_SAFE_INTEGER;
    if (aTypePriority !== bTypePriority) {
      return aTypePriority - bTypePriority;
    }

    const aUid = this.getOperationUid(a);
    const bUid = this.getOperationUid(b);
    if (aUid !== bUid) {
      return aUid - bUid;
    }

    return a.operationIndex - b.operationIndex;
  }

  Consume(): boolean {
    while (!this.queues.isEmpty()) {
      const response = this.queues.shift();
      if (!response) {
        continue;
      }
      if (response.frameId <= this.lastAckFrameId) {
        // 重复/过期帧直接丢弃，不再累积 consumed Set
        continue;
      }
      this.bufferedResponses.set(response.frameId, response);
    }

    // 缓冲有界：超出上限时优先丢弃最靠后的帧，它们还能通过 ACK 补发重新获得
    if (this.bufferedResponses.size > this.maxBufferedResponses) {
      const frameIds = [...this.bufferedResponses.keys()].sort((a, b) => a - b);
      for (const frameId of frameIds.slice(this.maxBufferedResponses / 2)) {
        this.bufferedResponses.delete(frameId);
      }
    }

    const nextFrameID = this.currentFrameId + 1;
    const response = this.bufferedResponses.get(nextFrameID);
    if (!response) {
      // 正常等待网络帧，不在热路径打印日志
      return false;
    }

    this.bufferedResponses.delete(nextFrameID);

    const operations = [...response.operations].sort((a, b) => this.compareInGameOperations(a, b));

    for (const operation of operations) {
      if (operation.processFrameId !== nextFrameID) {
        console.warn(
          "Lockstep response contains mismatched processFrameId:",
          operation.processFrameId,
          "expected:",
          nextFrameID
        );
      }
      this.ConsumeInGameOperation(operation);
    }

    this.currentFrameId = nextFrameID;
    this.lastAckFrameId = nextFrameID;
    // console.log("[QueueReceive] consumed frame", {
    //   frameId: nextFrameID,
    //   operationCount: operations.length,
    //   bufferedRemaining: this.bufferedResponses.size
    // });
    BackendWS.sendBlankFrame(nextFrameID);
    return true;
  }
}
