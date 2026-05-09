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
import { SendLoaded } from '../../utils/net/room';
import {
  BATTLE_GRID_CELL_HEIGHT,
  BATTLE_GRID_CELL_WIDTH,
  BATTLE_GRID_LEFT_CART_MARGIN_RATIO,
  BATTLE_GRID_COLS,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
  MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO,
} from '../../constants/gameLayout';
import {
  LEGACY_BALANCE_FRAME_INTERVAL_MS,
  getRapierTimestepSeconds,
  normalizeGameUpdateIntervalMs
} from '../../constants/physics';
import { CardSlots } from '../ui/cardslots';
import { MobileCardSlots } from '../ui/cardslots_mobile';
import { BottomBar } from '../ui/bottom';
import { MobileBottomBar } from '../ui/bottom_mobile';


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
  waitText: Phaser.GameObjects.Text;
  speedText: Phaser.GameObjects.Text;
  debugFrameText: Phaser.GameObjects.Text | null = null;
  private waitTextVisibleTarget: boolean = false;
  private cardSlotsUi: CardSlots | MobileCardSlots | null = null;
  private bottomBarUi: BottomBar | MobileBottomBar | null = null;

  params: GameParams;

  public stageData: StageData;

  private readonly onCombatPauseHandler = () => {
    this.handlePause({ paused: true });
  };
  private readonly onCombatResumeHandler = () => {
    this.handlePause({ paused: false });
  };
  private offNotifyFlagWave: (() => void) | null = null;
  private readonly onNotifyFlagWaveHandler = () => {
    this.broadCastFlag();
  };


  constructor() {
    console.log('Game constructor');
    super('Game');
  }

  preload() {
    BackendWS.FrameID = 0;
    this.params = this.game.registry.get('gameParams') as GameParams;
    this.stageData = this.cache.json.get(`ch${this.params.level}`) as StageData;
    this.innerSettings = this.params.gameSettings;

    this.ManagerGroup = [
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

    // Audio must be initialized before the room loaded signal is sent.
    // Preloader has already decoded the assets, so this creates BGM/SFX objects
    // during Game.preload instead of waiting for Game.create.
    SoundManager.Instance.setScene(this);
    SoundManager.Instance.Load();
  }

  async create() {
    // read external data
    // TODO : 根据type具体判断放置那张背景图
    this.params = this.game.registry.get('gameParams') as GameParams;
    this.innerSettings = this.params.gameSettings;
    const frameIntervalMs = this.applyFrameIntervalSettings();
    const deviceType = this.params.deviceType ?? 'pc';
    this.scaleFactor = 1;
    PositionManager.Instance.setSceneViewportSize(
      this.params.mainViewportWidth ?? LOGICAL_BATTLE_WIDTH,
      this.params.mainViewportHeight ?? LOGICAL_BATTLE_HEIGHT,
      deviceType,
    );

    // 初始化各个Manager
    for (const manager of this.ManagerGroup) {
      manager.setScene(this);
      manager.Load();
    }

    PositionManager.Instance.setStageGrid(1, this.stageData.rows, BATTLE_GRID_COLS, { deviceType });
    const gridProperties = new Array(PositionManager.Instance.Row_Number)
      .fill(0).map(() => new Array(PositionManager.Instance.Col_Number).fill('ground')); //  默认全为地板
    GridManager.Instance.setGridProperty(gridProperties);

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
      this.cardSlotsUi = new MobileCardSlots(this);
    } else {
      this.cardSlotsUi = new CardSlots(this);
      this.bottomBarUi = new BottomBar(this);
    }

    this.configureBattleViewCameras(deviceType);

    // 创建一个waiting text
    this.waitText = this.add.text(
      gameViewport.x + gameViewport.width / 2,
      gameViewport.y + 18 * this.scaleFactor,
      translate("game.waiting"),
      {
        fontSize: `${Math.max(12, Math.round(this.scale.displaySize.width / 45))}px`,
        color: '#ffffff',
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
        padding: { x: 8, y: 3 },
      }
    ).setOrigin(0.5, 0).setDepth(DepthHelper.UI.waitingText()).setVisible(false).setAlpha(0);

    if (this.innerSettings.isDebug) {
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

    // 初始化物理世界
    await RAPIER.init();
    this.rapierWorld = new RAPIER.World({ x: 0, y: 0 }); // 无重力的物理世界
    this.rapierWorld.timestep = getRapierTimestepSeconds(frameIntervalMs);
    this.rapierEventQueue = new RAPIER.EventQueue(true);



    if (this.innerSettings.isDebug) {
      // 调试模式下可以添加可视化代码
      // TODO: 实现 RAPIER 的调试可视化
    }

    PhaserEventBus.on(PhaserEvents.RoomGameEnd, this.handleRoomGameEnd, this);
    CombatManager.Instance.Eventbus.on('onCombatPause', this.onCombatPauseHandler);
    CombatManager.Instance.Eventbus.on('onCombatResume', this.onCombatResumeHandler);
    this.offNotifyFlagWave = MobManager.Instance.EventBus.on('onNotifyFlagWave', this.onNotifyFlagWaveHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupSceneListeners, this);

    ConsoleCmd.install(this);

    console.log('load finish');
    if (BackendWS.isRoomSessionMode()) {
      try {
        await this.waitForMediaReady();
        SendLoaded(true);
      } catch (error) {
        console.error("[Game] media assets are not ready; loaded signal was not sent.", error);
      }
    }
  }

  private applyFrameIntervalSettings(): number {
    const frameIntervalMs = BackendWS.isOnlineMode()
      ? LEGACY_BALANCE_FRAME_INTERVAL_MS
      : normalizeGameUpdateIntervalMs(this.params.gameSettings.gameUpdateIntervalMs);

    this.innerSettings.gameUpdateIntervalMs = frameIntervalMs;
    SyncManager.Instance.setFrameIntervalMs(frameIntervalMs);
    TickerManager.Instance.setFrameInterval(frameIntervalMs);
    return frameIntervalMs;
  }

  private async waitForMediaReady(): Promise<void> {
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

    for (const key of keys) {
      const data = audioCache.get(key);

      if (data instanceof AudioBuffer) {
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

  update(time: number, delta: number): void {
    CombatManager.Instance.update(time, delta);
    DebugManager.Instance.update();
    this.syncCameraLayers();
    this.updateWaitText(delta);
    if (this.debugFrameText && this.innerSettings.isDebug) {
      this.debugFrameText.setText(`frameId: ${BackendWS.FrameID}\nackFrameId: ${BackendWS.AckFrameID}`);
    }
  }

  public setWaitTextVisibleTarget(visible: boolean) {
    this.waitTextVisibleTarget = visible;
    if (visible) {
      this.waitText.setVisible(true);
    }
  }

  private updateWaitText(delta: number) {
    if (!this.waitText) {
      return;
    }

    const targetAlpha = this.waitTextVisibleTarget ? 0.92 : 0;
    const fadeSpeed = Math.min(1, delta / 180);
    const nextAlpha = Phaser.Math.Linear(this.waitText.alpha, targetAlpha, fadeSpeed);
    this.waitText.setAlpha(nextAlpha);

    if (!this.waitTextVisibleTarget && nextAlpha <= 0.03) {
      this.waitText.setVisible(false);
      this.waitText.setAlpha(0);
      return;
    }

    if (this.waitTextVisibleTarget) {
      this.waitText.setVisible(true);
    }
  }

  changeScene() {
    this.scene.start('GameOver');
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
    this.setWaitTextVisibleTarget(false);
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
    const leftCartMargin = BATTLE_GRID_CELL_WIDTH * BATTLE_GRID_LEFT_CART_MARGIN_RATIO;
    const topCrop = BATTLE_GRID_CELL_HEIGHT * rowTuning.topCropRows;
    const bottomOverscanRatio = Math.max(
      MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO,
      rowTuning.bottomOverscanRows,
    );
    const bottomOverscan = BATTLE_GRID_CELL_HEIGHT * bottomOverscanRatio;
    const targetHeight = gridBounds.height - topCrop + bottomOverscan;
    const zoom = viewport.height / targetHeight * rowTuning.zoomScale;

    return {
      zoom,
      scrollX: gridBounds.x - leftCartMargin,
      scrollY: gridBounds.y + topCrop,
    };
  }

  /**
  根据行数返回移动端摄像机的调优参数。
  返回对象字段含义：
  topCropRows: 从网格顶部裁剪的“行数”（可为小数）。实际顶部裁剪像素 = topCropRows * BATTLE_GRID_CELL_HEIGHT。
  bottomOverscanRows: 底部的超出/外溢“行数”（可为小数）。函数内部会与常量 MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO 取最大值，再乘以 BATTLE_GRID_CELL_HEIGHT 得到底部像素超出量。
  zoomScale: 额外的缩放系数，作用于基于视口与目标高度计算出的 zoom（>1 表示放大，<1 表示缩小，1 表示不变）。
*/
  private getMobileCameraRowTuning(rowCount: number): { topCropRows: number; bottomOverscanRows: number; zoomScale: number } {
    if (rowCount >= 7) {
      return { topCropRows: 1.14, bottomOverscanRows: 0.55, zoomScale: 0.90 };
    }
    if (rowCount >= 6) {
      return { topCropRows: 0.58, bottomOverscanRows: 0.55, zoomScale: 0.95 };
    }
    if (rowCount >= 5) {
      return { topCropRows: 0.1, bottomOverscanRows: 0.1, zoomScale: 0.97 };
    }
    return { topCropRows: -0.5, bottomOverscanRows: 0.5, zoomScale: 0.95 };

    // return { topCropRows: 0, bottomOverscanRows: MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO, zoomScale: 1 };
  }

  private getDesktopBattleCameraView(viewport: Phaser.Geom.Rectangle | { width: number; height: number }) {
    const zoom = Math.min(
      viewport.width / LOGICAL_BATTLE_WIDTH,
      viewport.height / LOGICAL_BATTLE_HEIGHT,
    );
    const visibleWidth = viewport.width / zoom;
    const visibleHeight = viewport.height / zoom;

    return {
      zoom,
      scrollX: (LOGICAL_BATTLE_WIDTH - visibleWidth) / 2,
      scrollY: (LOGICAL_BATTLE_HEIGHT - visibleHeight) / 2,
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
    CombatManager.Instance.Eventbus.off('onCombatPause', this.onCombatPauseHandler);
    CombatManager.Instance.Eventbus.off('onCombatResume', this.onCombatResumeHandler);
    this.offNotifyFlagWave?.();
    this.offNotifyFlagWave = null;
  }

  // 游戏退出真实入口, 由消息队列调用
  private handleRoomGameEnd({ isWin = false }: { isWin?: boolean } = {}) {
    this.cleanupSceneListeners();

    ConsoleCmd.uninstall(this);
    SoundManager.Instance.Reset();
    this.debugFrameText?.destroy();
    this.debugFrameText = null;
    this.cardSlotsUi?.destroy();
    this.cardSlotsUi = null;
    this.bottomBarUi?.destroy();
    this.bottomBarUi = null;

    // 销毁暂停菜单
    const pauseMenu = (this as any).pauseMenu;
    if (pauseMenu) {
      pauseMenu.destroy();
    }

    // 移除所有对game的监听，停止所有事件响应
    this.sound.stopAll();
    this.input.keyboard?.removeAllKeys(true, true);
    this.input.keyboard?.removeAllListeners();
    this.tweens.killAll();

    this.input.keyboard?.removeAllKeys(); // Clean up keyboard listeners
    this.input.off('pointerup'); // Remove pointer listeners
    this.input.off('pointermove');

    // TODO: Reset managers
    for (const manager of this.ManagerGroup) {
      manager.Reset();
    }

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
