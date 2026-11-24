import {
  PhaserEventBus,
  PhaserEvents,
} from '../EventBus';
import { Scene } from 'phaser';
import { PositionManager } from '../managers/view/PositionManager';
import CursorManager from '../managers/combat/CursorManager';
import PlantsManager from '../managers/combat/PlantsManager';
import { GameParams, GameSettings } from '../models/GameParams';
import CreateInnerMenu from '../ui/menu/inner_menu';
import type { StageData } from '../../types/stage';
import BackendWS from '../../utils/net/sync';
import { translate } from '../../i18n';
import DepthHelper from '../utils/helper/DepthHelper';
import SoundManager from '../managers/SoundManager';
import SoundCmd from '../utils/cmd/SoundCmd';
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import CombatManager from '../managers/CombatManager';
import GridManager from '../managers/combat/GridManager';
import MobManager from '../managers/combat/MobManager';
import ObstacleManager from '../managers/combat/ObstacleManager';
import { BaseManager } from '../managers/BaseManager';
import CardpileManager from '../managers/combat/CardpileManager';
import KeybindManager from '../managers/combat/KeybindManager';
import ResourceManager from '../managers/combat/ResourceManager';
import SyncManager from '../managers/combat/SyncManager';
import TickerManager from '../managers/combat/TickerManager';
import DebugManager from '../managers/view/DebugManager';
import { BaseEntity } from '../models/core/BaseEntity';
import { DeferredManager } from '../managers/DeferredManager';
import { PresetEventManager } from '../managers/combat/PresetEventManager';
import { StageLibrary } from '../stages/StageLibrary';
import TileItemManager from '../managers/combat/TileItemManager';
import ConsoleCmd from '../utils/ConsoleCmd';
import { ProjectileCmd } from '../utils/cmd/ProjectileCmd';
import {
  BATTLE_GRID_COLS,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
} from '../../constants/gameLayout';
import {
  LEGACY_BALANCE_FRAME_INTERVAL_MS,
  getRapierTimestepSeconds
} from '../../constants/physics';
import { installRuntimeStateSources, registerPhysicsSource } from '../core/RuntimeStateBridge';
import { onlineStateManager } from '../../store/OnlineStateManager';
import { BattleViewLayers } from './view/BattleViewLayers';
import { GameHud } from './view/GameHud';
import { GameMediaReadiness } from './view/GameMediaReadiness';
import { desyncDiagnostics } from '../../utils/debug/desyncDiagnostics';


export class Game extends Scene {
  private ManagerGroup: BaseManager[] = [];
  private viewLayers: BattleViewLayers | null = null;
  private hud: GameHud | null = null;
  private mediaReadiness: GameMediaReadiness | null = null;

  public innerSettings: GameSettings;

  public rapierWorld: RAPIER.World;
  public rapierEventQueue: RAPIER.EventQueue;


  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;
  gameText: Phaser.GameObjects.Text;

  pauseBtn: Phaser.GameObjects.Text;
  speedText: Phaser.GameObjects.Text;
  private frameWaitExceeded = false;

  params: GameParams;

  public stageData: StageData;

  private readonly onCombatPauseHandler = () => {
    this.handlePause({ paused: true });
  };
  private readonly onCombatResumeHandler = () => {
    this.handlePause({ paused: false });
  };
  /** 联机：只切换菜单显示，不触碰 CombatManager.isPaused / 场景时钟。 */
  private readonly onToggleOnlinePauseMenu = () => {
    this.toggleOnlinePauseMenu();
  };

  /**
   * 场景关闭/销毁时统一拆掉本局资源。game.destroy(true)（暂停退出、结算、
   * fps 重建）在 Phaser 中只派发 DESTROY，不派发 SHUTDOWN，因此两者都要挂。
   */
  private readonly onSceneTeardown = () => {
    this.teardownSession();
  };

  public toggleOnlinePauseMenu() {
    const pauseMenu = (this as any).pauseMenu as import('../ui/menu/PauseMenu').PauseMenu | null;
    if (!pauseMenu) return;
    if (pauseMenu.getIsVisible()) {
      pauseMenu.hide();
    } else {
      pauseMenu.show({ onlineMode: true });
    }
  }

  /** 供 E2E 走真实暂停菜单的二次确认退出路径。 */
  public requestPauseMenuExit() {
    const pauseMenu = (this as any).pauseMenu as import('../ui/menu/PauseMenu').PauseMenu | null;
    pauseMenu?.requestExit();
  }

