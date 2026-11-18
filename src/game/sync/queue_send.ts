import Denque from "denque";
import {
  Request,
  RequestBlank,
  RequestCardPlant,
  RequestEndGame,
  RequestGridOperation,
  RequestRemovePlant,
  RequestStarShards
} from "../../pb/request";
import BackendWS from "../../utils/net/sync";
import ResourceManager from "../managers/combat/ResourceManager";
import { LEGACY_BALANCE_FRAME_INTERVAL_MS } from "../../constants/physics";
import { desyncDiagnostics } from "../../utils/debug/desyncDiagnostics";
import { SIMULATION_STATE_VERSION } from "../core/SimulationState";

export default class QueueSend {
  queues: Denque<Request>;
  private readonly pendingStateHashes: Denque<{ frameId: number; hash: number }> = new Denque();
  // 与 Go server constants.CommandLeadFrames 对齐：点击后最少 2 帧进入权威帧。
  private readonly commandLeadFrames: number = 2;
  private readonly frameIntervalMsProvider: () => number;
  private lastBlankAckFrameIdSent: number = -1;
  private lastBlankAckFrameIdQueued: number = -1;
  private lastBlankSentAt: number = 0;
  private lastBlankQueuedAt: number = 0;
  private clientOpSeq: number = 0;

  constructor(frameIntervalMsProvider: () => number = () => LEGACY_BALANCE_FRAME_INTERVAL_MS) {
    this.queues = new Denque();
    this.frameIntervalMsProvider = frameIntervalMsProvider;
  }

  Reset() {
    this.queues.clear();
    this.pendingStateHashes.clear();
    this.lastBlankAckFrameIdSent = -1;
    this.lastBlankAckFrameIdQueued = -1;
    this.lastBlankSentAt = 0;
    this.lastBlankQueuedAt = 0;
    this.clientOpSeq = 0;
  }

  Consume() {
    if (!BackendWS.isRoomSessionMode()) {
      return;
    }
    this.flushStateHashes();
    while (!this.queues.isEmpty()) {
      const request = this.queues.shift();
      if (request) {
        const refreshedRequest = this.refreshAckFrameId(request);
        desyncDiagnostics.record("sync", "send request", {
          kind: refreshedRequest.payload.oneofKind,
          payload: refreshedRequest.payload,
        });
        // console.log("[QueueSend] send request", {
        //   type: refreshedRequest.payload.oneofKind,
        //   ackFrameId: refreshedRequest.payload.oneofKind === "blank"
        //     ? refreshedRequest.payload.blank.ackFrameId
        //     : BackendWS.AckFrameID,
        //   currentFrameId: BackendWS.GetFrameID(),
        //   queueLengthAfterShift: this.queues.length
        // });
        if (refreshedRequest.payload.oneofKind === "blank") {
          this.lastBlankAckFrameIdQueued = -1;
          this.lastBlankAckFrameIdSent = refreshedRequest.payload.blank.ackFrameId;
          this.lastBlankQueuedAt = 0;
          this.lastBlankSentAt = Date.now();
        }
        BackendWS.send(Request.toBinary(refreshedRequest));
      }
    }
  }

  public sendGameEnd(result: number) {
    desyncDiagnostics.record("sync", "sendGameEnd", { result });
    const request: RequestEndGame = {
      gameResult: result
    };
    this.queues.push({
      payload: {
        endGame: request,
        oneofKind: "endGame"
      }
    });
  }

  /** 上报某一逻辑帧的确定性状态摘要，供服务端跨端比对。 */
  public sendStateHash(frameId: number, hash: number) {
    if (frameId <= 0 || !Number.isFinite(hash)) {
      return;
    }
    this.pendingStateHashes.push({ frameId, hash: hash >>> 0 });
    desyncDiagnostics.record("sync", "sendStateHash", {
      frameId,
      hash: (hash >>> 0).toString(16).padStart(8, "0"),
    });
    if (this.pendingStateHashes.length > 8) {
      this.pendingStateHashes.shift();
    }
  }

  /**
   * checkpoint 的正文必须是可直接恢复的 inline 快照。
   * 只上报 hash 会让服务端把 LastCheckpointFrame 推进到一个客户端无法恢复的帧，
   * 重连时就会从“没有正文的 checkpoint+1”开始补帧，必然错位。
   */
  private static inlineSnapshotJson(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const record = payload as Record<string, unknown>;
    const body = record.payload;
    const hasValues = "values" in record
      || (body !== null
        && typeof body === "object"
        && "values" in (body as Record<string, unknown>));
    if (!hasValues) return "";
    try {
      return JSON.stringify(payload);
    } catch {
      return "";
    }
  }

