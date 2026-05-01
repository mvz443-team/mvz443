import {
  PhaserEventBus,
  PhaserEvents,
} from '../EventBus';
import { Scene } from 'phaser';
import { PositionManager } from '../managers/view/PositionManager';
import CursorManager from '../managers/combat/CursorManager';
import PlantsManager from '../managers/combat/PlantsManager';
import { GameParams, GameSettings } from '../models/GameParams';
import CreateInnerMenu from '../utils/inner_menu';
import { StageData } from '../models/IRecord';
import BackendWS from '../../utils/net/sync';
import seedrandom from 'seedrandom';
import { translate } from '../../i18n';
import DepthUtils from '../../utils/depth';
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
import StageHelper from '../utils/helper/StageHelper';
import { PresetEventManager } from '../managers/combat/PresetEventManager';
import ConsoleCmd from '../utils/ConsoleCmd';
import { SendLoaded } from '../../utils/net/room';
import { LOGICAL_GAME_WIDTH } from '../../constants/gameLayout';


export class Game extends Scene {
  private ManagerGroup: BaseManager[] = [];
  private scaleFactor: number = 1;

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
    this.scaleFactor = this.scale.gameSize.width / LOGICAL_GAME_WIDTH;

    // 初始化各个Manager
    for (const manager of this.ManagerGroup) {
      manager.setScene(this);
      manager.Load();
    }

    PositionManager.Instance.setStageGrid(this.scaleFactor, this.stageData.rows);
    const gridProperties = new Array(PositionManager.Instance.Row_Number)
      .fill(0).map(() => new Array(PositionManager.Instance.Col_Number).fill('ground')); //  默认全为地板
    GridManager.Instance.setGridProperty(gridProperties);

    const randomPrng = seedrandom.alea(String(CombatManager.Instance.seed));
    const waves = StageHelper.generateStageScript(this.stageData.stageScript, randomPrng, this.params.level);
    MobManager.Instance.setWaves(waves);

    // 菜单
    CreateInnerMenu(this);

    // 设置主摄像机背景颜色
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor('rgba(0,0,0,0)');

    // 添加背景
    this.background = this.add.image(0, 0, 'bgimg');
    // 拉伸裁剪后的图片以填充整个场景宽度，保持高度比例
    this.background.setOrigin(0, 0).setDepth(2).setDisplaySize(this.scale.width, this.scale.height);

    // 调整摄像机位置，确保从 (0, 0) 开始显示
    this.cameras.main.scrollX = 0;
    this.cameras.main.scrollY = 0;

    // 创建一个waiting text
    this.waitText = this.add.text(
      this.cameras.main.width / 2,
      18 * this.scaleFactor,
      translate("game.waiting"),
      {
        fontSize: `${Math.max(12, Math.round(this.scale.displaySize.width / 45))}px`,
        color: '#ffffff',
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
        padding: { x: 8, y: 3 },
      }
    ).setOrigin(0.5, 0).setDepth(DepthUtils.getInGameUIElementDepth(60)).setVisible(false).setAlpha(0);

    if (this.innerSettings.isDebug) {
      this.debugFrameText = this.add.text(
        8,
        this.cameras.main.height - 8,
        'frameId: 0\nackFrameId: 0',
        {
          fontSize: '12px',
          color: '#b8ffb5',
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          padding: { x: 6, y: 4 },
        }
      ).setOrigin(0, 1).setDepth(DepthUtils.getInGameUIElementDepth(61));
    }

    // 初始化物理世界
    await RAPIER.init();
    this.rapierWorld = new RAPIER.World({ x: 0, y: 0 }); // 无重力的物理世界
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
    // 创建新的广播文本
    const zombieText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height * 0.3,
      translate("game.bigWave"),
      {
        fontSize: this.scale.displaySize.width / 20,
        color: 'rgb(187, 21, 21)', // 红色文本
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
        padding: { x: 10, y: 5 },
      }
    ).setOrigin(0.5).setDepth(DepthUtils.getMenuDepth());

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