  /** 调试/E2E：卡槽能量面板当前显示的文本。 */
  public getCardSlotEnergyText(): string | null {
    return this.hud?.getCardSlotEnergyText() ?? null;
  }

  public getPauseMenuState() {
    const pauseMenu = (this as any).pauseMenu as import('../ui/menu/PauseMenu').PauseMenu | null;
    return { visible: pauseMenu?.getIsVisible() ?? false };
  }
  private offNotifyFlagWave: (() => void) | null = null;
  private readonly onNotifyFlagWaveHandler = () => {
    this.broadCastFlag();
  };


  private static preparedScene: Game | null = null;

  /** 对局拆除幂等标记：SHUTDOWN / DESTROY / 正常结算可能先后触发，只能拆一次。 */
  private hasTornDown = false;

  constructor() {
    console.log('Game constructor');
    super('Game');
  }

  /** LoadScene 的“初始化战局”阶段调用；此后切到 MainGame 只剩轻量视图搭建。 */
  public static async prepareBattle(scene: Game, params: GameParams, stageData: StageData): Promise<void> {
    if (Game.preparedScene === scene) {
      return;
    }
    // 在 Manager.Load()/SyncManager.setQueue() 之前关闭 replay 快照派发；
    // 此时 simulationState 与 Rapier world 尚未注册，提前恢复只会得到空世界。
    BackendWS.setReplaySnapshotReady(false);
    BackendWS.FrameID = 0;
    desyncDiagnostics.record('game', 'prepareBattle', {
      level: params.level,
      deviceType: params.deviceType,
      plants: params.plants,
      rows: stageData.rows,
      stageScript: stageData.stageScript,
      roomAllReady: onlineStateManager.getRoomAllReady(),
      frameId: BackendWS.FrameID,
    });
    scene.params = params;
    scene.stageData = stageData;
    scene.innerSettings = params.gameSettings;
    const deviceType = params.deviceType ?? 'pc';

    scene.ManagerGroup = [
      CombatManager.Instance,
      CardpileManager.Instance,
      CursorManager.Instance,
      DeferredManager.Instance,
      GridManager.Instance,
      KeybindManager.Instance,
      MobManager.Instance,
      ObstacleManager.Instance,
      TileItemManager.Instance,
      PlantsManager.Instance,
      ResourceManager.Instance,
      SoundManager.Instance,
      PresetEventManager.Instance,
      SyncManager.Instance,
      TickerManager.Instance,
      DebugManager.Instance,
      PositionManager.Instance,
    ];
    PositionManager.Instance.setSceneViewportSize(
      params.mainViewportWidth ?? LOGICAL_BATTLE_WIDTH,
      params.mainViewportHeight ?? LOGICAL_BATTLE_HEIGHT,
      deviceType,
    );
    for (const manager of scene.ManagerGroup) {
      manager.setScene(scene);
      manager.Load();
    }

    PositionManager.Instance.setStageGrid(1, stageData.rows, BATTLE_GRID_COLS, { deviceType });
    const gridProperties = new Array(PositionManager.Instance.Row_Number)
      .fill(0).map(() => new Array(PositionManager.Instance.Col_Number).fill('ground'));
    GridManager.Instance.setGridProperty(gridProperties);

    await RAPIER.init();
    scene.rapierWorld = new RAPIER.World({ x: 0, y: 0 });
    scene.rapierWorld.timestep = getRapierTimestepSeconds(LEGACY_BALANCE_FRAME_INTERVAL_MS);
    scene.rapierEventQueue = new RAPIER.EventQueue(true);
    installRuntimeStateSources();
    registerPhysicsSource(scene);
    // 投射物重建依赖 activeScene：页面刷新后的新进程还没创建任何投射物，
    // 若此时恢复快照，ProjectileCmd 的重建工厂会因为 activeScene 为空而
    // 丢弃快照里的投射物，恢复出的状态摘要与快照摘要不一致，重连后立即分叉。
    ProjectileCmd.setScene(scene);
    // 状态源与物理世界已就绪，可以安全恢复页面刷新前缓存的 checkpoint。
    BackendWS.setReplaySnapshotReady(true);
    Game.preparedScene = scene;
    desyncDiagnostics.record('game', 'prepareBattle complete', {
      level: params.level,
      isInGame: onlineStateManager.isInGame(),
      frameId: BackendWS.FrameID,
    });

    // 重连回已开战的房间时，roomAllSync/RoomGameStart 可能早于这里的订阅到达；
    // 战局初始化完成后补发一次，确保 CombatManager/TickerManager 真正进入运行态。
    if (onlineStateManager.isInGame()) {
      PhaserEventBus.emit(PhaserEvents.RoomGameStart, { myID: onlineStateManager.getRoomInfo().myId });
    }
  }