  /** 上报低频 checkpoint；服务端只在双端摘要一致时采纳。 */
  public sendCheckpoint(frameId: number, hash: string, payload: unknown): void {
    if (frameId <= 0 || !hash) return;
    const inlineSnapshotJson = QueueSend.inlineSnapshotJson(payload);
    desyncDiagnostics.record("sync", "sendCheckpoint", {
      frameId,
      hash,
      hasInlineSnapshot: Boolean(inlineSnapshotJson),
      inlineSnapshotBytes: inlineSnapshotJson.length,
    });
    if (!inlineSnapshotJson) {
      // 没有正文的 checkpoint 不能作为恢复锚点；宁可不上报，让服务端继续
      // 保留完整历史帧，也不能把 LastCheckpointFrame 推进到无法恢复的位置。
      return;
    }
    const request: RequestBlank = {
      // 进度帧与快照帧必须是同一个逻辑帧。若这里写当前帧，服务端会把
      // 旧快照挂到新帧上，恢复后实体计时器整体错位。
      frameId,
      ackFrameId: BackendWS.AckFrameID,
      stateHash: 0,
      hashFrameId: frameId,
      stateHashHex: hash,
      inlineSnapshotJson,
      stateHashVersion: SIMULATION_STATE_VERSION,
    };
    this.queues.push({
      payload: { blank: request, oneofKind: "blank" },
    });
  }

  private flushStateHashes() {
    while (!this.pendingStateHashes.isEmpty()) {
      const entry = this.pendingStateHashes.shift();
      if (!entry) continue;
      const request: RequestBlank = {
        frameId: BackendWS.GetFrameID(),
        ackFrameId: BackendWS.AckFrameID,
        stateHash: entry.hash,
        hashFrameId: entry.frameId,
        stateHashHex: "",
        inlineSnapshotJson: "",
        stateHashVersion: SIMULATION_STATE_VERSION,
      };
      BackendWS.send(Request.toBinary({
        payload: { blank: request, oneofKind: "blank" }
      }));
    }
  }

  private createOperationBase(col: number, row: number): RequestGridOperation {
    const currentFrameId = BackendWS.GetFrameID();
    const processFrameId = currentFrameId + this.getCommandDelayFrames();

    return {
      base: {
        frameId: currentFrameId,
        ackFrameId: BackendWS.AckFrameID,
        stateHash: 0,
        hashFrameId: 0,
        stateHashHex: "",
        inlineSnapshotJson: "",
        stateHashVersion: SIMULATION_STATE_VERSION,
      },
      col,
      row,
      processFrameId,
      clientOpSeq: ++this.clientOpSeq
    };
  }

  private getCommandDelayFrames(): number {
    const { sendLatencyMs, receiveLatencyMs } = BackendWS.getDebugLatencyConfig();
    const roundTripLatencyMs = sendLatencyMs + receiveLatencyMs;
    const networkDelayFrames = Math.ceil(roundTripLatencyMs / this.getFrameIntervalMs());

    return networkDelayFrames + this.commandLeadFrames;
  }

  /** @returns 本次操作的 client_op_seq，用于关联服务端失败回包和撤销预测。 */
  public sendCardPlant(pid: number, col: number, row: number, level: number, cost: number): number {
    const base = this.createOperationBase(col, row);
    desyncDiagnostics.record("sync", "sendCardPlant", {
      pid,
      col,
      row,
      level,
      cost,
      clientOpSeq: base.clientOpSeq,
      frameId: base.base?.frameId,
      ackFrameId: base.base?.ackFrameId,
      processFrameId: base.processFrameId,
    });

    const request: RequestCardPlant = {
      base,
      pid,
      level,
      cost,
      energySum: ResourceManager.Instance.getEnergy('mine'),
      starShardsSum: ResourceManager.Instance.getStarShards('mine'),
    };
    this.queues.push({
      payload: {
        plant: request,
        oneofKind: "plant"
      }
    });
    return base.clientOpSeq;
  }

  public sendRemovePlant(pid: number, col: number, row: number): number {
    const base = this.createOperationBase(col, row);
    desyncDiagnostics.record("sync", "sendRemovePlant", {
      pid,
      col,
      row,
      clientOpSeq: base.clientOpSeq,
      frameId: base.base?.frameId,
      ackFrameId: base.base?.ackFrameId,
      processFrameId: base.processFrameId,
    });

    const request: RequestRemovePlant = {
      base,
      pid
    };
    this.queues.push({
      payload: {
        removePlant: request,
        oneofKind: "removePlant"
      }
    });
    return base.clientOpSeq;
  }

