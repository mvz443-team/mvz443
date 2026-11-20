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
import TileItemManager from '../managers/combat/TileItemManager';
import ConsoleCmd from '../utils/ConsoleCmd';
import { ProjectileCmd } from '../utils/cmd/ProjectileCmd';
import {
  BATTLE_GRID_CELL_HEIGHT,
  BATTLE_GRID_CELL_WIDTH,
  BATTLE_GRID_COLS,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
  MOBILE_BATTLE_LEFT_CART_OVERSCAN_COLS,
  MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO,
  MOBILE_BATTLE_RIGHT_OVERSCAN_COLS,
} from '../../constants/gameLayout';
import {
  LEGACY_BALANCE_FRAME_INTERVAL_MS,
  getRapierTimestepSeconds
} from '../../constants/physics';
import { CardSlots } from '../ui/cardslots';
import { BottomBar } from '../ui/bottom';
import { MobileBottomBar } from '../ui/bottom_mobile';
import { installRuntimeStateSources, registerPhysicsSource } from '../core/RuntimeStateBridge';
import { onlineStateManager } from '../../store/OnlineStateManager';
import NetStatusBadge, { type NetBadgeState } from '../ui/NetStatusBadge';
import { desyncDiagnostics } from '../../utils/debug/desyncDiagnostics';


export class Game extends Scene {
  private ManagerGroup: BaseManager[] = [];
  private scaleFactor: number = 1;
  private battleCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private uiCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private readonly cameraLayerState = new WeakMap<Phaser.GameObjects.GameObject, "battle" | "ui">();
  private readonly uiDepthThreshold = DepthHelper.UI.threshold();

  public innerSettings: GameSettings;

  public rapierWorld: RAPIER.World;
  public rapierEventQueue: RAPIER.EventQueue;


  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;
  gameText: Phaser.GameObjects.Text;