  public static isPrepared(scene: Game): boolean {
    return Game.preparedScene === scene;
  }

  preload() {
    // 重活由 Preloader 的 prepareBattle 完成；这里只读取共享缓存。
    this.params = this.game.registry.get('gameParams') as GameParams;
    this.stageData = this.cache.json.get(`ch${this.params.level}`) as StageData;
    this.innerSettings = this.params.gameSettings;
  }

  async create() {
    // 兜底：直接启动 Game 场景（例如调试）时也保证战局已完整初始化。
    // 正常联机/单机流程由 Preloader 的“初始化战局”阶段提前完成。
    this.params = this.game.registry.get('gameParams') as GameParams;
    this.innerSettings = this.params.gameSettings;
    if (!Game.isPrepared(this)) {
      this.stageData = this.cache.json.get(`ch${this.params.level}`) as StageData;
      if (!this.stageData) {
        // 直接启动 Game 场景（调试）时，懒加载关卡模块兜底。
        this.stageData = (await StageLibrary.load(this.params.level)).content;
      }
      await Game.prepareBattle(this, this.params, this.stageData);
    }
    const deviceType = this.params.deviceType ?? 'pc';

    // 菜单
    CreateInnerMenu(this);

    // 设置主摄像机背景颜色
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor('rgba(0,0,0,0)');

    // 添加背景
    this.background = this.add.image(0, 0, 'bgimg');
    const gameViewport = PositionManager.Instance.getGameViewportBounds(deviceType);
    // Battle objects stay in battle-local coordinates. The battle camera projects them into the viewport.
    this.background
      .setOrigin(0, 0)
      .setDepth(DepthHelper.Scene.background())
      .setDisplaySize(LOGICAL_BATTLE_WIDTH, LOGICAL_BATTLE_HEIGHT);

    // 视图分层（战斗 / 卡槽 / UI 三相机）。卡槽对象在 HUD 创建时注册，因此先建分层再建 HUD。
    this.viewLayers = new BattleViewLayers(this, this.background);
    this.hud = new GameHud(this);
    this.hud.create(deviceType, gameViewport, this.innerSettings.basicDebug);
    this.viewLayers.configure(deviceType);

    if (import.meta.env.DEV) {
      (window as unknown as { __MVZ443_GAME__?: Game }).__MVZ443_GAME__ = this;
    }

    PhaserEventBus.on(PhaserEvents.RoomGameEnd, this.handleRoomGameEnd, this);
    PhaserEventBus.on(PhaserEvents.ToggleOnlinePauseMenu, this.onToggleOnlinePauseMenu, this);
    CombatManager.Instance.Eventbus.on('onCombatPause', this.onCombatPauseHandler);
    CombatManager.Instance.Eventbus.on('onCombatResume', this.onCombatResumeHandler);
    this.offNotifyFlagWave = MobManager.Instance.EventBus.on('onNotifyFlagWave', this.onNotifyFlagWaveHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onSceneTeardown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.onSceneTeardown, this);

    ConsoleCmd.install(this);
    console.log('[Game] battle view ready (battle logic was prepared in Preloader)');
  }

  /** 供 Preloader 在“加载音乐音效资源”阶段复用：等待音频/视频缓存真正可用。 */
  public async waitForMediaReady(): Promise<void> {
    this.mediaReadiness ??= new GameMediaReadiness(this.cache);
    await this.mediaReadiness.waitForMediaReady();
  }

  /**
   * 用 Rapier 快照替换物理世界。
   * 句柄索引会被保留，但旧 World 的 JS 引用全部失效，
   * 调用方必须紧接着调用 rebindPhysicsEntities 重绑实体。
   */
  public restorePhysicsWorld(snapshot: Uint8Array): void {
    const previousWorld = this.rapierWorld;
    const timestep = previousWorld?.timestep ?? getRapierTimestepSeconds(SyncManager.Instance.frameIntervalMs);
    const nextWorld = RAPIER.World.restoreSnapshot(snapshot);
    nextWorld.timestep = timestep;
    this.rapierWorld = nextWorld;
    this.rapierEventQueue = new RAPIER.EventQueue(true);
    try {
      previousWorld?.free();
    } catch {
      // 旧世界可能已被释放，忽略。
    }
  }