  public sendStarShards(pid: number, col: number, row: number, cost: number): number {
    const base = this.createOperationBase(col, row);
    desyncDiagnostics.record("sync", "sendStarShards", {
      pid,
      col,
      row,
      cost,
      clientOpSeq: base.clientOpSeq,
      frameId: base.base?.frameId,
      ackFrameId: base.base?.ackFrameId,
      processFrameId: base.processFrameId,
    });

    const currentStarShards = ResourceManager.Instance.getStarShards('mine');

    const request: RequestStarShards = {
      base,
      pid,
      cost,
      energySum: ResourceManager.Instance.getEnergy('mine'),
      starShardsSum: currentStarShards
    };
    this.queues.push({
      payload: {
        starShards: request,
        oneofKind: "starShards"
      }
    });
    return base.clientOpSeq;
  }

  public sendBlankFrame(frameId: number) {
    const now = Date.now();
    desyncDiagnostics.record("sync", "sendBlankFrame", {
      frameId,
      ackFrameId: BackendWS.AckFrameID,
    });
    const request: RequestBlank = {
      frameId,
      ackFrameId: BackendWS.AckFrameID,
      stateHash: 0,
      hashFrameId: 0,
      stateHashHex: "",
      inlineSnapshotJson: "",
      stateHashVersion: SIMULATION_STATE_VERSION,
    };
    // console.log("[QueueSend] queue blank frame", {
    //   frameId,
    //   ackFrameId: request.ackFrameId,
    //   lastBlankAckFrameIdSent: this.lastBlankAckFrameIdSent,
    //   lastBlankAckFrameIdQueued: this.lastBlankAckFrameIdQueued
    // });
    this.queues.push({
      payload: {
        blank: request,
        oneofKind: "blank"
      }
    });
    this.lastBlankAckFrameIdQueued = request.ackFrameId;
    this.lastBlankQueuedAt = now;
  }

  public ensureBlankFrame(frameId: number) {
    const now = Date.now();
    const ackFrameId = BackendWS.AckFrameID;
    const hasQueuedSameAck = ackFrameId === this.lastBlankAckFrameIdQueued;
    const hasSentSameAckRecently = ackFrameId === this.lastBlankAckFrameIdSent
      && now - this.lastBlankSentAt < this.getFrameIntervalMs();
    const hasQueuedSameAckRecently = hasQueuedSameAck
      && now - this.lastBlankQueuedAt < this.getFrameIntervalMs();

    if (hasSentSameAckRecently || hasQueuedSameAckRecently) {
      console.log("[QueueSend] skip duplicate blank", {
        frameId,
        ackFrameId,
        lastBlankAckFrameIdSent: this.lastBlankAckFrameIdSent,
        lastBlankAckFrameIdQueued: this.lastBlankAckFrameIdQueued,
        msSinceLastBlankSent: now - this.lastBlankSentAt,
        msSinceLastBlankQueued: now - this.lastBlankQueuedAt
      });
      return;
    }
    console.log("[QueueSend] ensure blank frame", {
      frameId,
      ackFrameId
    });
    this.sendBlankFrame(frameId);
  }

  private refreshAckFrameId(request: Request): Request {
    switch (request.payload.oneofKind) {
      case "blank":
        request.payload.blank.ackFrameId = BackendWS.AckFrameID;
        break;
      case "plant":
        if (request.payload.plant.base?.base) {
          request.payload.plant.base.base.ackFrameId = BackendWS.AckFrameID;
        }
        break;
      case "removePlant":
        if (request.payload.removePlant.base?.base) {
          request.payload.removePlant.base.base.ackFrameId = BackendWS.AckFrameID;
        }
        break;
      case "starShards":
        if (request.payload.starShards.base?.base) {
          request.payload.starShards.base.base.ackFrameId = BackendWS.AckFrameID;
        }
        break;
      default:
        break;
    }
    return request;
  }

  private getFrameIntervalMs(): number {
    const frameIntervalMs = this.frameIntervalMsProvider();
    return Number.isFinite(frameIntervalMs) && frameIntervalMs > 0
      ? frameIntervalMs
      : LEGACY_BALANCE_FRAME_INTERVAL_MS;
  }
}
