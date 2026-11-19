import { Game } from "../scenes/Game";
import { GameParams } from "../models/GameParams";
import type { StageData } from "../../types/stage";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import { BaseManager } from "./BaseManager";
import { EventBus } from "../../utils/eventBus";
import SyncManager from "./combat/SyncManager";
import TickerManager from "./combat/TickerManager";
import { BaseEntity } from "../models/core/BaseEntity";
import { DeferredManager } from "./DeferredManager";
import type { DeferredCommand } from "./DeferredManager";
import { onlineStateManager } from "../../store/OnlineStateManager";
import { RoomAllReadyEvent } from "../../types/online";
import BackendWS from "../../utils/net/sync";
import CardpileManager from "./combat/CardpileManager";
import ResourceManager from "./combat/ResourceManager";
import {
  simulationState,
  SimulationState,
  serializeSimulationState,
  SIMULATION_STATE_VERSION,
} from "../core/SimulationState";
import { resolveEntityBySnapshotId } from "../core/EntityLookup";
import { SnapshotRingBuffer } from "../core/SnapshotRingBuffer";
import { logicEvents } from "../core/logic/LogicEvents";
import { setAuthoritativeFrame, updateAllTickManagers } from "../core/logic/EntityTickManager";
import { buildInlineSnapshotOrHash } from "../core/snapshot/InlineSnapshot";
import { restoreInlineSnapshot } from "../core/snapshot/InlineSnapshot";
import type { InlineSnapshot } from "../core/snapshot/InlineSnapshot";
import { desyncDiagnostics } from "../../utils/debug/desyncDiagnostics";
import { perfSampler } from "../../utils/debug/perfSampler";

// 单次 update 允许接受的最大 delta（切后台/断点会产生数秒级 delta）
const MAX_FRAME_DELTA_MS = 250;
// 累积时间上限：超出视为网络或后台积压，丢弃多余部分，避免长时间追帧
const MAX_ELAPSED_FRAME_TIME_MS = 1000;
// 单个渲染帧内最多推进的逻辑步数，防止主线程假死
const MAX_STEPS_PER_UPDATE = 4;

export type CombatStatus = {
  dayOrNight: boolean; // day = true
}

type CombatManagerEventType = {
  onCombatPause: () => void;
  onCombatResume: () => void;
  onCombatEnd: (isWin: boolean) => void;
}

export default class CombatManager extends BaseManager {
  private static _instance: CombatManager;
  protected scene: Game | null = null;

  Eventbus: EventBus<CombatManagerEventType>;

  public params: GameParams | null = null;
  public seed: number = 0;
  public stageData: StageData | null = null;
  public combatStatus: CombatStatus = {
    dayOrNight: true,
  };

  private _isPaused = true; // Whether combat is paused.
  private isInFixedStep = false;
  private pendingPausedState: boolean | null = null;
  isGameEnd: boolean = true;
  private isEndGameRequested: boolean = false;
  private readonly handleRoomAllReady = (data: RoomAllReadyEvent) => {
    this.seed = data.seed;
    desyncDiagnostics.record("combat", "RoomAllReady", data);
  };

  /**
   * 服务端判定分叉后，战斗层保留当前世界转入离线单机；
   * 日志下载由 handlers.ts 在事件后立即触发，这里只切换状态。
   */
  private readonly handleDesyncOfflineMode = (payload: { message?: string } = {}) => {
    const reason = payload?.message ?? "unknown desync";
    desyncDiagnostics.record("combat", "DesyncOfflineMode", {
      reason,
      frameId: SyncManager.Instance.recvQueue?.currentFrameId ?? null,
      ackFrameId: SyncManager.Instance.recvQueue?.lastAckFrameId ?? null,
    });
    this.enterDesyncOfflineMode(reason);
  };

  // Accumulated frame time for fixed-step simulation.
  elapsedFrameTime: number = 0;

  /** 每 20 个逻辑帧采样一次状态哈希（联机分叉检测使用）。 */
  public static readonly STATE_HASH_INTERVAL_FRAMES = 20;
  public lastStateHash: string | null = null;
  public lastStateHashFrame: number = 0;

