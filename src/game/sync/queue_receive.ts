import Denque from "denque";
import {
  InGameOperation,
  InGameResponse
} from "../../pb/response";
import { EventBus } from "../../utils/eventBus";
import BackendWS from "../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import SyncManager from "../managers/combat/SyncManager";
import { desyncDiagnostics } from "../../utils/debug/desyncDiagnostics";
import { setAuthoritativeFrame } from "../core/logic/EntityTickManager";

type InGameEvent = {
  onCardPlant: (pid: number, col: number, row: number, level: number, uid: number) => void;
  onRemovePlant: (pid: number, col: number, row: number, uid: number) => void;
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

function describeOperation(operation: InGameOperation): Record<string, unknown> {
  const kind = operation.payload.oneofKind ?? "unknown";
  const base = (payload: { base?: { uid?: number; col?: number; row?: number } | null } | undefined) => ({
    uid: payload?.base?.uid ?? null,
    col: payload?.base?.col ?? null,
    row: payload?.base?.row ?? null,
  });
  switch (operation.payload.oneofKind) {
    case "cardPlant":
      return {
        kind,
        processFrameId: operation.processFrameId,
        operationIndex: operation.operationIndex,
        responseClientOpSeq: operation.responseClientOpSeq,
        ...base(operation.payload.cardPlant),
        pid: operation.payload.cardPlant.pid,
        level: operation.payload.cardPlant.level,
      };
    case "removePlant":
      return {
        kind,
        processFrameId: operation.processFrameId,
        operationIndex: operation.operationIndex,
        responseClientOpSeq: operation.responseClientOpSeq,
        ...base(operation.payload.removePlant),
        pid: operation.payload.removePlant.pid,
      };
    case "useStarShards":
      return {
        kind,
        processFrameId: operation.processFrameId,
        operationIndex: operation.operationIndex,
        responseClientOpSeq: operation.responseClientOpSeq,
        ...base(operation.payload.useStarShards),
        pid: operation.payload.useStarShards.pid,
      };
    case "gameEvent":
      return {
        kind,
        processFrameId: operation.processFrameId,
        operationIndex: operation.operationIndex,
        eventType: operation.payload.gameEvent.eventType,
        message: operation.payload.gameEvent.message,
      };
    case "error":
      return {
        kind,
        processFrameId: operation.processFrameId,
        operationIndex: operation.operationIndex,
        message: operation.payload.error.message,
        uid: operation.payload.error.uid,
        clientOpSeq: operation.payload.error.clientOpSeq,
        col: operation.payload.error.col,
        row: operation.payload.error.row,
        errorProcessFrameId: operation.payload.error.processFrameId,
      };
    default:
      return {
        kind,
        processFrameId: operation.processFrameId,
        operationIndex: operation.operationIndex,
      };
  }
}

export default class QueueReceive {
  private readonly backupRetainFrames: number = 120;
  InGameEventBus: EventBus<InGameEvent>;
  queues: Denque<InGameResponse>;

  currentFrameId: number = 0;
  lastAckFrameId: number = 0;

  // 只保留 lastAckFrameId 即可判断重复帧，无需整局累积 Set
  private readonly maxBufferedResponses: number = 64;
  bufferedResponses: Map<number, InGameResponse> = new Map<number, InGameResponse>();
  /**
   * processFrameId -> operation signature -> operation。
   * 服务端正常回包的 frameId 与 processFrameId 一致；补发、旧服务端或异常包
   * 可能混入相邻帧操作，必须先按 processFrameId 分组，禁止提前执行未来帧操作。
   */
  private readonly pendingOperations: Map<number, Map<string, InGameOperation>> = new Map();
  /** 已消费帧的回放日志：回滚到旧帧后可重新推进到当前帧。 */
  private readonly replayLog: Map<number, InGameResponse> = new Map<number, InGameResponse>();
  private readonly maxReplayFrames: number = 300;

  constructor() {
    this.queues = new Denque();
    this.InGameEventBus = new EventBus<InGameEvent>();
  }

  Reset() {
    this.queues.clear();
    this.bufferedResponses.clear();
    this.pendingOperations.clear();
    this.replayLog.clear();
    this.currentFrameId = 0;
    this.lastAckFrameId = 0;
    setAuthoritativeFrame(0);
  }

  /**
   * 回滚到指定帧并重新注入之后的已消费帧。
   * 配合状态快照使用，可在原地重放历史操作以验证/恢复到当前进度。
   *
   * 恢复不能丢掉已经收到的未来帧：断线重连时，服务端的 replayFrames 与
   * 断线前缓冲区里的新帧可能同时存在；清空全部缓冲会导致重连后卡在
   * “等待网络帧”，或者跳过某些已下发帧。
   */
  public restoreToFrame(frameId: number): void {
    // queues 里可能已有尚未 Consume 的未来回包（例如重连时 replayFrames
    // 先到达、逻辑帧循环还没跑到）；恢复时同样必须保留，否则会丢帧。
    const queuedResponses = this.queues.toArray();
    const queuedAfter = queuedResponses
      .filter((response) => response.frameId > frameId)
      .sort((a, b) => a.frameId - b.frameId);
    const bufferedAfter = [...this.bufferedResponses.entries()]
      .filter(([id]) => id > frameId)
      .sort(([a], [b]) => a - b);
    const pendingAfter = [...this.pendingOperations.entries()]
      .filter(([id]) => id > frameId);
    const replayIds = [...this.replayLog.keys()]
      .filter((id) => id > frameId)
      .sort((a, b) => a - b);
    desyncDiagnostics.record("sync", "restoreToFrame", {
      frameId,
      previousFrameId: this.currentFrameId,
      replayFrames: [...this.replayLog.keys()].sort((a, b) => a - b),
      queuedAfter: queuedAfter.map((response) => response.frameId),
      bufferedAfter: bufferedAfter.map(([id]) => id),
      pendingAfter: pendingAfter.map(([id]) => id),
    });
    this.queues.clear();
    this.bufferedResponses.clear();
    this.pendingOperations.clear();
    for (const [id, operations] of pendingAfter) {
      this.pendingOperations.set(id, operations);
    }
    this.currentFrameId = frameId;
    this.lastAckFrameId = frameId;
    setAuthoritativeFrame(frameId);

    // 先把所有来源的“未来操作”重新分组：queues 里的旧回包也可能携带
    // processFrameId > frameId 的操作（服务端把相邻帧操作合并下发）。
    for (const response of queuedResponses) {
      this.stageResponseOperations(response);
    }
    for (const [, response] of bufferedAfter) {
      this.stageResponseOperations(response);
    }

    // 同一帧可能同时存在于 queues / buffered / replayLog：
    // 优先使用 replayLog（保存“该帧实际执行的操作集合”），
    // 其次 buffered，最后才是尚未消费的原始回包。
    const responses = new Map<number, InGameResponse>();
    for (const response of queuedAfter) {
      if (!responses.has(response.frameId)) {
        responses.set(response.frameId, response);
      }
    }
    for (const [id, response] of bufferedAfter) {
      responses.set(id, response);
    }
    for (const id of replayIds) {
      const response = this.replayLog.get(id);
      if (!response) continue;
      this.stageResponseOperations(response);
      responses.set(id, response);
    }
    for (const id of [...responses.keys()].sort((a, b) => a - b)) {
      const response = responses.get(id);
      if (response) this.queues.push(response);
    }
  }

  /** 只保留最近 N 帧的回放日志，避免长期增长。 */
  private trimReplayLog(currentFrameId: number): void {
    if (this.replayLog.size <= this.maxReplayFrames) return;
    const threshold = currentFrameId - this.maxReplayFrames;
    for (const id of [...this.replayLog.keys()]) {
      if (id < threshold) this.replayLog.delete(id);
    }
  }

  public getReplayFrameIds(): number[] {
    return [...this.replayLog.keys()].sort((a, b) => a - b);
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

  /** 把回包里的操作按 processFrameId 暂存；同一操作重复补发时按签名去重。 */
  private stageResponseOperations(response: InGameResponse): void {
    for (const operation of response.operations) {
      const rawFrameId = operation.processFrameId > 0
        ? operation.processFrameId
        : response.frameId;
      if (!Number.isFinite(rawFrameId) || rawFrameId <= 0) {
        desyncDiagnostics.record("sync", "operation without processFrameId", {
          responseFrameId: response.frameId,
          operation: describeOperation(operation),
        });
        continue;
      }
      if (rawFrameId <= this.currentFrameId) {
        // 已提交帧不允许补执行，否则同一操作会再次改变状态。
        desyncDiagnostics.record("sync", "late operation dropped", {
          currentFrameId: this.currentFrameId,
          processFrameId: rawFrameId,
          responseFrameId: response.frameId,
          operation: describeOperation(operation),
        });
        continue;
      }
      if (rawFrameId !== response.frameId) {
        desyncDiagnostics.record("sync", "operation frame regrouped", {
          responseFrameId: response.frameId,
          processFrameId: rawFrameId,
          operation: describeOperation(operation),
        });
      }

      let operations = this.pendingOperations.get(rawFrameId);
      if (!operations) {
        operations = new Map();
        this.pendingOperations.set(rawFrameId, operations);
      }
      operations.set(this.operationSignature(operation), operation);
    }
  }

  private operationSignature(operation: InGameOperation): string {
    const payload = operation.payload;
    switch (payload.oneofKind) {
      case "cardPlant":
        return [
          operation.processFrameId,
          "cardPlant",
          operation.operationIndex,
          payload.cardPlant.pid,
          payload.cardPlant.level,
          payload.cardPlant.base?.uid ?? -1,
          payload.cardPlant.base?.col ?? -1,
          payload.cardPlant.base?.row ?? -1,
        ].join(":");
      case "removePlant":
        return [
          operation.processFrameId,
          "removePlant",
          operation.operationIndex,
          payload.removePlant.pid,
          payload.removePlant.base?.uid ?? -1,
          payload.removePlant.base?.col ?? -1,
          payload.removePlant.base?.row ?? -1,
        ].join(":");
      case "useStarShards":
        return [
          operation.processFrameId,
          "useStarShards",
          operation.operationIndex,
          payload.useStarShards.pid,
          payload.useStarShards.base?.uid ?? -1,
          payload.useStarShards.base?.col ?? -1,
          payload.useStarShards.base?.row ?? -1,
        ].join(":");
      case "gameEvent":
        return [
          operation.processFrameId,
          "gameEvent",
          operation.operationIndex,
          payload.gameEvent.eventType,
          payload.gameEvent.message,
        ].join(":");
      case "error":
        return [
          operation.processFrameId,
          "error",
          operation.operationIndex,
          payload.error.uid,
          payload.error.clientOpSeq,
          payload.error.col,
          payload.error.row,
        ].join(":");
      default:
        return [
          operation.processFrameId,
          payload.oneofKind ?? "unknown",
          operation.operationIndex,
        ].join(":");
    }
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
        responseClientOpSeq: 0,
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
    const responseSeq = operation.responseClientOpSeq ?? 0;
    SyncManager.Instance.setCurrentOperationResponseSeq(responseSeq);
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
          this.InGameEventBus.emit(
            "onRemovePlant",
            removePlant.pid,
            removePlant.base.col,
            removePlant.base.row,
            removePlant.base.uid
          );
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
    const beforeFrameId = this.currentFrameId;
    while (!this.queues.isEmpty()) {
      const response = this.queues.shift();
      if (!response) {
        continue;
      }
      // 即使回包本身是重复帧，也可能携带尚未见过的后续帧操作，先分组再丢弃。
      this.stageResponseOperations(response);
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
    const stagedOperations = this.pendingOperations.get(nextFrameID);
    if (!response) {
      // 只有服务端真正下发了该帧的权威回包，才允许推进。仅凭操作分组
      // （例如别的回包顺带携带了未来帧操作）推进，会在缺少该帧其余操作
      // 的情况下提前 ACK，服务端据此把未完整执行的帧当成已确认。
      if (stagedOperations) {
        desyncDiagnostics.record("sync", "frame operations without authoritative response", {
          nextFrameID,
          currentFrameId: this.currentFrameId,
          operationCount: stagedOperations.size,
          bufferedFrameIds: [...this.bufferedResponses.keys()].sort((a, b) => a - b),
        });
      }
      // 正常等待网络帧，不在热路径打印日志
      return false;
    }

    this.bufferedResponses.delete(nextFrameID);
    this.pendingOperations.delete(nextFrameID);

    // 只执行 processFrameId === nextFrameID 的操作。若回包 frameId 与操作
    // processFrameId 不一致，操作已经在 stageResponseOperations 中归到正确帧。
    const operations = [...(stagedOperations?.values() ?? [])]
      .sort((a, b) => this.compareInGameOperations(a, b));
    // 回放日志保存“该帧实际执行的操作”，而不是原始回包：
    // 操作可能来自更早的回包，原始回包无法在回滚后还原正确执行集合。
    this.replayLog.set(nextFrameID, {
      frameId: nextFrameID,
      operations,
    });
    desyncDiagnostics.record("sync", "consume frame", {
      beforeFrameId,
      frameId: nextFrameID,
      operations: operations.map(describeOperation),
      bufferedFrameIds: [...this.bufferedResponses.keys()].sort((a, b) => a - b),
      replayFrameIds: [...this.replayLog.keys()].sort((a, b) => a - b),
      ackFrameId: this.lastAckFrameId,
    });

    // 先推进帧号再派发操作：操作回调里创建的实体（经 DeferredManager）
    // 必须以该帧为 timer 起点，而不是上一帧。
    this.currentFrameId = nextFrameID;
    this.lastAckFrameId = nextFrameID;
    setAuthoritativeFrame(nextFrameID);

    for (const operation of operations) {
      this.ConsumeInGameOperation(operation);
    }

    this.trimPendingOperations(nextFrameID);
    this.trimReplayLog(nextFrameID);
    // console.log("[QueueReceive] consumed frame", {
    //   frameId: nextFrameID,
    //   operationCount: operations.length,
    //   bufferedRemaining: this.bufferedResponses.size
    // });
    BackendWS.sendBlankFrame(nextFrameID);
    return true;
  }

  private trimPendingOperations(currentFrameId: number): void {
    for (const frameId of [...this.pendingOperations.keys()]) {
      if (frameId <= currentFrameId || frameId > currentFrameId + this.maxReplayFrames) {
        this.pendingOperations.delete(frameId);
      }
    }
  }
}
