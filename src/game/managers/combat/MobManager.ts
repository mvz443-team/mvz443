
import seedrandom from "seedrandom";
import type { Wave } from "../../../types/stage";
import GridManager from "./GridManager";
import { PositionManager } from "../view/PositionManager";
import { CombatEntity } from "../../models/core/CombatEntity";
import {
  PhaserEventBus,
  PhaserEvents,
} from "../../EventBus";
import { BaseManager } from "../BaseManager";
import type { Game } from "../../scenes/Game";
import TickerManager, { FrameTimer } from "./TickerManager";
import { EventBus } from "../../../utils/eventBus";
import CombatManager from "../CombatManager";
import { MonsterLibrary } from "../library/MonsterLibrary";
import { DEFAULT_HABITATS } from "../../core/logic/TerrainHabitat";
import { DeferredManager } from "../DeferredManager";
import { MonsterEntity } from "../../models/entities/MonsterEntity";
import { onlineStateManager } from "../../../store/OnlineStateManager";
import StageHelper from "../../utils/helper/StageHelper";
import MobHelper from "../../utils/helper/MobHelper";
import TileItemManager from "./TileItemManager";
import { desyncDiagnostics } from "../../../utils/debug/desyncDiagnostics";
import { createAleaWithState } from "../../core/DeterministicRandom";
import { SpawnSequence, mobSnapshotId } from "../../core/logic/MobSpawnIdentity";

type Mob = CombatEntity;

export enum ProgressMode {
  Normal = "NORMAL",
  Boss = "BOSS"
}

// 普通模式的详细数据
interface NormalProgressData {
  mode: ProgressMode.Normal;
  totalWaves: number;      // 总波数
  currentWave: number;     // 当前已过波数
  flagWaves: number[];     // 旗帜所在的波数节点，如 [10, 20, 30]
}

// Boss模式的详细数据
interface BossProgressData {
  mode: ProgressMode.Boss;
  bossHealthPercent: number; // 0.0 - 1.0
}

// 使用联合类型，确保事件参数的严谨性
export type ProgressUpdateEvent = NormalProgressData | BossProgressData;

type MobManagerEvent = {
  // 新的一波开始
  onNewWave: (waveId: number, isFlag: boolean) => void;
  // 通知下一波是flag波,例如通知输出字幕等待一段时间
  onNotifyFlagWave: (waveId: number) => void;

  // progress
  onProgressUpdate: (progress: ProgressUpdateEvent) => void;

  // 最后一波，小怪全部阵亡/首要boss阵亡
  onAllWavesCompleted: () => void;
}

export default class MobManager extends BaseManager {
  private static _instance: MobManager;
  protected scene: Game | null = null;

  public EventBus: EventBus<MobManagerEvent>;
  private seed: number = 0;
  private gameStartInitialized: boolean = false;

  // 存活的怪物列表
  public MobsByLane: Map<number, Mob[]> = new Map(); // 按行分的怪物列表
  /** 使用 stateful alea，使 PRNG 内部状态可被快照 / 恢复 */
  private _seedRandom: seedrandom.StatefulPRNG<seedrandom.State.Alea>;

  private waves: Wave[];
  private current_wave_idx: number = 0;

  private SpawnTimer: FrameTimer | null = null; // 出怪
  private Timer: FrameTimer | null = null; // 波数使用帧驱动定时器，类型为 FrameTimer
  /** 当前出怪序列的可快照状态（避免关键进度只存在于闭包里）。 */
  private spawnState: {
    waveId: number;
    monsterIndex: number;
    totalMonsters: Array<{ mid: number }>;
    rowWeights: number[];
    rowPickSmoothingState: any;
    carryingMonsters: Set<number>;
    interval: number;
  } | null = null;
  private prev_wave_frame: number = 0;

  private tmpKilled_count = 0;// 两波之间存击杀数
  private killed_count = 0; // 怪物击杀数
  private total_count = 0; // 怪物总数
  /** 确定性出怪 / 召唤序号，用于生成稳定的实体快照 key；进入 `wave` 快照。 */
  private readonly spawnSequence = new SpawnSequence();

  // 进度, 由wave定，
  // FUTURE： 如果存在多boss，或占比不同，还要再微调
  public progress: number = 0;

  private bossObj: CombatEntity | null = null; // boss对象,如果有最后一波boss,监听boss存活,
  // BOSS死亡自动emit游戏胜利,不再做胜利判断
  private hasRequestedWin = false;
  private readonly handleRoomAllReady = (data: { allPlayerCount: number, seed: number, myId: number, playerIds: number }) => {
    this.seed = data.seed;
  };

