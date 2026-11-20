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
import { perfSampler } from "../../utils/debug/perfSampler";
import { isNetDebugEnabled } from "../../utils/debugFlags";

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
  /** 超过该帧数的迟到权威操作不再回滚重放，避免补发旧包造成追帧风暴。 */
  private static readonly MAX_LATE_REPLAY_FRAMES = 300;
  private readonly backupRetainFrames: number = 120;
  InGameEventBus: EventBus<InGameEvent>;
  queues: Denque<InGameResponse>;

  currentFrameId: number = 0;
  lastAckFrameId: number = 0;

  // 只保留 lastAckFrameId 即可判断重复帧，无需整局累积 Set
  private readonly maxBufferedResponses: number = 64;
  /** 已入队的帧号：重复回包直接丢弃，不再让 staging 做无效签名计算。 */
  private readonly queuedFrameIds: Set<number> = new Set();
  bufferedResponses: Map<number, InGameResponse> = new Map<number, InGameResponse>();
  /**
   * processFrameId -> operation signature -> operation。
   * 服务端正常回包的 frameId 与 processFrameId 一致；补发、旧服务端或异常包
   * 可能混入相邻帧操作，必须先按 processFrameId 分组，禁止提前执行未来帧操作。
   */
  private readonly pendingOperations: Map<number, Map<string, InGameOperation>> = new Map();
  /** 已消费帧的回放日志：回滚到旧帧后可重新推进到当前帧。 */
  private readonly replayLog: Map<number, InGameResponse> = new Map<number, InGameResponse>();
  /** 记录权威帧的实际消费顺序；补帧乱序到达时不能按 frameId 排序重放。 */
  private readonly replayOrder: number[] = [];
  private readonly maxReplayFrames: number = 300;
  /** 已执行过的权威操作签名：补发/重复回包不得二次执行。 */
  private readonly appliedOperationSignatures: Map<number, Set<string>> = new Map();
  private pendingLateOperationRollbackFrame: number | null = null;
  private readonly pendingLateOperations: Map<number, Map<string, InGameOperation>> = new Map();

  constructor() {
    this.queues = new Denque();
    this.InGameEventBus = new EventBus<InGameEvent>();
  }

  Reset() {
    this.queues.clear();
    this.queuedFrameIds.clear();
    this.bufferedResponses.clear();
    this.pendingOperations.clear();
    this.replayLog.clear();
    this.replayOrder.length = 0;
    this.appliedOperationSignatures.clear();
    this.pendingLateOperationRollbackFrame = null;
    this.pendingLateOperations.clear();
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
    const lateBeforeTarget = new Map<number, Map<string, InGameOperation>>();
    const lateAtOrBeforeTarget = new Map<number, Map<string, InGameOperation>>();
    for (const [lateFrameId, operations] of this.pendingLateOperations) {
      if (lateFrameId > frameId) {
        lateBeforeTarget.set(lateFrameId, operations);
        continue;
      }
      lateAtOrBeforeTarget.set(lateFrameId, operations);
      const targetOperations = pendingAfter.find(([id]) => id === lateFrameId)?.[1]
        ?? new Map<string, InGameOperation>();
      for (const [signature, operation] of operations) {
        targetOperations.set(signature, operation);
      }
      const targetIndex = pendingAfter.findIndex(([id]) => id === lateFrameId);
      if (targetIndex >= 0) {
        pendingAfter[targetIndex][1] = targetOperations;
      } else {
        pendingAfter.push([lateFrameId, targetOperations]);
      }
    }
    const replayOrder = this.replayOrder.filter((id) => id > frameId);
    replayOrder.sort((a, b) => a - b);
    for (const lateFrameId of lateAtOrBeforeTarget.keys()) {
      if (!replayOrder.includes(lateFrameId)) replayOrder.push(lateFrameId);
    }
    for (const lateFrameId of lateBeforeTarget.keys()) {
      if (!replayOrder.includes(lateFrameId)) replayOrder.push(lateFrameId);
    }
    replayOrder.sort((a, b) => a - b);
    if (replayOrder.length === 0) {
      const restoredResponse = this.replayLog.get(frameId)
        ?? this.bufferedResponses.get(frameId)
        ?? queuedResponses.find((response) => response.frameId === frameId);
      if (restoredResponse) {
        replayOrder.push(frameId);
      }
    }
    const appliedAfter = new Map<number, Set<string>>();
    for (const [id, signatures] of this.appliedOperationSignatures) {
      if (id > frameId) appliedAfter.set(id, new Set(signatures));
    }
    for (const [lateFrameId, operations] of lateAtOrBeforeTarget) {
      const signatures = appliedAfter.get(lateFrameId) ?? new Set<string>();
      for (const signature of operations.keys()) {
        signatures.delete(signature);
      }
      appliedAfter.set(lateFrameId, signatures);
    }
    desyncDiagnostics.record("sync", "restoreToFrame", {
      frameId,
      previousFrameId: this.currentFrameId,
      replayFrames: [...this.replayLog.keys()].sort((a, b) => a - b),
      replayOrder: [...this.replayOrder],
      queuedAfter: queuedAfter.map((response) => response.frameId),
      bufferedAfter: bufferedAfter.map(([id]) => id),
      pendingAfter: pendingAfter.map(([id]) => id),
      appliedAfter: [...appliedAfter.entries()].map(([id, signatures]) => ({
        frameId: id,
        signatures: [...signatures],
      })),
    });
    this.queues.clear();
    this.queuedFrameIds.clear();
    this.bufferedResponses.clear();
    this.pendingOperations.clear();
    this.appliedOperationSignatures.clear();
    for (const [id, operations] of pendingAfter) {
      this.pendingOperations.set(id, operations);
    }
    for (const [id, signatures] of appliedAfter) {
      this.appliedOperationSignatures.set(id, signatures);
    }
    this.pendingLateOperations.clear();
    this.currentFrameId = frameId;
    this.lastAckFrameId = frameId;
    setAuthoritativeFrame(frameId);
    this.replayOrder.length = 0;

    // 先把所有来源的“未来操作”重新分组：queues 里的旧回包也可能携带
    // processFrameId > frameId 的操作（服务端把相邻帧操作合并下发）。
    for (const response of queuedResponses) {
      this.stageResponseOperations(response);
    }
    for (const [, response] of bufferedAfter) {
      this.stageResponseOperations(response);
    }
    for (const [lateFrameId, operations] of lateAtOrBeforeTarget) {
      const targetOperations = this.pendingOperations.get(lateFrameId)
        ?? new Map<string, InGameOperation>();
      for (const [signature, operation] of operations) {
        targetOperations.set(signature, operation);
      }
      this.pendingOperations.set(lateFrameId, targetOperations);
    }
    for (const [lateFrameId, operations] of lateBeforeTarget) {
      if (lateFrameId <= frameId) continue;
      const targetOperations = this.pendingOperations.get(lateFrameId)
        ?? new Map<string, InGameOperation>();
      for (const [signature, operation] of operations) {
        targetOperations.set(signature, operation);
      }
      this.pendingOperations.set(lateFrameId, targetOperations);
    }

    const replayedResponses = new Map<number, InGameResponse>();
    for (const lateFrameId of lateAtOrBeforeTarget.keys()) {
      if (this.replayLog.has(lateFrameId)) continue;
      const operations = this.pendingOperations.get(lateFrameId);
      if (!operations || operations.size === 0) continue;
      replayedResponses.set(lateFrameId, {
        frameId: lateFrameId,
        operations: [...operations.values()],
      });
    }
    for (const id of replayOrder) {
      const response = this.replayLog.get(id);
      if (!response) continue;
      this.stageResponseOperations(response);
      const stagedOperations = this.pendingOperations.get(id);
      replayedResponses.set(id, {
        frameId: id,
        operations: stagedOperations
          ? [...stagedOperations.values()]
          : response.operations,
      });
    }

    // 同一帧可能同时存在于 queues / buffered / replayLog：
    // 优先使用 replayLog（保存“该帧实际执行的操作集合”），
    // 其次 buffered，最后才是尚未消费的原始回包。
    const responses = new Map<number, InGameResponse>(replayedResponses);
    for (const response of queuedAfter) {
      if (!responses.has(response.frameId)) {
        responses.set(response.frameId, response);
      }
    }
    for (const [id, response] of bufferedAfter) {
      responses.set(id, response);
    }
    // 历史重放按最初消费顺序入队：先消费 frame N+2 再补到 frame N+1 时，
    // 回滚到 N 后仍要先执行 N+2，否则实体创建/销毁时序与首次运行不同。
    for (const id of replayOrder) {
      const response = responses.get(id);
      if (!response) continue;
      this.queues.push(response);
      this.queuedFrameIds.add(id);
      responses.delete(id);
    }
    for (const id of [...responses.keys()].sort((a, b) => a - b)) {
      const response = responses.get(id);
      if (response) {
        this.queues.push(response);
        this.queuedFrameIds.add(id);
      }
    }
  }

  /**
   * 服务端重连补帧可能让客户端先消费更高帧，再补齐中间帧。
   * 这种情况不能回滚世界：中间帧的权威操作到达时已经错过执行时机，
   * 且重放历史只会让实体顺序进一步错乱。宁可停在缺口前等 RESYNC。
   */
  private hasReplayGap(frameId: number): boolean {
    // 回滚时 replayOrder 尚未重新消费，不能把“等待重放的帧”算成历史缺口。
    if (frameId <= this.lastAckFrameId) return false;
    if (this.replayOrder.length === 0) return false;
    return !this.replayOrder.includes(frameId - 1);
  }

  /** 只保留最近 N 帧的回放日志，避免长期增长。 */
  private trimReplayLog(currentFrameId: number): void {
    if (this.replayLog.size <= this.maxReplayFrames) return;
    const threshold = currentFrameId - this.maxReplayFrames;
    for (const id of [...this.replayLog.keys()]) {
      if (id < threshold) this.replayLog.delete(id);
    }
    while (this.replayOrder.length > 0 && this.replayOrder[0] < threshold) {
      this.replayOrder.shift();
    }
  }

  public getReplayFrameIds(): number[] {
    return [...this.replayLog.keys()].sort((a, b) => a - b);
  }

  /**
   * 回滚到 frameId 时重建本机卡槽冷却用：找出该帧及之前，本人最后一次
   * 权威种植每张卡的帧号。冷却改为按帧推导后不再进入快照，靠这里还原。
   */
  public collectLastPlantFramesBefore(frameId: number, uid: number): Map<number, number> {
    const result = new Map<number, number>();
    for (const [responseFrame, response] of this.replayLog) {
      if (responseFrame > frameId) continue;
      for (const operation of response.operations) {
        if (operation.payload.oneofKind !== "cardPlant") continue;
        const cardPlant = operation.payload.cardPlant;
        if ((cardPlant.base?.uid ?? -1) !== uid) continue;
        const pid = cardPlant.pid;
        const previous = result.get(pid);
        if (previous === undefined || responseFrame > previous) {
          result.set(pid, responseFrame);
        }
      }
    }
    return result;
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
    if (this.queuedFrameIds.has(response.frameId) || this.bufferedResponses.has(response.frameId)) return;
    this.queues.push(response);
    this.queuedFrameIds.add(response.frameId);
  }

  /** 把回包里的操作按 processFrameId 暂存；同一操作重复补发时按签名去重。 */
  private stageResponseOperations(response: InGameResponse): void {
    const started = perfSampler.now();
    try {
      this.stageResponseOperationsInner(response);
    } finally {
      perfSampler.record("stageResponseOperations", perfSampler.now() - started);
    }
  }

  private stageResponseOperationsInner(response: InGameResponse): void {
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
      if (rawFrameId < this.currentFrameId) {
        const signatures = this.appliedOperationSignatures.get(rawFrameId);
        const signature = this.operationSignature(operation);
        if (signatures?.has(signature)) {
          // 服务端 periodic syncAllClients 会反复重发历史帧；这些操作在首次
          // 到达时已经执行，必须直接丢弃，否则会重复扣资源和重复创建实体。
          desyncDiagnostics.record("sync", "duplicate operation ignored", {
            currentFrameId: this.currentFrameId,
            processFrameId: rawFrameId,
            responseFrameId: response.frameId,
            operation: describeOperation(operation),
          });
          continue;
        }
        const replayDistance = this.currentFrameId - rawFrameId;
        if (replayDistance > QueueReceive.MAX_LATE_REPLAY_FRAMES) {
          desyncDiagnostics.record("sync", "late operation dropped", {
            currentFrameId: this.currentFrameId,
            processFrameId: rawFrameId,
            responseFrameId: response.frameId,
            reason: "outside replay window",
            operation: describeOperation(operation),
          });
          continue;
        }
        // 服务端允许改写高延迟玩家的操作目标帧；回包晚于目标帧时不能再
        // “直接执行”，必须先回到目标帧前，恢复权威历史后按原顺序重放。
        desyncDiagnostics.record("sync", "late operation triggers rollback", {
          currentFrameId: this.currentFrameId,
          processFrameId: rawFrameId,
          responseFrameId: response.frameId,
          operation: describeOperation(operation),
        });
        this.requestLateOperationRollback(rawFrameId);
        // 回滚会把尚未消费的历史帧重新送进 pendingOperations；本轮
        // staging 已经处理过该回包，不能继续把它重新归组。先把新操作单独
        // 留存，回滚完成后由 restoreToFrame 注入目标帧。
        this.rememberLateOperation(rawFrameId, operation);
        continue;
      }
      if (rawFrameId === this.currentFrameId) {
        const signature = this.operationSignature(operation);
        const signatures = this.appliedOperationSignatures.get(rawFrameId);
        if (!signatures?.has(signature)) {
          // 回包落在本帧但当前帧已提交，不能在当前帧中途追加以免与刚
          // 处理过的操作顺序不一致；回到该帧之前再重放。
          this.requestLateOperationRollback(rawFrameId);
          this.rememberLateOperation(rawFrameId, operation);
          return;
        }
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

  /**
   * 让外部战斗层回滚到目标帧之前。QueueReceive 不直接持有 CombatManager，
   * 通过同步回调把恢复顺序交给上层，回调内部必须同时恢复模拟状态和队列。
   */
  private lateOperationRollback: ((frameId: number) => boolean) | null = null;

  public setLateOperationRollback(handler: ((frameId: number) => boolean) | null): void {
    this.lateOperationRollback = handler;
  }

  /** 仅供测试：让 staging 阶段直接触发迟到回滚，无需等下一次 Consume。 */
  public stageResponseOperationsForTest(response: InGameResponse): void {
    this.stageResponseOperations(response);
  }

  private requestLateOperationRollback(processFrameId: number): void {
    if (this.pendingLateOperationRollbackFrame !== null
      && this.pendingLateOperationRollbackFrame <= processFrameId) {
      return;
    }
    this.pendingLateOperationRollbackFrame = processFrameId;
    desyncDiagnostics.record("sync", "late operation rollback requested", {
      currentFrameId: this.currentFrameId,
      processFrameId,
    });
  }

  private rememberLateOperation(frameId: number, operation: InGameOperation): void {
    let operations = this.pendingLateOperations.get(frameId);
    if (!operations) {
      operations = new Map();
      this.pendingLateOperations.set(frameId, operations);
    }
    operations.set(this.operationSignature(operation), operation);
  }

  /** 在 Consume 入口统一回滚，避免 staging 重入时丢失/重复回包。 */
  private flushPendingLateOperationRollback(): boolean {
    const processFrameId = this.pendingLateOperationRollbackFrame;
    if (processFrameId === null) return false;
    this.pendingLateOperationRollbackFrame = null;
    if (processFrameId >= this.currentFrameId) return false;
    const restored = this.lateOperationRollback?.(processFrameId) ?? false;
    if (!restored) {
      desyncDiagnostics.record("sync", "late operation rollback unavailable", {
        currentFrameId: this.currentFrameId,
        processFrameId,
      });
      this.pendingLateOperations.delete(processFrameId);
    }
    return restored;
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
        if (isNetDebugEnabled()) console.warn("Unknown game operation type:", operation.payload.oneofKind);
        return;
    }
    if (isNetDebugEnabled()) console.warn("No operation function defined for:", operation.payload.oneofKind);
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

  private getOperationClientOpSeq(operation: InGameOperation): number {
    return operation.responseClientOpSeq ?? 0;
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

    const aSeq = this.getOperationClientOpSeq(a);
    const bSeq = this.getOperationClientOpSeq(b);
    if (aSeq !== bSeq) {
      return aSeq - bSeq;
    }

    return a.operationIndex - b.operationIndex;
  }

  Consume(): boolean {
    const rollbacked = this.flushPendingLateOperationRollback();
    // 一次固定步只允许推进一帧。循环消费会让乱序补帧在同一次调用里连续
    // 跨帧执行，回放日志记录的“首次执行顺序”也会被多帧批处理掩盖。
    const stagedThisStep: InGameResponse[] = [];
    while (!this.queues.isEmpty()) {
      const response = this.queues.shift();
      if (!response) {
        continue;
      }
      this.queuedFrameIds.delete(response.frameId);
      // 即使回包本身是重复帧，也可能携带尚未见过的后续帧操作，先分组再丢弃。
      stagedThisStep.push(response);
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
    if (this.hasReplayGap(nextFrameID)) {
      desyncDiagnostics.record("sync", "replay gap blocks frame", {
        nextFrameID,
        replayOrder: [...this.replayOrder],
        bufferedFrameIds: [...this.bufferedResponses.keys()].sort((a, b) => a - b),
      });
      return false;
    }
    const response = this.bufferedResponses.get(nextFrameID);
    const stagedOperations = this.pendingOperations.get(nextFrameID);
    if (!response) {
      if (rollbacked) return true;
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
    for (const response of stagedThisStep) {
      if (response.frameId !== nextFrameID) {
        this.queues.unshift(response);
      }
    }
    this.pendingOperations.delete(nextFrameID);
    const frameApplied = this.appliedOperationSignatures.get(nextFrameID) ?? new Set<string>();
    this.appliedOperationSignatures.delete(nextFrameID);

    // 只执行 processFrameId === nextFrameID 的操作。若回包 frameId 与操作
    // processFrameId 不一致，操作已经在 stageResponseOperations 中归到正确帧。
    const operations = [...(stagedOperations?.values() ?? [])]
      .sort((a, b) => this.compareInGameOperations(a, b));
    for (const operation of operations) {
      frameApplied.add(this.operationSignature(operation));
    }
    this.appliedOperationSignatures.set(nextFrameID, frameApplied);
    // 回放日志保存“该帧实际执行的操作”，而不是原始回包：
    // 操作可能来自更早的回包，原始回包无法在回滚后还原正确执行集合。
    this.replayLog.set(nextFrameID, {
      frameId: nextFrameID,
      operations,
    });
    this.replayOrder.push(nextFrameID);
    // 热路径只记录轻量字段；过去的 operations/buffered/replay 全量展开会在
    // 每帧创建多份数组和字符串，联机下叠加网络日志后足以影响帧生成时间。
    desyncDiagnostics.record("sync", "consume frame", {
      frameId: nextFrameID,
      operationCount: operations.length,
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

  /** 只读检查下一权威帧是否就绪，不消费任何回包。 */
  public ConsumeIsReady(): boolean {
    return this.bufferedResponses.has(this.currentFrameId + 1);
  }

  private trimPendingOperations(currentFrameId: number): void {
    for (const frameId of [...this.pendingOperations.keys()]) {
      if (frameId <= currentFrameId || frameId > currentFrameId + this.maxReplayFrames) {
        this.pendingOperations.delete(frameId);
      }
    }
  }
}
