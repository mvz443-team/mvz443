
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
import { DeferredManager } from "../DeferredManager";
import { MonsterEntity } from "../../models/entities/MonsterEntity";
import { onlineStateManager } from "../../../store/OnlineStateManager";
import StageHelper from "../../utils/helper/StageHelper";
import MobHelper from "../../utils/helper/MobHelper";
import TileItemManager from "./TileItemManager";

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

  // 存活的怪物列表
  public MobsByLane: Map<number, Mob[]> = new Map(); // 按行分的怪物列表
  /** 使用 stateful alea，使 PRNG 内部状态可被快照 / 恢复 */
  private _seedRandom: seedrandom.StatefulPRNG<seedrandom.State.Alea>;

  private waves: Wave[];
  private current_wave_idx: number = 0;

  private SpawnTimer: FrameTimer; // 出怪
  private Timer: FrameTimer | null = null; // 波数使用帧驱动定时器，类型为 FrameTimer
  private prev_wave_frame: number = 0;

  private tmpKilled_count = 0;// 两波之间存击杀数
  private killed_count = 0; // 怪物击杀数
  private total_count = 0; // 怪物总数

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
    // Initialize MobManager
  }
  public Load(): void {
    PhaserEventBus.on(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
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
    this.Timer?.remove();
    this.Timer = null;
    this.SpawnTimer?.remove();
    this.MobsByLane.clear();
    this.seed = 0;
    this.waves = [];
    this.progress = 0;
    this.current_wave_idx = 0;
    this.prev_wave_frame = 0;
    this.tmpKilled_count = 0;
    this.killed_count = 0;
    this.total_count = 0;
    this.bossObj = null;
    this.hasRequestedWin = false;
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
    this._seedRandom = seedrandom.alea(snapshot.seed, { state: true });
    (this._seedRandom as unknown as { state: (state: seedrandom.State.Alea) => void }).state(
      snapshot.state as seedrandom.State.Alea,
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
    };
  }

  public RestoreWaveState(state: Record<string, number | boolean>): void {
    this.current_wave_idx = Number(state.current_wave_idx) || 0;
    this.prev_wave_frame = Number(state.prev_wave_frame) || 0;
    this.tmpKilled_count = Number(state.tmpKilled_count) || 0;
    this.killed_count = Number(state.killed_count) || 0;
    this.total_count = Number(state.total_count) || 0;
    this.progress = Number(state.progress) || 0;
    this.hasRequestedWin = Boolean(state.hasRequestedWin);
  }

  currentWave() {
    return this.waves[this.current_wave_idx];
  }

  setRandomSeed(seed: number) {
    this._seedRandom = seedrandom.alea(String(seed), { state: true })
  }

  // 整局,触发开始,一局游戏只能调用一次
  startFirstWave() {
    // 如果存在之前的帧定时器，取消之
    if (this.Timer) {
      this.Timer.remove(); // 取消之前的定时器
    }
    // 同时取消出怪定时器
    if (this.SpawnTimer) {
      this.SpawnTimer.remove();
    }

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

    const startNewWave = () => {
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
      if (this.Timer) {
        this.Timer.remove(); // 取消之前的定时器
      }

      // 使用帧驱动定时器延迟调用 nextWave
      this.Timer = TickerManager.Instance.delayedCall({
        callback: () => {
          this.nextWave();
        },
        delay: this.currentWave().maxDelay * 1000,
      }); // 延迟时间
    };

    // 如果是isFlag,那么输出字幕等待一段时间,否则直接开始
    if (this.currentWave().isFlag) {
      this.EventBus.emit('onNotifyFlagWave', this.currentWave().waveId);
      if (this.Timer) {
        this.Timer.remove(); // 取消之前的定时器
      }

      this.Timer = TickerManager.Instance.delayedCall({
        callback: () => {
          startNewWave();
        },
        delay: 5000,
      });
    } else {
      startNewWave();
    }
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
    let rowWeights = spawnPlan.rowWeights;
    let rowPickSmoothingState = spawnPlan.rowPickSmoothingState;
    const totalMonsters = spawnPlan.totalMonsters;
    const carryingMonsters = spawnPlan.carryingMonsterIndexes;
    console.log('interval', spawnPlan.interval, 'duration', wave.duration * 1000);

    let monsterIndex = 0;
    if (this.SpawnTimer) this.SpawnTimer.remove();

    this.SpawnTimer = TickerManager.Instance.addEvent({
      delay: spawnPlan.interval,
      repeat: totalMonsters.length - 1,
      callback: () => {
        if (this.scene == null) return;
        const monsterData = totalMonsters[monsterIndex];
        const rowResult = MobHelper.selectSpawnRow({
          wave,
          stageScript: this.scene.stageData.stageScript,
          rowWeights,
          rowPickSmoothingState,
          currentWaveId: wave.waveId,
          minecartLostWaveByRow: TileItemManager.Instance.getMinecartLostWaveByRow(),
          mid: monsterData.mid,
          rowCount: PositionManager.Instance.Row_Number,
          rng: this.SeedRandom,
          rowPropertyRatio: (row, type) => GridManager.Instance.RowPropertyRatio(row, type),
        });
        const row = rowResult.row;

        // 换成新版本的新建怪物函数
        const model = MonsterLibrary.GetModel(monsterData.mid);
        if (!model) {
          console.error(`Monster model with mid ${monsterData.mid} not found!`);
          return;
        }

        const currentMonsterIndex = monsterIndex;
        DeferredManager.Instance.defer(() => {
          if (!this.scene) return;
          const zomb = model.createEntity(this.scene, colMax, row, wave.waveId);
          this.attachLifecycle(zomb);

          // 2. 如果当前怪物索引在carryingMonsters中，则设置携带starShards
          if (zomb && carryingMonsters.has(currentMonsterIndex) && model.couldCarryStarShards) {
            zomb.addStarShards();
          }
        });

        monsterIndex++;
        rowWeights = rowResult.rowWeights;
        rowPickSmoothingState = rowResult.rowPickSmoothingState;
      }
    });
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
          TickerManager.Instance.delayedCall({
            callback: () => {
              this.nextWave();
            },
            delay: 11000
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
        const victoryCheckTimer = TickerManager.Instance.addEvent({
          delay: 1500, // 1.5秒
          loop: true,
          callback: () => {
            if (this.MobsByLane.size === 0) {
              console.log('No monsters left on the field, game victory!');
              this.completeAllWaves();
              victoryCheckTimer.remove();
            } else {
              console.log('Monsters still on field:', this.MobsByLane.size);
            }
          }
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

        if (this.Timer) {
          this.Timer.remove(); // 取消之前的定时器
        }
        this.Timer = TickerManager.Instance.delayedCall({
          callback: () => {
            this.nextWave();
          },
          delay: delay,
        });
        return;
      } else {
        // 你怎么会在这里?
        console.log('Fatal Error: you should not be here');
        // TODO : fatal error exit
      }
    }
  }

  private handleRoomGameStart() {
    const roomAllReady = onlineStateManager.getRoomAllReady();
    this.seed = roomAllReady?.seed ?? CombatManager.Instance.seed;
    this.setRandomSeed(this.seed);
    if (!this.scene?.stageData) {
      console.error("No stage data found for MobManager game start.");
      return;
    }
    const stageScriptRandom = seedrandom.alea(String(this.seed));
    this.setWaves(StageHelper.generateStageScript(
      this.scene.stageData.stageScript,
      stageScriptRandom,
      this.scene.params.level,
    ));
    this.startFirstWave();
  }
}