  update(time: number, delta: number): void {
    CombatManager.Instance.update(time, delta);
    // 地图事件视图从快照标记派生：回滚/重连后由这里补建，避免残留或缺失。
    PresetEventManager.Instance.syncStageMapView();
    this.hud?.update(this.innerSettings.basicDebug);
    DebugManager.Instance.update();
    this.viewLayers?.sync();
  }

  /** 固定步之外只驱动视图表现；禁止写回 Model 或权威坐标。 */
  public renderUpdateEntityViews(delta: number, isPaused: boolean): void {
    if (isPaused) return;
    this.rapierWorld?.bodies.forEach(rigidBody => {
      const entity = rigidBody.userData;
      if (entity instanceof BaseEntity) {
        entity.onRenderUpdate(delta);
      }
    });
  }

  changeScene() {
    this.scene.start('GameOver');
  }

  public isFrameWaiting(): boolean {
    return this.frameWaitExceeded;
  }

  public toggleFrameWaiting(waiting: boolean): void {
    this.frameWaitExceeded = waiting;
    this.hud?.updateNetStatusBadge();
  }


  /**
   * 接收队列消费函数
  */


  broadCastFlag() {
    SoundCmd.Play('wave1');
    const gameViewport = PositionManager.Instance.getGameViewportBounds(this.params.deviceType ?? 'pc');
    // 创建新的广播文本
    const zombieText = this.add.text(
      gameViewport.x + gameViewport.width / 2,
      gameViewport.y + gameViewport.height * 0.3,
      translate("game.bigWave"),
      {
        fontSize: this.scale.displaySize.width / 20,
        color: 'rgb(187, 21, 21)', // 红色文本
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
        padding: { x: 10, y: 5 },
      }
    ).setOrigin(0.5).setDepth(DepthHelper.UI.broadcast());

    // 4秒后更换文本内容为“来袭!!”
    this.time.addEvent({
      delay: 4000,
      callback: () => {
        SoundCmd.Play('wave2');
        zombieText.setText(translate("game.incoming"));
        // 3秒后销毁文本对象
        this.time.addEvent({
          delay: 3000,
          callback: () => {
            zombieText.destroy();
          }
        });
      }
    });
  }



  /** 
   * 本地
  */



  // 处理暂停
  private handlePause({ paused }: { paused: boolean }) {
    // 联机模式下不允许手动handle暂停
    if (BackendWS.isOnlineMode()) {
      return;
    }
    this.toggleFrameWaiting(false);
    const pauseMenu = (this as any).pauseMenu;
    if (!pauseMenu) {
      return;
    }

    if (paused) {
      this.pauseGameScene();
      pauseMenu.show({ bluePrintMode: this.innerSettings.isBluePrint });
    } else {
      this.resumeGameScene();
      pauseMenu.hide();
    }

    (this as any).refreshInnerMenuButtons?.();
  }

  // 停止game scene
  private pauseGameScene() {
    this.anims?.pauseAll();
    this.tweens?.pauseAll();
    this.time.paused = true;
    SoundManager.Instance.pause();
  }

  // 恢复game scene
  private resumeGameScene() {
    this.anims?.resumeAll();
    this.tweens?.resumeAll();
    this.time.paused = false;
    SoundManager.Instance.resume();
  }