  constructor() {
    super();
    this.EventBus = new EventBus<MobManagerEvent>();
    this._seedRandom = seedrandom.alea(String(this.seed), { state: true });
  }
  public Load(): void {
    PhaserEventBus.on(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    // 断线 checkpoint 以 rebuild 模式恢复；全局 ticker 不会保留旧闭包，
    // 必须在这里登记可重建的语义工厂，否则出怪/波次/胜利检查会永久丢失。
    TickerManager.Instance.registerTimerFactory("mob.spawn", () => ({
      callback: () => this.spawnNextMonster(),
    }));
    TickerManager.Instance.registerTimerFactory("mob.wave.start", () => ({
      callback: () => this.startCurrentWave(),
    }));
    TickerManager.Instance.registerTimerFactory("mob.wave.next", () => ({
      callback: () => this.nextWave(),
    }));
    TickerManager.Instance.registerTimerFactory("mob.victoryCheck", () => ({
      callback: () => this.checkVictory(),
    }));
    const roomAllReady = onlineStateManager.getRoomAllReady();
    if (roomAllReady) {
      this.seed = roomAllReady.seed;
    }
  }

  public setScene(scene: Game) {
    this.scene = scene;
  }

  public setWaves(waves: Wave[]) {
    this.waves = waves;
  }

  public GetWaves(): Wave[] {
    return this.waves ?? [];
  }

  public RestoreWaves(waves: Wave[]): void {
    this.waves = waves;
  }


  public get wavesLeng(): number {
    return this.waves ? this.waves.length : 0;
  }

  public static get Instance(): MobManager {
    if (!this._instance) {
      this._instance = new MobManager();
    }
    return this._instance;
  }

  public Reset() {
    PhaserEventBus.off(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    PhaserEventBus.off(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    this.gameStartInitialized = false;
    this.clearWaveTimers();
    this.clearSpawnTimer();
    this.clearVictoryCheckTimer();
    this.Timer = null;
    this.MobsByLane.clear();
    this.seed = 0;
    this.setRandomSeed(this.seed);
    this.waves = [];
    this.progress = 0;
    this.current_wave_idx = 0;
    this.prev_wave_frame = 0;
    this.tmpKilled_count = 0;
    this.killed_count = 0;
    this.total_count = 0;
    this.bossObj = null;
    this.hasRequestedWin = false;
    this.spawnState = null;
    this.spawnSequence.reset();
    this.EventBus.removeAllListeners();
    this.scene = null;
  }

  public get SeedRandom(): seedrandom.PRNG {
    return this._seedRandom;
  }

  /** 导出主随机流的完整内部状态（seed + alea 闭包状态）。 */
  public CapturePrngState(): { seed: string; state: seedrandom.State.Alea } {
    return {
      seed: String(this.seed),
      state: this._seedRandom.state(),
    };
  }

  /** 从快照恢复主随机流，保证后续随机序列与原端完全一致。 */
  public RestorePrngState(snapshot: { seed: string; state: unknown }): void {
    this.seed = Number(snapshot.seed) || 0;
    // seedrandom 的 alea `.state()` 只有 getter，传参不会写回内部状态。
    // 之前的实现会把 PRNG 退化为按 seed 重新播种，重连后出怪/掉落等随机
    // 决策立刻与源端分叉；状态必须由工厂在构造时载入。
    this._seedRandom = createAleaWithState(
      snapshot.seed,
      snapshot.state as seedrandom.State.Alea | undefined,
    );
  }

  /** 波次推进相关的确定性计数状态。 */
  public GetWaveState(): Record<string, number | boolean> {
    return {
      current_wave_idx: this.current_wave_idx,
      prev_wave_frame: this.prev_wave_frame,
      tmpKilled_count: this.tmpKilled_count,
      killed_count: this.killed_count,
      total_count: this.total_count,
      progress: this.progress,
      hasRequestedWin: this.hasRequestedWin,
      spawnSeq: this.spawnSequence.capture(),
    };
  }

  /** 为出怪 / 技能召唤分配确定性序号；必须在派发延迟创建之前同步调用。 */
  public allocateSpawnSeq(): number {
    return this.spawnSequence.allocate();
  }

  public RestoreWaveState(state: Record<string, number | boolean>): void {
    this.current_wave_idx = Number(state.current_wave_idx) || 0;
    this.prev_wave_frame = Number(state.prev_wave_frame) || 0;
    this.tmpKilled_count = Number(state.tmpKilled_count) || 0;
    this.killed_count = Number(state.killed_count) || 0;
    this.total_count = Number(state.total_count) || 0;
    this.progress = Number(state.progress) || 0;
    this.hasRequestedWin = Boolean(state.hasRequestedWin);
    this.spawnSequence.restore(state.spawnSeq);
    // 从权威快照恢复的战局已经包含开局预设与波次状态。
    // roomAllSync 随后到达时会再次触发 RoomGameStart，绝不能在这里
    // 重新 startFirstWave，否则会重复创建初始植物/计时器并立刻分叉。
    this.gameStartInitialized = true;
  }

  /** 出怪序列（spawn plan + 游标）的确定性状态。 */
  public CaptureSpawnState(): Record<string, unknown> | null {
    if (!this.spawnState) return null;
    return {
      waveId: this.spawnState.waveId,
      monsterIndex: this.spawnState.monsterIndex,
      totalMonsters: this.spawnState.totalMonsters.map((entry) => ({ mid: entry.mid })),
      rowWeights: [...this.spawnState.rowWeights],
      rowPickSmoothingState: this.spawnState.rowPickSmoothingState,
      carryingMonsters: [...this.spawnState.carryingMonsters].sort((a, b) => a - b),
      interval: this.spawnState.interval,
    };
  }

  public RestoreSpawnState(state: Record<string, unknown> | null): void {
    if (!state) {
      this.spawnState = null;
      return;
    }
    this.spawnState = {
      waveId: Number(state.waveId) || 0,
      monsterIndex: Number(state.monsterIndex) || 0,
      totalMonsters: Array.isArray(state.totalMonsters)
        ? (state.totalMonsters as Array<{ mid: number }>).map((entry) => ({ mid: Number(entry.mid) || 0 }))
        : [],
      rowWeights: Array.isArray(state.rowWeights) ? [...(state.rowWeights as number[])] : [],
      rowPickSmoothingState: state.rowPickSmoothingState,
      carryingMonsters: new Set(
        Array.isArray(state.carryingMonsters) ? (state.carryingMonsters as number[]) : [],
      ),
      interval: Number(state.interval) || 0,
    };
  }

  currentWave() {
    return this.waves[this.current_wave_idx];
  }

  setRandomSeed(seed: number) {
    this._seedRandom = seedrandom.alea(String(seed), { state: true })
  }

  // 整局,触发开始,一局游戏只能调用一次
  startFirstWave() {
    // 如果存在之前的帧定时器，取消之。
    // 注意必须按 kind 取消当前实例：checkpoint rebuild 后旧句柄的
    // id 可能正好指向新重建的 timer，直接 remove() 会误删。
    this.clearWaveTimers();
    this.clearSpawnTimer();
    this.clearVictoryCheckTimer();

    this.progress = 0;
    this.current_wave_idx = -1;
    this.killed_count = 0;
    this.total_count = 0;
    this.hasRequestedWin = false;
    this.nextWave();
  }

  private completeAllWaves() {
    if (this.hasRequestedWin) {
      return;
    }
    this.hasRequestedWin = true;
    this.EventBus.emit('onAllWavesCompleted');
    CombatManager.Instance.EndGame(true);
  }

  // Next
  nextWave() {
    // 无论如何都到达了下一波,那么开始进度记录
    if (this.current_wave_idx >= 0) {
      this.progress = this.currentWave().progress; // 上一波的进度到达完成!
    }

    this.current_wave_idx++;
    this.EventBus.emit('onProgressUpdate', {
      mode: ProgressMode.Normal,
      totalWaves: this.wavesLeng,
      currentWave: this.current_wave_idx, // 已过波数
      flagWaves: this.waves.filter(w => w.isFlag).map(w => w.waveId), // 旗帜所在的波数节点，如 [10, 20, 30]
    } as NormalProgressData);

    console.log('next wave', this.current_wave_idx, '/', this.wavesLeng);
    if (this.current_wave_idx >= this.waves.length) {
      // 游戏结束,不应该在这里出现
      console.log('the game should have been ended');
      return;
    }

    // 如果是isFlag,那么输出字幕等待一段时间,否则直接开始
    if (this.currentWave().isFlag) {
      this.EventBus.emit('onNotifyFlagWave', this.currentWave().waveId);
      this.clearWaveTimers();

      this.Timer = TickerManager.Instance.delayedCall({
        callback: () => this.startCurrentWave(),
        delay: 5000,
        snapshot: { kind: "mob.wave.start" },
      });
    } else {
      this.startCurrentWave();
    }
  }

  /**
   * 真正进入当前波。拆成方法而不是 nextWave 内的闭包，
   * 这样断线重建 global ticker 时可以用稳定工厂恢复“旗帜字幕结束后开局”的定时器。
   */
  private startCurrentWave(): void {
    this.prev_wave_frame = TickerManager.Instance.getCurrentFrame(); // 更新时间

    // 发出新波开始事件
    const waveObj = this.currentWave();
    this.EventBus.emit('onNewWave', waveObj.waveId, waveObj.isFlag);

    // 怪物生成流程
    this.tmpKilled_count = this.killed_count;
    this.killed_count = 0; // 清空当前击杀数字,在生成怪物之间可能会发生击杀怪物事件
    this.spawnMonster();
    this.killed_count += this.tmpKilled_count;
    this.onKilledCountUpdate(this.current_wave_idx - 1); // 之前杀的,更新击杀数

    // 如果当前波为精英或BOSS, 则不启用下一波定时器，
    // 等待精英/BOSS被击杀后由 onKilledCountUpdate 触发下一波或游戏胜利逻辑
    if (this.currentWave().flag === 'elite' || this.currentWave().flag === 'boss') {
      // 设置外部的progress为boss health bar,不影响 this.progress(wave 进度)
      PhaserEventBus.emit(PhaserEvents.BossHealth, { health: 100 });
      return;
    }

    // 启动定时器（仅适用于普通波）
    if (this.current_wave_idx >= this.waves.length - 1) return; // 没下一波了

    console.log('next wave timer', this.currentWave().maxDelay * 1000);
    this.clearWaveTimers();

    // 使用帧驱动定时器延迟调用 nextWave
    this.Timer = TickerManager.Instance.delayedCall({
      callback: () => this.nextWave(),
      delay: this.currentWave().maxDelay * 1000,
      snapshot: { kind: "mob.wave.next" },
    }); // 延迟时间
  }


  spawnMonster() {
    if (this.scene == null) {
      console.error('Scene is not set in MobManager');
      return;
    }
    const wave = this.currentWave();

    if (wave.duration === 0) {
      return; // 准备波,不生成怪物
    }

    // Acquire current wave's monster number
    const currentMonsters = wave.monsters.reduce((acc, m) => acc + m.count, 0);
    this.total_count += currentMonsters; // 当前波id以及之前的所有(非召唤物)僵尸数量
    if (currentMonsters <= 0) {
      return;
    }

    const colMax = PositionManager.Instance.Col_Number; // 出生在可种植植物列的右边
    const spawnPlan = MobHelper.createSpawnPlan({
      wave,
      stageScript: this.scene.stageData.stageScript,
      rowCount: PositionManager.Instance.Row_Number,
      rng: this.SeedRandom,
      canCarryStarShards: (mid) => MonsterLibrary.GetModel(mid)?.couldCarryStarShards ?? false,
    });
    this.spawnState = {
      waveId: wave.waveId,
      monsterIndex: 0,
      totalMonsters: spawnPlan.totalMonsters,
      rowWeights: spawnPlan.rowWeights,
      rowPickSmoothingState: spawnPlan.rowPickSmoothingState,
      carryingMonsters: spawnPlan.carryingMonsterIndexes,
      interval: spawnPlan.interval,
    };
    console.log('interval', spawnPlan.interval, 'duration', wave.duration * 1000);

    this.clearSpawnTimer();

    this.SpawnTimer = TickerManager.Instance.addEvent({
      delay: spawnPlan.interval,
      repeat: spawnPlan.totalMonsters.length - 1,
      snapshot: { kind: "mob.spawn" },
      callback: () => this.spawnNextMonster(),
    });
  }

  /** 按当前 spawnState 生成下一只怪；供正常推进与断线重建的 timer 工厂共用。 */
  private spawnNextMonster(): void {
    const state = this.spawnState;
    if (this.scene == null || !state) return;
    const monsterData = state.totalMonsters[state.monsterIndex];
    if (!monsterData) return;
    const wave = this.currentWave();
    const colMax = PositionManager.Instance.Col_Number;

    const rowResult = MobHelper.selectSpawnRow({
      wave,
      stageScript: this.scene.stageData.stageScript,
      rowWeights: state.rowWeights,
      rowPickSmoothingState: state.rowPickSmoothingState,
      currentWaveId: wave.waveId,
      minecartLostWaveByRow: TileItemManager.Instance.getMinecartLostWaveByRow(),
      mid: monsterData.mid,
      rowCount: PositionManager.Instance.Row_Number,
      rng: this.SeedRandom,
      rowPropertyRatio: (row, type) => GridManager.Instance.RowPropertyRatio(row, type),
      getHabitats: mid => MonsterLibrary.GetModel(mid)?.habitats ?? DEFAULT_HABITATS,
      isFlying: mid => MonsterLibrary.GetModel(mid)?.isDefaultFlying ?? false,
    });
    const row = rowResult.row;

    // 换成新版本的新建怪物函数
    const model = MonsterLibrary.GetModel(monsterData.mid);
    if (!model) {
      console.error(`Monster model with mid ${monsterData.mid} not found!`);
      return;
    }

    const currentMonsterIndex = state.monsterIndex;
    // 序号必须在 defer 之前同步分配：延迟回调可能因回滚被重放，在回调内自增
    // 会重复计数；实体 id 参与哈希，序号错位会让两端从该帧起永久分叉。
    const spawnSeq = this.allocateSpawnSeq();
    const waveId = wave.waveId;
    DeferredManager.Instance.defer(() => {
      if (!this.scene) return;
      const zomb = model.createEntity(this.scene, colMax, row, waveId);
      zomb.adoptStableSnapshotKey(mobSnapshotId(waveId, spawnSeq));
      zomb.applySpawnSeed(spawnSeq);
      zomb.ExtraData.spawnSeq = spawnSeq;
      this.attachLifecycle(zomb);

      // 2. 如果当前怪物索引在carryingMonsters中，则设置携带starShards
      if (zomb && state.carryingMonsters.has(currentMonsterIndex) && model.couldCarryStarShards) {
        zomb.addStarShards();
      }
    });

    state.monsterIndex++;
    state.rowWeights = rowResult.rowWeights;
    state.rowPickSmoothingState = rowResult.rowPickSmoothingState;
  }

  // 怪物生成注册
  registerMonster(monster: CombatEntity) {
    const key = monster.GetRow();
    if (!this.MobsByLane.has(key)) {
      this.MobsByLane.set(key, [monster]);
    } else {
      this.MobsByLane.get(key)?.push(monster);
    }
  }

  /** 快照恢复：按 mid/坐标/波次重建怪物，并复用稳定计时器 key。 */
  public RebuildMonster(mid: number, col: number, row: number, waveID: number, spawnSeq: number): MonsterEntity | null {
    if (!this.scene) return null;
    const model = MonsterLibrary.GetModel(mid);
    if (!model) return null;
    const monster = model.createEntity(this.scene, col, row, waveID);
    monster.adoptStableSnapshotKey(mobSnapshotId(waveID, spawnSeq));
    monster.applySpawnSeed(spawnSeq);
    monster.ExtraData.spawnSeq = spawnSeq;
    this.attachLifecycle(monster);
    return monster;
  }

  /** 快照对账时移除实体：只从容器移除，不增加击杀计数。 */
  public RemoveMonsterSilently(monster: CombatEntity) {
    const key = monster.GetRow();
    const mobsInLane = this.MobsByLane.get(key);
    if (!mobsInLane) return;
    const index = mobsInLane.indexOf(monster);
    if (index >= 0) mobsInLane.splice(index, 1);
    if (mobsInLane.length === 0) this.MobsByLane.delete(key);
  }

  // 怪物注册销毁
  registerDestroy(monster: CombatEntity) {
    const key = monster.GetRow();
    const mobsInLane = this.MobsByLane.get(key);
    if (mobsInLane) {
      const index = mobsInLane.indexOf(monster);
      if (index >= 0) {
        mobsInLane.splice(index, 1);
        if (mobsInLane.length === 0) {
          this.MobsByLane.delete(key);
        }
      }
    }
    const waveId = monster.GetExtraData<number>('waveId') ?? -1;
    console.log('monster destroyed', waveId);
    if (waveId >= 0) {
      this.killed_count++;
      this.onKilledCountUpdate(waveId); // 非召唤物僵尸(waveId >= 0)杀了才计数
    }
  }

  private attachLifecycle(monster: MonsterEntity) {
    this.registerMonster(monster);
    monster.addDestroyListener((entity) => this.registerDestroy(entity));
  }

  onKilledCountUpdate(m_waveID: number = -10) {
    if (CombatManager.Instance.isGameEnd) return; // 结束了,避免结束杀人
    console.log('kill', this.killed_count, '/', this.total_count);
    const waveObj = this.currentWave();

    // 如果是BOSS或精英波
    if (waveObj.flag === 'boss' || waveObj.flag === 'elite') {
      // 当击杀的怪物属于当前精英或BOSS时
      if (m_waveID === waveObj.waveId) {
        PhaserEventBus.emit(PhaserEvents.BossDead);
        if (waveObj.flag === 'elite') {
          console.log('精英怪已击杀, 立即开始下一波');
          this.clearWaveTimers();
          TickerManager.Instance.delayedCall({
            callback: () => this.nextWave(),
            delay: 11000,
            snapshot: { kind: "mob.wave.next" },
          });
        } else if (waveObj.flag === 'boss') {
          console.log('BOSS已击杀, 游戏胜利！');
          this.completeAllWaves();
        }
      }
      return;
    }

    // 普通波逻辑：
    // 检查是否所有怪物都被击杀
    if (this.killed_count >= this.total_count) {
      console.log('All monsters in current wave killed!');
      // 如果是最后一波
      if (this.current_wave_idx >= this.wavesLeng - 1) {
        console.log('Last wave detected, starting victory check timer...');
        // 启动一个每1.5秒检查一次的定时器
        this.clearVictoryCheckTimer();
        TickerManager.Instance.addEvent({
          delay: 1500, // 1.5秒
          loop: true,
          snapshot: { kind: "mob.victoryCheck" },
          callback: () => this.checkVictory(),
        });
      } else if (this.current_wave_idx >= 0 && this.current_wave_idx < this.wavesLeng - 1) {
        // 非最后一波，继续下一波逻辑
        // 判断一下minDelay,避免杀的太快
        const now_frame = TickerManager.Instance.getCurrentFrame();
        const interval = TickerManager.Instance.calcTickDeltaMs(this.prev_wave_frame, now_frame);
        let delay = Math.max(this.currentWave().minDelay * 1000 - interval, 2000);
        if (delay > 6000) {
          delay = 6000;
        }

        this.clearWaveTimers();
        this.Timer = TickerManager.Instance.delayedCall({
          callback: () => this.nextWave(),
          delay: delay,
          snapshot: { kind: "mob.wave.next" },
        });
        return;
      } else {
        // 你怎么会在这里?
        console.log('Fatal Error: you should not be here');
        // TODO : fatal error exit
      }
    }
  }

  /** 最后一波清场后的胜利检查。timer 常驻到本局结束，重建后两端状态一致。 */
  private checkVictory(): void {
    if (this.MobsByLane.size === 0) {
      console.log('No monsters left on the field, game victory!');
      this.completeAllWaves();
    } else {
      console.log('Monsters still on field:', this.MobsByLane.size);
    }
  }

  private handleRoomGameStart() {
    if (this.gameStartInitialized) {
      desyncDiagnostics.record("combat", "MobManager RoomGameStart skipped (already restored/started)", {
        currentWave: this.current_wave_idx,
        progress: this.progress,
        waveCount: this.wavesLeng,
      });
      return;
    }
    const roomAllReady = onlineStateManager.getRoomAllReady();
    this.seed = roomAllReady?.seed ?? CombatManager.Instance.seed;
    this.setRandomSeed(this.seed);
    if (!this.scene?.stageData) {
      console.error("No stage data found for MobManager game start.");
      return;
    }
    this.gameStartInitialized = true;
    const stageScriptRandom = seedrandom.alea(String(this.seed));
    this.setWaves(StageHelper.generateStageScript(
      this.scene.stageData.stageScript,
      stageScriptRandom,
      this.scene.params.level,
    ));
    this.startFirstWave();
  }

  /**
   * 取消波次相关 timer。
   * 用 kind 而不是缓存句柄：checkpoint rebuild 会替换 FrameTimer 实例，
   * 旧句柄 remove() 可能删除同 id 的新 timer。
   */
  private clearWaveTimers(): void {
    TickerManager.Instance.removeTimersByKind("mob.wave.start");
    TickerManager.Instance.removeTimersByKind("mob.wave.next");
    this.Timer = null;
  }

  private clearSpawnTimer(): void {
    TickerManager.Instance.removeTimersByKind("mob.spawn");
    this.SpawnTimer = null;
  }

  private clearVictoryCheckTimer(): void {
    TickerManager.Instance.removeTimersByKind("mob.victoryCheck");
  }
}