  pauseBtn: Phaser.GameObjects.Text;
  speedText: Phaser.GameObjects.Text;
  debugFrameText: Phaser.GameObjects.Text | null = null;
  private netStatusBadge: NetStatusBadge | null = null;
  private frameWaitExceeded = false;
  private cardSlotsUi: CardSlots | null = null;
  private bottomBarUi: BottomBar | MobileBottomBar | null = null;

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
    return this.cardSlotsUi?.getDisplayedEnergyText() ?? null;
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
      await Game.prepareBattle(this, this.params, this.stageData);
    }
    const deviceType = this.params.deviceType ?? 'pc';
    this.scaleFactor = 1;

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

    if (deviceType === 'mobile') {
      this.bottomBarUi = new MobileBottomBar(this);
    } else {
      this.bottomBarUi = new BottomBar(this);
    }
    this.cardSlotsUi = new CardSlots(this);

    this.configureBattleViewCameras(deviceType);
    if (import.meta.env.DEV) {
      (window as unknown as { __MVZ443_GAME__?: Game }).__MVZ443_GAME__ = this;
    }

    this.netStatusBadge = new NetStatusBadge(
      this,
      gameViewport.x + 8 * this.scaleFactor,
      gameViewport.y + 8 * this.scaleFactor,
      Math.max(24, Math.round(this.scale.displaySize.width / 42)),
      DepthHelper.UI.waitingText(),
    );

    if (this.innerSettings.basicDebug) {
      const sceneBounds = PositionManager.Instance.getSceneBounds(deviceType);
      this.debugFrameText = this.add.text(
        8,
        sceneBounds.height - 64,
        'frameId: 0\nackFrameId: 0',
        {
          fontSize: '12px',
          color: '#b8ffb5',
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          padding: { x: 6, y: 4 },
        }
      ).setOrigin(0, 1).setDepth(DepthHelper.UI.debugFrameText());
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
    await Promise.all([
      this.waitForAudioCacheReady(),
      this.waitForVideoCacheReady(),
      this.waitForBrowserMediaTick(),
    ]);
  }

  private async waitForAudioCacheReady(): Promise<void> {
    const audioCache = this.cache.audio;
    const keys = audioCache.getKeys();
    const waits: Array<Promise<void>> = [];
    const supportsAudioBuffer = typeof AudioBuffer !== "undefined";

    for (const key of keys) {
      const data = audioCache.get(key);

      if (supportsAudioBuffer && data instanceof AudioBuffer) {
        if (data.duration <= 0) {
          throw new Error(`Decoded audio "${key}" has invalid duration.`);
        }
        continue;
      }

      if (Array.isArray(data)) {
        for (const audio of data) {
          if (audio instanceof HTMLMediaElement) {
            waits.push(this.waitForMediaElementReady(audio, `audio:${key}`));
          }
        }
      }
    }

    await Promise.all(waits);
  }

  private async waitForVideoCacheReady(): Promise<void> {
    const videoCache = this.cache.video;
    const keys = videoCache.getKeys();
    const waits: Array<Promise<void>> = [];

    for (const key of keys) {
      const data = videoCache.get(key) as {
        url?: string;
        noAudio?: boolean;
        crossOrigin?: string;
      } | null;

      if (!data?.url) {
        continue;
      }

      const video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      video.muted = true;
      if (data.crossOrigin) {
        video.crossOrigin = data.crossOrigin;
      }
      video.src = data.url;

      waits.push(
        this.waitForMediaElementReady(video, `video:${key}`).finally(() => {
          video.removeAttribute("src");
          video.load();
        })
      );
    }

    await Promise.all(waits);
  }

  private waitForMediaElementReady(media: HTMLMediaElement, label: string): Promise<void> {
    const enoughData = () => media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
    if (enoughData()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`${label} did not become ready in time.`));
      }, 20000);

      const onReady = () => {
        if (!enoughData()) {
          return;
        }
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error(`${label} failed to load.`));
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        media.removeEventListener("loadeddata", onReady);
        media.removeEventListener("canplay", onReady);
        media.removeEventListener("canplaythrough", onReady);
        media.removeEventListener("error", onError);
      };

      media.addEventListener("loadeddata", onReady);
      media.addEventListener("canplay", onReady);
      media.addEventListener("canplaythrough", onReady);
      media.addEventListener("error", onError);

      try {
        media.load();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  private waitForBrowserMediaTick(): Promise<void> {
    return new Promise(resolve => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
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
    this.updateNetStatusBadge();
    DebugManager.Instance.update();
    this.syncCameraLayers();
    if (this.debugFrameText && this.innerSettings.basicDebug) {
      this.debugFrameText.setText(`frameId: ${BackendWS.FrameID}\nackFrameId: ${BackendWS.AckFrameID}`);
    }
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

  private updateNetStatusBadge(): void {
    if (!this.netStatusBadge) return;
    let state: NetBadgeState = { kind: "offline" };
    if (BackendWS.isDesyncOfflineMode() || CombatManager.Instance.isDesyncOffline()) {
      state = { kind: "desync" };
    } else if (BackendWS.isReconnecting()) {
      state = { kind: "reconnecting" };
    } else if (BackendWS.isOnlineMode() || BackendWS.isMockRoomMode()) {
      const latency = BackendWS.getAverageLatencyMs();
      state = latency === null ? { kind: "offline" } : { kind: "latency", latencyMs: latency };
    }
    this.netStatusBadge.update(state);
  }

  changeScene() {
    this.scene.start('GameOver');
  }

  public isFrameWaiting(): boolean {
    return this.frameWaitExceeded;
  }

  public toggleFrameWaiting(waiting: boolean): void {
    this.frameWaitExceeded = waiting;
    this.updateNetStatusBadge();
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
    const camera = this.battleCamera ?? this.cameras.main;
    const point = camera.getWorldPoint(pointer.x, pointer.y);
    return { x: point.x, y: point.y };
  }

  private configureBattleViewCameras(deviceType: string) {
    const layout = PositionManager.Instance.getSceneChromeLayout(deviceType);
    const viewport = layout.mainViewport;
    const gridBounds = PositionManager.Instance.getGridBounds();
    const cameraView = deviceType === "mobile"
      ? this.getMobileBattleCameraView(viewport, gridBounds)
      : this.getDesktopBattleCameraView(viewport);

    this.battleCamera = this.cameras.main;
    this.battleCamera.setName("battle");
    this.battleCamera.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.battleCamera.setZoom(cameraView.zoom);
    this.battleCamera.setScroll(cameraView.scrollX, cameraView.scrollY);
    this.battleCamera.setBackgroundColor('rgba(0,0,0,0)');

    this.uiCamera = this.cameras.add(
      0,
      0,
      layout.sceneBounds.width,
      layout.sceneBounds.height,
      false,
      "ui",
    );
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.setZoom(1);
    this.uiCamera.setBackgroundColor('rgba(0,0,0,0)');
    this.syncCameraLayers();
  }

  private getMobileBattleCameraView(viewport: Phaser.Geom.Rectangle | { width: number; height: number }, gridBounds: { x: number; y: number; width: number; height: number }) {
    const rowCount = PositionManager.Instance.getRowCount();
    const rowTuning = this.getMobileCameraRowTuning(rowCount);
    const topCrop = BATTLE_GRID_CELL_HEIGHT * rowTuning.topCropRows;
    const bottomOverscanRatio = Math.max(
      MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO,
      rowTuning.bottomOverscanRows,
    );
    const bottomOverscan = BATTLE_GRID_CELL_HEIGHT * bottomOverscanRatio;
    const targetHeight = gridBounds.height - topCrop + bottomOverscan;
    const verticalZoom = viewport.height / targetHeight * rowTuning.zoomScale;
    const worldViewX = gridBounds.x
      - BATTLE_GRID_CELL_WIDTH * MOBILE_BATTLE_LEFT_CART_OVERSCAN_COLS;
    const worldViewRight = gridBounds.x
      + gridBounds.width
      + BATTLE_GRID_CELL_WIDTH * MOBILE_BATTLE_RIGHT_OVERSCAN_COLS;
    const targetWorldWidth = Math.max(1, worldViewRight - worldViewX);
    const widthZoom = viewport.width / targetWorldWidth;
    const zoom = Math.min(verticalZoom, widthZoom);

    const scroll = this.getCameraScrollForWorldView(
      worldViewX,
      gridBounds.y + topCrop,
      viewport.width,
      viewport.height,
      zoom,
    );

    return { zoom, ...scroll };
  }

  /**
  根据行数返回移动端摄像机的调优参数。
  返回对象字段含义：
  topCropRows: 从网格顶部裁剪的“行数”（可为小数）。实际顶部裁剪像素 = topCropRows * BATTLE_GRID_CELL_HEIGHT。
  bottomOverscanRows: 底部的超出/外溢“行数”（可为小数）。函数内部会与常量 MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO 取最大值，再乘以 BATTLE_GRID_CELL_HEIGHT 得到底部像素超出量。
  zoomScale: 额外的缩放系数，作用于基于视口与目标高度计算出的 zoom（>1 表示放大，<1 表示缩小，1 表示不变）。
  horizontalShiftCols: 横向左移量，单位是网格列宽。值越大，战斗画面越向左贴近卡槽，右侧显示越多。
*/
  private getMobileCameraRowTuning(rowCount: number): { topCropRows: number; bottomOverscanRows: number; zoomScale: number; horizontalShiftCols: number } {
    if (rowCount >= 5) {
      // Negative crop keeps the top minecart above row 0 fully visible.
      return { topCropRows: -0.15, bottomOverscanRows: 0.1, zoomScale: 1, horizontalShiftCols: 0 };
    }
    return { topCropRows: -0.5, bottomOverscanRows: 0.5, zoomScale: 0.95, horizontalShiftCols: 0 };

    // return { topCropRows: 0, bottomOverscanRows: MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO, zoomScale: 1 };
  }

  private getDesktopBattleCameraView(viewport: Phaser.Geom.Rectangle | { width: number; height: number }) {
    const zoom = Math.max(
      viewport.width / LOGICAL_BATTLE_WIDTH,
      viewport.height / LOGICAL_BATTLE_HEIGHT,
    );
    const visibleWidth = viewport.width / zoom;
    const visibleHeight = viewport.height / zoom;
    const worldViewX = (LOGICAL_BATTLE_WIDTH - visibleWidth) / 2;
    const worldViewY = (LOGICAL_BATTLE_HEIGHT - visibleHeight) / 2;
    const scroll = this.getCameraScrollForWorldView(
      worldViewX,
      worldViewY,
      viewport.width,
      viewport.height,
      zoom,
    );

    return { zoom, ...scroll };
  }

  /**
   * Phaser's camera scroll is the center anchor, while worldView describes the
   * top-left of the visible world. Convert one to the other so FIT scaling never
   * leaves an off-center gap next to the UI chrome.
   */
  private getCameraScrollForWorldView(
    worldViewX: number,
    worldViewY: number,
    viewportWidth: number,
    viewportHeight: number,
    zoom: number,
  ) {
    return {
      scrollX: worldViewX + (viewportWidth / zoom - viewportWidth) / 2,
      scrollY: worldViewY + (viewportHeight / zoom - viewportHeight) / 2,
    };
  }

  private syncCameraLayers() {
    if (!this.battleCamera || !this.uiCamera) {
      return;
    }

    for (const object of this.children.list) {
      const depth = (object as Phaser.GameObjects.GameObject & { depth?: number }).depth ?? 0;
      const layer = depth >= this.uiDepthThreshold ? "ui" : "battle";
      if (this.cameraLayerState.get(object) === layer) {
        continue;
      }

      this.cameraLayerState.set(object, layer);
      this.setCameraIgnore(this.battleCamera, object, layer === "ui");
      this.setCameraIgnore(this.uiCamera, object, layer === "battle");
    }
  }

  private setCameraIgnore(
    camera: Phaser.Cameras.Scene2D.Camera,
    object: Phaser.GameObjects.GameObject,
    ignored: boolean,
  ) {
    if (ignored) {
      camera.ignore(object);
      return;
    }

    object.cameraFilter &= ~camera.id;
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
    this.debugFrameText?.destroy();
    this.debugFrameText = null;
    this.netStatusBadge?.destroy();
    this.netStatusBadge = null;
    this.cardSlotsUi?.destroy();
    this.cardSlotsUi = null;
    this.bottomBarUi?.destroy();
    this.bottomBarUi = null;

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