  public getBattleWorldPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    if (this.viewLayers) return this.viewLayers.getBattleWorldPoint(pointer);
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: point.x, y: point.y };
  }

  /** 注册卡槽带对象（默认在战斗相机之下；悬停时切到最上层）。 */
  public registerCardBandObject(object: Phaser.GameObjects.GameObject): void {
    this.viewLayers?.registerCardBandObject(object);
  }

  public unregisterCardBandObject(object: Phaser.GameObjects.GameObject): void {
    this.viewLayers?.unregisterCardBandObject(object);
  }

  private cleanupSceneListeners() {
    PhaserEventBus.off(PhaserEvents.RoomGameEnd, this.handleRoomGameEnd, this);
    PhaserEventBus.off(PhaserEvents.ToggleOnlinePauseMenu, this.onToggleOnlinePauseMenu, this);
    CombatManager.Instance.Eventbus.off('onCombatPause', this.onCombatPauseHandler);
    CombatManager.Instance.Eventbus.off('onCombatResume', this.onCombatResumeHandler);
    this.offNotifyFlagWave?.();
    this.offNotifyFlagWave = null;
  }

  /**
   * 幂等拆掉本局所有跨局残留：全局事件监听、单例 manager、UI 与静态缓存。
   * 正常结算、SHUTDOWN、DESTROY 三条路径都会进入这里，先到者生效。
   */
  private teardownSession() {
    if (this.hasTornDown) return;
    this.hasTornDown = true;

    this.cleanupSceneListeners();

    ConsoleCmd.uninstall(this);
    this.hud?.destroy();
    this.hud = null;
    this.viewLayers?.destroy();
    this.viewLayers = null;
    this.mediaReadiness = null;

    const pauseMenu = (this as any).pauseMenu as import('../ui/menu/PauseMenu').PauseMenu | null;
    if (pauseMenu) {
      pauseMenu.destroy();
      (this as any).pauseMenu = null;
    }

    // 移除所有对 game 的监听，停止所有事件响应。DESTROY 阶段 Phaser 尚未
    // 清空这些插件，但部分插件可能已 shutdown，用 ?. 与 try 兜底。
    try {
      this.sound?.stopAll();
      this.input?.keyboard?.removeAllKeys(true, true);
      this.input?.keyboard?.removeAllListeners();
      this.tweens?.killAll();
      this.input?.keyboard?.removeAllKeys();
      this.input?.off('pointerup');
      this.input?.off('pointermove');
    } catch (error) {
      console.warn('[Game] teardownSceneInput skipped.', error);
    }

    // 投射物注册表与序号不在 ManagerGroup 里，必须显式跨局清理：
    // 它们进入状态摘要，上一局残留会让新一局第一帧就分叉。
    ProjectileCmd.clearProjectiles(this);

    // 只重置仍绑定到本场景的 manager：极端时序下若新一局已 setScene，
    // 不能把新一局刚 Load 好的状态清掉。
    for (const manager of this.ManagerGroup) {
      if (manager.getScene() === this) {
        manager.Reset();
      }
    }
    this.ManagerGroup = [];

    if (Game.preparedScene === this) Game.preparedScene = null;
    const globalGame = window as unknown as { __MVZ443_GAME__?: Game };
    if (globalGame.__MVZ443_GAME__ === this) delete globalGame.__MVZ443_GAME__;
  }

  // 游戏退出真实入口, 由消息队列调用
  private handleRoomGameEnd({ isWin = false }: { isWin?: boolean } = {}) {
    if (CombatManager.Instance.isDesyncOffline()) {
      CombatManager.Instance.exportDesyncLog();
    }
    CombatManager.Instance.exportNetDebugLog("game-end");
    this.teardownSession();

    this.scene.start('GameOver');
    this.params.gameExit({
      isWin,
      chapterId: this.stageData.chapterId,
      stageId: this.params.level,
      onWin: this.stageData.onWin,
      rewards: this.stageData.rewards,
      progress: isWin ? 100 : MobManager.Instance.progress,
    });
  }

  // game->app 通知游戏的速率变化
  handleSpeedUp(): boolean {
    return CombatManager.Instance.handleTimespeedToggle();
  }

  handleCollision(handle1: number, handle2: number) {
    // 1. 通过 handle 获取 Collider
    const colliderA = this.rapierWorld.getCollider(handle1);
    const colliderB = this.rapierWorld.getCollider(handle2);
    if (!colliderA || !colliderB) return;

    // 2. 获取 Collider 绑定的 RigidBody
    // 【修正】：collider.parent() 直接返回 RigidBody 对象本身
    const bodyA = colliderA.parent();
    const bodyB = colliderB.parent();
    if (!bodyA || !bodyB) return;

    // 3. 拿到你绑定的实体数据 BaseEntity
    const entityA = bodyA.userData as BaseEntity;
    const entityB = bodyB.userData as BaseEntity;
    if (!entityA || !entityB) return;
    //  将碰撞事件广播给两个实体
    entityA.onCollision({
      sourceEntity: entityA,
      targetEntity: entityB,
      sourceCollider: colliderA,
      targetCollider: colliderB,
    });
    entityB.onCollision({
      sourceEntity: entityB,
      targetEntity: entityA,
      sourceCollider: colliderB,
      targetCollider: colliderA,
    });
  }
}