  /** 环形快照：用于分叉恢复、断线恢复与确定性自检。 */
  public static readonly SNAPSHOT_INTERVAL_FRAMES = 10;
  /** checkpoint 低频上报：10 帧采样用于检测，200 帧才构造 inline 快照。 */
  public static readonly CHECKPOINT_INTERVAL_FRAMES = 200;
  public static readonly SNAPSHOT_RING_SIZE = 20;
  private snapshotRing = new SnapshotRingBuffer<{ frameId: number; state: SimulationState }>(
    CombatManager.SNAPSHOT_RING_SIZE,
  );
  private lastRestoreReport: ReturnType<typeof simulationState.restore> | null = null;
  private deferredCommandsBeforeRestore: DeferredCommand[] = [];
  private desyncOffline = false;
  private desyncReason = "";
  private desyncLogExported = false;
  private lastCheckpointFrame = 0;
  /**
   * 同一固定步内可能同时触发 hash 采样、快照记录、checkpoint。
   * 这三者之间没有任何状态变更，共享一次 capture 可避免重复构造完整状态。
   */
  private readonly frameStateCache = new Map<string, SimulationState>();

  /** 进行中的确定性自检（回滚-重放）任务。 */
  private pendingDeterminismCheck: { targetFrame: number; expectedHash: string; restoreFrame: number } | null = null;

