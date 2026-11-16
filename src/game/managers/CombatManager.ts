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
import { onlineStateManager } from "../../store/OnlineStateManager";
import { RoomAllReadyEvent } from "../../types/online";
import BackendWS from "../../utils/net/sync";
import CardpileManager from "./combat/CardpileManager";
import { simulationState, SimulationState, serializeSimulationState } from "../core/SimulationState";
import { resolveEntityBySnapshotId } from "../core/EntityLookup";
import { logicEvents } from "../core/logic/LogicEvents";
import { updateAllTickManagers } from "../core/logic/EntityTickManager";

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
  };

  // Accumulated frame time for fixed-step simulation.
  elapsedFrameTime: number = 0;

  /** 每 20 个逻辑帧采样一次状态哈希（联机分叉检测使用）。 */
  public static readonly STATE_HASH_INTERVAL_FRAMES = 20;
  public lastStateHash: string | null = null;
  public lastStateHashFrame: number = 0;

  /** 环形快照：用于分叉恢复、断线恢复与确定性自检。 */
  public static readonly SNAPSHOT_INTERVAL_FRAMES = 10;
  public static readonly SNAPSHOT_RING_SIZE = 20;
  private snapshotRing: Array<{ frameId: number; state: SimulationState }> = [];
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

    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    PhaserEventBus.on(PhaserEvents.RoomGameEnd, this.handleRoomGameEnd, this);

    PhaserEventBus.on(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
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
    PhaserEventBus.off(PhaserEvents.TogglePause, this.handleTogglePause, this);
    PhaserEventBus.off(PhaserEvents.TimespeedToggle, this.handleTimespeedToggle, this);
    PhaserEventBus.off(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    PhaserEventBus.off(PhaserEvents.RoomGameEnd, this.handleRoomGameEnd, this);
    PhaserEventBus.off(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);

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
    this.snapshotRing = [];
    this.pendingDeterminismCheck = null;
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
    SyncManager.Instance.sendQueue.sendGameEnd(isWin ? 1 : 0);
    SyncManager.Instance.sendQueue.Consume();
  }

  private handleTogglePause() {
    if (BackendWS.isOnlineMode()) return;
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
    this.snapshotRing = [];
    this.pendingDeterminismCheck = null;
    this.lastStateHash = null;
    this.lastStateHashFrame = 0;
  }

  private handleRoomGameEnd({ isWin }: { isWin: boolean }) {
    this.isGameEnd = true;
    this.isPaused = true;
    this.Eventbus.emit("onCombatEnd", isWin);
  }

  // 切换游戏速度（1速/2速）
  public handleTimespeedToggle(): boolean {
    // 真实联机无效；单机 mock 会话仍允许本地倍速 / 暂停时无效 / 结束时无效
    if (BackendWS.isOnlineMode() || this.isPaused || this.isGameEnd) return false;
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

      const frameReady = SyncManager.Instance.update();

      if (!frameReady) {
        this.isInFixedStep = false;
        break;
      }
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
        CardpileManager.Instance.stepUpdate();
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
      this.sampleStateHash();
      this.recordSnapshotIfNeeded();
      this.finishDeterminismCheckIfNeeded();
      this.commitPendingPausedState();
      if (this.isPaused) {
        this.elapsedFrameTime = 0;
        break;
      }
    }

    // 仍有积压时处于追帧模式：跳过渲染插值，优先把逻辑帧追平。
    const hasBacklog = this.elapsedFrameTime >= SyncManager.Instance.frameIntervalMs;
    if (!this.isPaused && !hasBacklog) {
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

    // Regular per-render work.
    SyncManager.Instance.sendQueue.Consume();
  }

  /** 供联机分叉检测 / 断线恢复使用：收集当前完整确定性状态。 */
  public captureState(): SimulationState {
    return simulationState.capture();
  }

  public serializeState(): string {
    return serializeSimulationState(this.captureState());
  }

  /** 供断线重连 / 分叉恢复使用：恢复收集器覆盖的全部状态源。 */
  public restoreState(state: SimulationState, mode: "in-place" | "rebuild" = "in-place") {
    const report = simulationState.restore(state, {
      mode,
      resolveEntity: resolveEntityBySnapshotId,
    });
    this.lastStateHash = null;
    this.lastStateHashFrame = 0;
    return report;
  }

  /** 每个逻辑帧结束后按固定间隔记录快照。 */
  private recordSnapshotIfNeeded(): void {
    const frameId = SyncManager.Instance.recvQueue.currentFrameId;
    if (frameId <= 0 || frameId % CombatManager.SNAPSHOT_INTERVAL_FRAMES !== 0) return;
    const latest = this.snapshotRing[this.snapshotRing.length - 1];
    if (latest?.frameId === frameId) return;

    // 快照必须落在干净的帧边界：先执行完延迟创建/销毁。
    DeferredManager.Instance.flush();
    this.snapshotRing.push({ frameId, state: this.captureState() });
    if (this.snapshotRing.length > CombatManager.SNAPSHOT_RING_SIZE) {
      this.snapshotRing.shift();
    }
  }

  public getSnapshotAtOrBefore(frameId: number): { frameId: number; state: SimulationState } | null {
    for (let i = this.snapshotRing.length - 1; i >= 0; i--) {
      if (this.snapshotRing[i].frameId <= frameId) return this.snapshotRing[i];
    }
    return null;
  }

  public getSnapshotRingFrameIds(): number[] {
    return this.snapshotRing.map((entry) => entry.frameId);
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
    return { frameId: entry.frameId, report };
  }

  public clearSnapshotRing(): void {
    this.snapshotRing = [];
  }

  /** 当前完整状态的 64 位摘要。 */
  public hashState(): string {
    return simulationState.hash().h64;
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
      expectedHash: this.hashState(),
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
    const actualHash = this.hashState();
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
    try {
      const hash = simulationState.hash();
      this.lastStateHash = hash.h64;
      this.lastStateHashFrame = frameId;
      PhaserEventBus.emit(PhaserEvents.SimulationHashSampled, {
        frameId,
        hash: this.lastStateHash,
      });
      // 房间会话下把 32 位摘要随心跳上报，服务端跨端比对以发现分叉
      const hash32 = Number.parseInt(hash.h32, 16) >>> 0;
      if (BackendWS.isRoomSessionMode() && hash32 !== 0) {
        SyncManager.Instance.sendQueue?.sendStateHash(frameId, hash32);
      }
    } catch {
      // 状态采样失败不应中断锁步推进；后续按周期重试。
    }
  }
}