  constructor() {
    super();
    this.Eventbus = new EventBus<CombatManagerEventType>();
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  public set isPaused(value: boolean) {
    if (!value) {
      this.pendingPausedState = null;
    }
    if (value && this.isInFixedStep) {
      this.pendingPausedState = value;
      return;
    }
    this.applyPausedState(value);
  }

  private applyPausedState(value: boolean) {
    if (this._isPaused === value) {
      return;
    }
    this._isPaused = value;
    if (value) {
      this.Eventbus.emit("onCombatPause");
    } else {
      this.Eventbus.emit("onCombatResume");
    }
  }

  private commitPendingPausedState() {
    if (this.pendingPausedState === null) {
      return;
    }
    const pausedState = this.pendingPausedState;
    this.pendingPausedState = null;
    this.applyPausedState(pausedState);
  }

  Load(): void {
    // Listen for pause toggles.
    PhaserEventBus.on(PhaserEvents.TogglePause, this.handleTogglePause, this);
    PhaserEventBus.on(PhaserEvents.TimespeedToggle, this.handleTimespeedToggle, this);

    SyncManager.Instance.recvQueue?.setLateOperationRollback(this.rollbackForLateOperation);

    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    PhaserEventBus.on(PhaserEvents.RoomGameEnd, this.handleRoomGameEnd, this);

    PhaserEventBus.on(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    PhaserEventBus.on(PhaserEvents.ReplaySnapshotReceived, this.handleReplaySnapshot, this);
    PhaserEventBus.on(PhaserEvents.SnapshotRequested, this.handleSnapshotRequest, this);
    PhaserEventBus.on(PhaserEvents.DesyncOfflineMode, this.handleDesyncOfflineMode, this);
    desyncDiagnostics.setStateProvider(() => this.buildDesyncDiagnosticState());
    const roomAllReady = onlineStateManager.getRoomAllReady();
    if (roomAllReady) {
      this.handleRoomAllReady(roomAllReady);
    }
  }

  public static get Instance(): CombatManager {
    if (!this._instance) {
      this._instance = new CombatManager();
    }
    return this._instance;
  }

  public Reset() {
    desyncDiagnostics.record("combat", "Reset", {
      seed: this.seed,
      frameId: SyncManager.Instance.recvQueue?.currentFrameId ?? null,
    });
    SyncManager.Instance.recvQueue?.setLateOperationRollback(null);
    PhaserEventBus.off(PhaserEvents.TogglePause, this.handleTogglePause, this);
    PhaserEventBus.off(PhaserEvents.TimespeedToggle, this.handleTimespeedToggle, this);
    PhaserEventBus.off(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    PhaserEventBus.off(PhaserEvents.RoomGameEnd, this.handleRoomGameEnd, this);
    PhaserEventBus.off(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    PhaserEventBus.off(PhaserEvents.ReplaySnapshotReceived, this.handleReplaySnapshot, this);
    PhaserEventBus.off(PhaserEvents.SnapshotRequested, this.handleSnapshotRequest, this);
    PhaserEventBus.off(PhaserEvents.DesyncOfflineMode, this.handleDesyncOfflineMode, this);
    desyncDiagnostics.setStateProvider(null);

    if (this.scene) {
      this.scene.time.timeScale = 1;
    }
    this.scene = null;
    this.params = null;
    this.seed = 0;
    this.stageData = null;
    this.elapsedFrameTime = 0;
    this.pendingPausedState = null;
    this.isInFixedStep = false;
    this.isPaused = true;
    this.isGameEnd = true;
    this.isEndGameRequested = false;
    this.lastStateHash = null;
    this.lastStateHashFrame = 0;
    this.snapshotRing.clear();
    this.frameStateCache.clear();
    this.pendingDeterminismCheck = null;
    this.lastRestoreReport = null;
    this.desyncOffline = false;
    this.desyncReason = "";
    this.desyncLogExported = false;
    this.Eventbus.removeAllListeners();
    this.combatStatus = {
      dayOrNight: true,
    };
  }

  // Local active game over.
  public EndGame(isWin: boolean) {
    if (this.isGameEnd || this.isEndGameRequested) {
      return;
    }
    this.isEndGameRequested = true;
    if (this.desyncOffline) {
      this.isGameEnd = true;
      this.isPaused = true;
      this.exportDesyncLog();
      this.Eventbus.emit("onCombatEnd", isWin);
      return;
    }
    SyncManager.Instance.sendQueue.sendGameEnd(isWin ? 1 : 0);
    SyncManager.Instance.sendQueue.Consume();
  }

  private handleTogglePause() {
    if (BackendWS.isOnlineMode() && !this.desyncOffline) return;
    if (this.isGameEnd) return;
    this.isPaused = !this._isPaused;
  }

  // All players are ready.
  private handleRoomGameStart() {
    const stageData = this.scene?.stageData;
    if (!stageData) {
      console.error("No stage data found for the game start event.");
      return;
    }
    if (this.scene) {
      this.scene.time.timeScale = 1;
    }
    this.elapsedFrameTime = 0;
    this.isGameEnd = false;
    this.isEndGameRequested = false;
    this.isPaused = false;
    this.snapshotRing.clear();
    this.frameStateCache.clear();
    this.pendingDeterminismCheck = null;
    this.lastStateHash = null;
    this.lastStateHashFrame = 0;
    desyncDiagnostics.record("combat", "RoomGameStart", {
      seed: this.seed,
      stageLevel: this.scene?.params?.level ?? null,
      frameId: SyncManager.Instance.recvQueue?.currentFrameId ?? null,
      tickerFrame: TickerManager.Instance.currentFrame,
      roomAllReady: onlineStateManager.getRoomAllReady(),
    });
  }

  /** 重连补帧：恢复 checkpoint 快照并回滚接收队列到该帧。 */
  private handleReplaySnapshot = ({ snapshot, frameId }: { snapshot: InlineSnapshot; frameId: number }) => {
    // 同进程重连（网络闪断）：本地世界仍在 checkpoint 之后正常运行，此时若
    // 无条件回滚到 checkpoint，会把已经执行的帧撤销；而 socket open 时上报的
    // 旧进度 ACK 又已被服务端单调接收，服务端从此只补发“旧 ACK+1”，
    // 跳过 checkpoint+1..旧ACK，客户端会永久冻结在 checkpoint。
    // 只有本地进度确实落后/等于 checkpoint（页面刷新后的新进程）才需要恢复快照。
    const localFrame = SyncManager.Instance.recvQueue?.currentFrameId ?? 0;
    if (localFrame > frameId) {
      desyncDiagnostics.record("combat", "replay snapshot skipped (local ahead)", {
        checkpointFrame: frameId,
        localFrame,
      });
      console.log(`[reconnect] 本地进度 ${localFrame} 已超过 checkpoint ${frameId}，跳过快照恢复，按 ACK 续帧`);
      return;
    }
    try {
      const state = restoreInlineSnapshot(snapshot);
      state.frameId = frameId;
      const report = this.restoreState(state, "rebuild");
      BackendWS.getReceiveQueue()?.restoreToFrame(frameId);
      // 旧环形快照可能来自恢复前已经分叉的分支，不能再用于后续回滚。
      this.snapshotRing.clear();
      this.frameStateCache.clear();
      this.lastCheckpointFrame = 0;
      // 恢复后的摘要必须与服务端转发的快照摘要一致；不一致说明有状态源
      // 没有正确恢复，继续补帧会立刻分叉，先把问题暴露在控制台。
      const restoredHash = simulationState.hash();
      if (snapshot.hash && restoredHash.h32 !== snapshot.hash) {
        desyncDiagnostics.record("reconnect", "snapshot hash mismatch", {
          frameId,
          snapshotHash: snapshot.hash,
          restoredHash: restoredHash.h32,
          report,
        });
        console.warn(`[reconnect] 快照恢复摘要不一致 frame=${frameId}`);
      }
      desyncDiagnostics.record("reconnect", "snapshot restored", { frameId, report });
    } catch (error) {
      console.warn("[reconnect] checkpoint 快照恢复失败", error);
    }
  };

  /** 服务端请求快照：把当前确定性状态回传，供其他玩家重连恢复。 */
  private handleSnapshotRequest = ({ requestId }: { requestId: number }) => {
    const snapshot = this.captureCheckpoint();
    if (!snapshot || !snapshot.payload) {
      return;
    }
    let inlineSnapshotJson = "";
    try {
      inlineSnapshotJson = JSON.stringify(snapshot.payload);
    } catch (error) {
      desyncDiagnostics.record("combat", "snapshotRequest serialize failed", { requestId, error });
      return;
    }
    SyncManager.Instance.sendQueue?.sendSnapshotResponse(requestId, snapshot.frameId, inlineSnapshotJson);
  };

  private handleRoomGameEnd({ isWin }: { isWin: boolean }) {
    this.isGameEnd = true;
    this.isPaused = true;
    this.Eventbus.emit("onCombatEnd", isWin);
  }

  // 切换游戏速度（1速/2速）
  public handleTimespeedToggle(): boolean {
    // 真实联机无效（即使 UI 被绕过也不会变速）；联机分叉后的离线单机仍可本地倍速。
    // 暂停/结算时也不允许；额外锁定在线房间会话中的 mock 房间。
    if ((BackendWS.isOnlineMode() && !this.desyncOffline) || this.isPaused || this.isGameEnd) return false;
    if (!this.scene) return false;

    const previousTimeScale = this.scene.time.timeScale;
    const nextTimeScale = previousTimeScale > 1 ? 1 : 2; // 只在 1 速 / 2 速间切换
    const didToggle = previousTimeScale !== nextTimeScale;
    if (!didToggle) return false;

    // 修改 GameScene 时钟快慢，驱动 update 里的 elapsedFrameTime 增长速度
    this.scene.time.timeScale = nextTimeScale;
    PhaserEventBus.emit(PhaserEvents.TimespeedChanged, { timeScale: nextTimeScale });
    return true;
  }

  public update(time: number, delta: number) {
    // 等待权威帧时固定步会停摆；网络状态必须在每个渲染帧更新，否则
    // “恢复同步 → 锁住等待 UI” 的状态会一直保留到下一帧到来或永远不消失。
    SyncManager.Instance.updateNetworkWaiting(delta);
    this.scene?.renderUpdateEntityViews(delta, this.isPaused);
    if (this.isPaused) {
      this.elapsedFrameTime = 0;
      return;
    }

    // 浏览器切后台/断点调试会产生超大 delta，直接全量塞入会引发追帧风暴。
    // 这里同时限制单次接受的 delta 与总积压，超出部分丢弃并依靠补帧追赶。
    const timeScale = this.scene?.time?.timeScale ?? 1;
    const clampedDelta = Math.min(delta * timeScale, MAX_FRAME_DELTA_MS);
    this.elapsedFrameTime = Math.min(
      this.elapsedFrameTime + clampedDelta,
      MAX_ELAPSED_FRAME_TIME_MS,
    );

    let steps = 0;
    // Fixed-step physics update.
    while (
      this.elapsedFrameTime >= SyncManager.Instance.frameIntervalMs &&
      steps < MAX_STEPS_PER_UPDATE
    ) {
      steps += 1;
      this.isInFixedStep = true;
      // 在进入下一次 Rapier step 前再执行延迟创建/销毁，
      // 避免在 world.step / bodies.forEach 相关借用期间修改物理世界。
      DeferredManager.Instance.flush();

      const syncStarted = perfSampler.now();
      const frameReady = SyncManager.Instance.update();
      perfSampler.record("sync.update", perfSampler.now() - syncStarted);

      if (!frameReady) {
        this.isInFixedStep = false;
        break;
      }
      const frameId = SyncManager.Instance.recvQueue.currentFrameId;
      desyncDiagnostics.recordFrame({
        phase: "begin",
        frameId,
        tickerFrame: TickerManager.Instance.currentFrame,
        elapsedFrameTime: this.elapsedFrameTime,
        isPaused: this._isPaused,
        isGameEnd: this.isGameEnd,
      });
      this.elapsedFrameTime -= SyncManager.Instance.frameIntervalMs;
      // 一次性表现事件绑定逻辑帧号；回滚后由快照恢复队列与 eventId。
      logicEvents.setFrame(SyncManager.Instance.recvQueue.currentFrameId);
      // Tick-based systems.
      if (!this.isPaused) {
        TickerManager.Instance.Update();
        updateAllTickManagers(
          TickerManager.Instance.currentFrame,
          TickerManager.Instance.frameInterval,
        );
        // 权威操作在本帧消费后立即创建实体，保证“操作帧 = 实体存在帧”。
        // 新实体在 updateAllTickManagers 之后创建，计时器以当前帧为起点，
        // 不会在同一帧被额外 tick 一次；两端也都在同一逻辑帧末看到相同实体集合。
        DeferredManager.Instance.flush();
        CardpileManager.Instance.applyPendingOwnProfile(frameId);
        CardpileManager.Instance.stepUpdate();
        ResourceManager.Instance.applyPendingResourceProfiles(frameId);
      }

      // Physics-step systems.
      if (!this.isPaused) {
        this.scene?.rapierWorld?.step(this.scene.rapierEventQueue);
        // Drain collision events.
        this.scene?.rapierEventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
          if (started) {
            this.scene?.handleCollision(handle1, handle2);
          }
        });

        // Sync entity logical positions from physics bodies.
        this.scene?.rapierWorld?.bodies.forEach(rigidBody => {
          const position = rigidBody.translation();
          const gameObject = rigidBody.userData;
          if (gameObject instanceof BaseEntity) {
            gameObject.stepUpdate();
            gameObject.updateView(position);
          }
        });
      }

      this.isInFixedStep = false;
      const hashStarted = perfSampler.now();
      this.sampleStateHash();
      perfSampler.record("sampleStateHash", perfSampler.now() - hashStarted);
      const diagnosticStarted = perfSampler.now();
      this.captureDiagnosticFrame();
      perfSampler.record("captureDiagnosticFrame", perfSampler.now() - diagnosticStarted);
      const snapshotStarted = perfSampler.now();
      this.recordSnapshotIfNeeded();
      perfSampler.record("recordSnapshotIfNeeded", perfSampler.now() - snapshotStarted);
      this.finishDeterminismCheckIfNeeded();
      this.commitPendingPausedState();
      if (this.isPaused) {
        this.elapsedFrameTime = 0;
        break;
      }
    }

    // 渲染插值必须每个渲染帧都执行：等待权威帧/追帧时固定步可能停摆，
    // 若在这里跳过，实体会冻结在上一帧位置并出现跳变；Tween/动画却仍在
    // 渲染帧更新，所以箭矢会显得比特效明显卡顿。
    if (!this.isPaused) {
      const interpolationAlpha = Math.min(
        this.elapsedFrameTime / SyncManager.Instance.frameIntervalMs,
        1,
      );
      this.scene?.rapierWorld?.bodies.forEach(rigidBody => {
        const gameObject = rigidBody.userData;
        if (gameObject instanceof BaseEntity) {
          gameObject.stepMove(interpolationAlpha);
        }
      });
    }

    SyncManager.Instance.sendQueue.Consume();
  }

  /**
   * 同一固定步内的 state capture 共享入口。
   * 只缓存当前 frameId 的结果；快照对象不可变，回滚/接收端恢复不会写回它。
   */
  private captureFrameState(): SimulationState {
    const frameId = SyncManager.Instance.recvQueue?.currentFrameId ?? 0;
    const key = String(frameId);
    const cached = this.frameStateCache.get(key);
    if (cached) return cached;
    const state = this.captureState();
    this.frameStateCache.clear();
    this.frameStateCache.set(key, state);
    return state;
  }

  /** 供联机分叉检测 / 断线恢复使用：收集当前完整确定性状态。 */
  public captureState(): SimulationState {
    return simulationState.capture();
  }

  /**
   * 回滚环中的快照必须与运行时对象彻底解耦。restoreState("in-place") 会把
   * 快照里的 JsonValue 容器直接写回实体/管理器；如果环里保存的是 capture
   * 时的同一对象引用，第一次回滚重放就会改写旧快照，后续回滚必然字段错位。
   * 这里只在低频快照记录路径做 JSON 往返。
   */
  private static cloneSnapshotState(state: SimulationState): SimulationState {
    return JSON.parse(serializeSimulationState(state)) as SimulationState;
  }

  public serializeState(): string {
    return serializeSimulationState(this.captureState());
  }

  /** 供断线重连 / 分叉恢复使用：恢复收集器覆盖的全部状态源。 */
  public restoreState(state: SimulationState, mode: "in-place" | "rebuild" = "in-place") {
    // 快照恢复前清空延迟队列：否则旧世界排队中的创建/销毁会在恢复后
    // 才执行，凭空多出实体或删掉快照中的实体。
    const pendingDeferred = DeferredManager.Instance.TakePending();
    DeferredManager.Instance.Reset();
    // 实体重建发生在 simulationState.restore 内部；先锚定快照帧，
    // 让重建实体在 onCreate 里创建的计时器以快照帧为起点，
    // 而不是沿用恢复前的旧帧（否则重连后第一批 timer 立刻错位）。
    setAuthoritativeFrame(state.frameId);
    TickerManager.Instance.currentFrame = state.frameId;
    const report = simulationState.restore(state, {
      mode,
      resolveEntity: resolveEntityBySnapshotId,
    });
    this.lastRestoreReport = report;
    if (!report.ok || report.missing.length > 0 || report.errors.length > 0) {
      console.warn("[CombatManager] restoreState incomplete", {
        ok: report.ok,
        missing: report.missing,
        errors: report.errors,
      });
    }
    this.lastStateHash = null;
    this.lastStateHashFrame = 0;
    this.deferredCommandsBeforeRestore = pendingDeferred;
    return report;
  }

  /** 最近一次恢复的诊断结果，供自检/联机恢复策略判定是否可继续模拟。 */
  public getRestoreReport(): ReturnType<typeof simulationState.restore> | null {
    return this.lastRestoreReport;
  }

  /** 每个逻辑帧结束后按固定间隔记录快照。 */
  private recordSnapshotIfNeeded(): void {
    const frameId = SyncManager.Instance.recvQueue.currentFrameId;
    if (frameId <= 0 || frameId % CombatManager.SNAPSHOT_INTERVAL_FRAMES !== 0) return;
    const latest = this.snapshotRing.last();
    if (latest?.frameId === frameId) return;

    // 快照必须落在干净的帧边界：先执行完延迟创建/销毁。
    DeferredManager.Instance.flush();
    // 快照需要独立对象：同一帧的 h32/checkpoint 会交给服务端，不能共享引用。
    const state = CombatManager.cloneSnapshotState(this.captureState());
    this.snapshotRing.push({ frameId, state });
    desyncDiagnostics.record("combat", "snapshot recorded", {
      frameId,
      ringFrames: this.getSnapshotRingFrameIds(),
      entityCount: state.entities.length,
      timerCount: state.timers.ticker?.length ?? 0,
    });
  }

  public getSnapshotAtOrBefore(frameId: number): { frameId: number; state: SimulationState } | null {
    for (let i = this.snapshotRing.size - 1; i >= 0; i--) {
      const entry = this.snapshotRing.get(i);
      if (entry && entry.frameId <= frameId) return entry;
    }
    return null;
  }

  public getSnapshotRingFrameIds(): number[] {
    return this.snapshotRing.toArray().map((entry) => entry.frameId);
  }

  /**
   * 回滚到指定帧（取不晚于该帧的最近快照），并重新注入之后的已消费帧。
   * 返回 null 表示环内没有可用快照。
   */
  public rollbackToFrame(frameId: number) {
    const entry = this.getSnapshotAtOrBefore(frameId);
    if (!entry) return null;
    const report = this.restoreState(entry.state, "in-place");
    SyncManager.Instance.recvQueue.restoreToFrame(entry.frameId);
    DeferredManager.Instance.RestorePending(this.deferredCommandsBeforeRestore);
    this.deferredCommandsBeforeRestore = [];
    return { frameId: entry.frameId, report };
  }

  /** 迟到权威操作：回滚到可重放的历史帧，再把已消费帧按顺序重新执行。 */
  private rollbackForLateOperation = (processFrameId: number): boolean => {
    const targetFrame = Math.max(0, processFrameId - 1);
    const result = this.rollbackToFrame(targetFrame);
    desyncDiagnostics.record("sync", "late operation rollback result", {
      targetFrame,
      processFrameId,
      restoredFrame: result?.frameId ?? null,
      ok: result?.report.ok ?? false,
    });
    return result !== null && result.report.ok;
  };

  public clearSnapshotRing(): void {
    this.snapshotRing.clear();
    this.frameStateCache.clear();
  }

  /** 当前完整状态的 64 位摘要。 */
  public hashState(): string {
    return simulationState.hash().h64;
  }

  /** 分叉后不再等待权威帧；保留当前世界，按单机固定步继续模拟。 */
  public enterDesyncOfflineMode(reason: string): void {
    if (this.desyncOffline) return;
    desyncDiagnostics.record("combat", "enterDesyncOfflineMode", {
      reason,
      frameId: SyncManager.Instance.recvQueue?.currentFrameId ?? null,
      ackFrameId: SyncManager.Instance.recvQueue?.lastAckFrameId ?? null,
      tickerFrame: TickerManager.Instance.currentFrame,
      isPaused: this._isPaused,
      isGameEnd: this.isGameEnd,
    });
    this.desyncOffline = true;
    this.desyncReason = reason;
    this.isEndGameRequested = false;
    this.isPaused = false;
    this.snapshotRing.clear();
    this.frameStateCache.clear();
    this.pendingDeterminismCheck = null;
  }

  public isDesyncOffline(): boolean {
    return this.desyncOffline;
  }

  public getDesyncReason(): string {
    return this.desyncReason;
  }

  /** 分叉日志：立即下载一次；结算时不会重复下载。 */
  public exportDesyncLog(): void {
    if (!desyncDiagnostics.isEnabled()) return;
    if (!this.desyncOffline || this.desyncLogExported) return;
    this.desyncLogExported = true;
    desyncDiagnostics.downloadOnce("desync-offline", {
      reason: this.desyncReason,
      report: this.buildDesyncDiagnosticState(),
    });
  }

  /** netDebug 正常结算/主动退出时导出完整战斗日志。 */
  public exportNetDebugLog(reason: string): void {
    if (!desyncDiagnostics.isEnabled()) return;
    desyncDiagnostics.downloadOnce(`netdebug-${reason}`, {
      reason,
      report: this.buildDesyncDiagnosticState(),
    });
  }

  /** 供临时诊断日志下载使用：汇总当前确定性状态与联机会话信息。 */
  public buildDesyncDiagnosticState(): Record<string, unknown> {
    let state: SimulationState | null = null;
    let hash: ReturnType<typeof simulationState.hash> | null = null;
    let captureError: string | null = null;
    try {
      state = this.captureState();
      hash = simulationState.hash(state);
    } catch (error) {
      captureError = String(error);
    }

    const roomInfo = onlineStateManager.getRoomInfo();
    return {
      seed: this.seed,
      roomId: roomInfo.roomId,
      myId: roomInfo.myId,
      lordId: roomInfo.lordId,
      stageLevel: this.scene?.params?.level ?? null,
      frameId: SyncManager.Instance.recvQueue?.currentFrameId ?? null,
      lastAckFrameId: SyncManager.Instance.recvQueue?.lastAckFrameId ?? null,
      tickerFrame: TickerManager.Instance.currentFrame,
      tickerNextTimerId: TickerManager.Instance.getNextTimerId(),
      isPaused: this._isPaused,
      isGameEnd: this.isGameEnd,
      desyncOffline: this.desyncOffline,
      desyncReason: this.desyncReason,
      lastStateHash: this.lastStateHash,
      lastStateHashFrame: this.lastStateHashFrame,
      stateHashVersion: SIMULATION_STATE_VERSION,
      hash,
      state,
      captureError,
      snapshotRingFrames: this.getSnapshotRingFrameIds(),
      lastRestoreReport: this.lastRestoreReport,
      roomAllReady: onlineStateManager.getRoomAllReady(),
      roomSyncPlayers: onlineStateManager.getRoomSyncPlayers(),
      timerStates: TickerManager.Instance.GetTimerStates(),
      serverLogUrl: this.buildServerLogUrl(),
    };
  }

  private buildServerLogUrl(): string | null {
    const url = BackendWS.url;
    const roomId = onlineStateManager.getRoomInfo().roomId;
    if (!url || roomId < 0) return null;
    try {
      const parsed = new URL(url);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      parsed.pathname = "/debug/desync-log";
      parsed.search = `?room=${roomId}`;
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  }

  /**
   * 确定性自检：回滚到最近的旧快照，再依靠回放日志重放到当前帧，
   * 最后比对哈希。用于在真实战局中验证所有实体/计时器是否可完整恢复。
   * @returns 是否成功启动；结果通过 PhaserEvents.DeterminismSelfCheckResult 异步返回。
   */
  public startDeterminismSelfCheck(): boolean {
    if (this.pendingDeterminismCheck) return false;
    const currentFrame = SyncManager.Instance.recvQueue.currentFrameId;
    const entry = this.getSnapshotAtOrBefore(currentFrame - 1);
    if (!entry) return false;

    const distance = currentFrame - entry.frameId;
    if (distance < 5 || distance > CombatManager.SNAPSHOT_INTERVAL_FRAMES * CombatManager.SNAPSHOT_RING_SIZE) {
      return false;
    }

    this.pendingDeterminismCheck = {
      targetFrame: currentFrame,
      expectedHash: simulationState.hash(this.captureFrameState()).h64,
      restoreFrame: entry.frameId,
    };
    this.rollbackToFrame(entry.frameId);
    return true;
  }

  private finishDeterminismCheckIfNeeded(): void {
    const check = this.pendingDeterminismCheck;
    if (!check) return;
    const currentFrame = SyncManager.Instance.recvQueue.currentFrameId;
    if (currentFrame < check.targetFrame) return;

    this.pendingDeterminismCheck = null;
    const actualHash = simulationState.hash(this.captureFrameState()).h64;
    PhaserEventBus.emit(PhaserEvents.DeterminismSelfCheckResult, {
      ok: actualHash === check.expectedHash,
      restoreFrame: check.restoreFrame,
      targetFrame: check.targetFrame,
      expectedHash: check.expectedHash,
      actualHash,
    });
  }

  private sampleStateHash(): void {
    const frameId = SyncManager.Instance.recvQueue.currentFrameId;
    if (frameId <= 0 || frameId % CombatManager.STATE_HASH_INTERVAL_FRAMES !== 0) return;
    if (frameId === this.lastStateHashFrame) return;
    // 单机 mock 会话没有真正的跨端分叉检测；建立检查点属于调试功能，
    // 由 ConsoleCmd 显式触发，避免低频 capture/序列化造成周期性卡顿。
    if (BackendWS.isMockRoomMode()) return;
    try {
      const state = this.captureFrameState();
      const hash = simulationState.hash(state);
      this.lastStateHash = hash.h64;
      this.lastStateHashFrame = frameId;
      // 协议必需的 h32 摘要必须继续上报，否则服务端分叉检测失效；
      // 只有本地日志和事件订阅属于 netDebug 诊断，可关闭。
      if (desyncDiagnostics.isEnabled()) {
        desyncDiagnostics.record("combat", "state hash sample", {
          frameId,
          h32: hash.h32,
          h64: hash.h64,
          tickerFrame: TickerManager.Instance.currentFrame,
        });
        PhaserEventBus.emit(PhaserEvents.SimulationHashSampled, {
          frameId,
          hash: this.lastStateHash,
        });
      }
      // 房间会话下把 32 位摘要随心跳上报，服务端跨端比对以发现分叉
      const hash32 = Number.parseInt(hash.h32, 16) >>> 0;
      if (BackendWS.isRoomSessionMode() && hash32 !== 0) {
        SyncManager.Instance.sendQueue?.sendStateHash(frameId, hash32);
        if (
          BackendWS.isRoomSessionMode()
          && frameId % CombatManager.CHECKPOINT_INTERVAL_FRAMES === 0
          && frameId !== this.lastCheckpointFrame
        ) {
          this.lastCheckpointFrame = frameId;
          const checkpoint = this.captureCheckpoint();
          if (checkpoint) {
            SyncManager.Instance.sendQueue?.sendCheckpoint(checkpoint.frameId, checkpoint.hash, checkpoint.payload);
          }
        }
      }
    } catch {
      // 状态采样失败不应中断锁步推进；后续按周期重试。
    }
  }

  /**
   * 临时诊断：开局逐帧保存，首次种植窗口（205-225）逐帧保存，
   * 其余每 5 帧保存一次。完整状态用于两端日志逐字段 diff。
   */
  private captureDiagnosticFrame(): void {
    const frameId = SyncManager.Instance.recvQueue.currentFrameId;
    if (frameId <= 0) return;
    const shouldCapture = frameId <= 30
      || (frameId >= 205 && frameId <= 225)
      || frameId % 5 === 0;
    if (!shouldCapture) return;

    try {
      desyncDiagnostics.recordFrame({
        phase: "end",
        frameId,
        tickerFrame: TickerManager.Instance.currentFrame,
        tickerNextTimerId: TickerManager.Instance.getNextTimerId(),
        isPaused: this._isPaused,
        isGameEnd: this.isGameEnd,
        lastHashFrame: this.lastStateHashFrame,
        lastHash: this.lastStateHash,
      });
    } catch (error) {
      desyncDiagnostics.record("combat", "captureDiagnosticFrame failed", {
        frameId,
        error,
      });
    }
  }

  /** 低频 checkpoint：只构造不含 Rapier physics 的 inline 状态，避免高频全量序列化。 */
  public captureCheckpoint(): { frameId: number; hash: string; payload: unknown } | null {
    const frameId = SyncManager.Instance.recvQueue?.currentFrameId ?? 0;
    if (frameId <= 0) return null;
    const state = this.captureFrameState();
    const hash = simulationState.hash(state);
    const inline = buildInlineSnapshotOrHash(state, hash.h32);
    return {
      frameId,
      hash: Number.parseInt(hash.h32, 16).toString(16).padStart(8, "0"),
      // 只返回完整 inline 快照；超过体积上限时返回 null，由发送侧放弃上报。
      // 绝不能退化成 { hash }：服务端一旦采纳，重连会从无正文的 checkpoint
      // 之后开始补帧，客户端无法恢复。
      payload: inline.snapshot,
    };
  }
}
