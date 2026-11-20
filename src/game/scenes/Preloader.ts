import { Scene } from 'phaser';
import { GameParams } from '../models/GameParams';
import type { PreloadData, StageData } from '../../types/stage';
import { StageDataRecords } from '../managers/library/ChapterLibrary';
import { PlantLibrary } from '../managers/library/PlantLibrary';
import {
  getLevelBadgeAssetPath,
  getLevelBadgeTextureKey,
  LEVEL_BADGE_TEXTURE_LEVELS,
} from '../ui/levelBadgeSvg';
import { translate } from '../../i18n';
import { publicUrl } from '../../utils/browser';
import { PhaserEventBus, PhaserEvents } from '../EventBus';
import { SendPlayerLoaded } from '../../utils/net/room';
import BackendWS from '../../utils/net/sync';
import { onlineStateManager } from '../../store/OnlineStateManager';
import type { PlayerSyncInfo } from '../../types/online';
import { Game } from './Game';
import { desyncDiagnostics } from '../../utils/debug/desyncDiagnostics';

type LoadPhase = 'loadAssets' | 'loadAudio' | 'initBattle' | 'waitSync';

const PHASE_ORDER: LoadPhase[] = ['loadAssets', 'loadAudio', 'initBattle', 'waitSync'];

/**
 * LoadScene：分四阶段加载并与服务端同步。
 * 1. 加载素材资源（1..50）
 * 2. 加载音乐音效资源（51..90）
 * 3. 初始化战局（91..99，完成后上报 100 = 等待同步）
 * 4. 等待玩家同步中：展示各玩家进度；收到 roomAllSync 后瞬间切到 MainGame
 */
export class Preloader extends Scene {
  private phaseText: Phaser.GameObjects.Text | null = null;
  private progressText: Phaser.GameObjects.Text | null = null;
  private playerTexts: Phaser.GameObjects.Text[] = [];
  private progressBar: Phaser.GameObjects.Rectangle | null = null;
  private progressBarWidth = 0;

  private lastProgressSent = -1;
  private syncPlayers: PlayerSyncInfo[] = [];
  private battleReady = false;
  private allSyncReceived = false;
  private switching = false;
  private disposers: Array<() => void> = [];

  constructor() {
    super('Preloader');
  }

  init() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const progressBarWidth = width * 0.6;
    const centerX = width / 2;
    const centerY = height / 2;
    this.progressBarWidth = progressBarWidth;

    this.add.rectangle(centerX, centerY + 20, progressBarWidth, 24).setStrokeStyle(1, 0xffffff);
    this.progressBar = this.add.rectangle(
      centerX - progressBarWidth / 2 + 2, centerY + 20, 4, 20, 0x00ccff,
    ).setOrigin(0, 0.5);

    this.phaseText = this.add.text(centerX, centerY - 70, '', {
      fontSize: '22px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.progressText = this.add.text(centerX, centerY + 52, '0%', {
      fontSize: '15px', color: '#9fe8ff',
    }).setOrigin(0.5);

    this.setPhase('loadAssets', 0);
    this.renderPlayers();
  }

  // 资源改由 create() 分阶段加载，便于按阶段上报 playerLoaded 进度。
  preload() {
    // no-op
  }

  async create() {
    const params = this.game.registry.get('gameParams') as GameParams;
    this.bindSignals();
    this.syncPlayers = onlineStateManager.getRoomSyncPlayers();
    this.renderPlayers();

    // 重连回到已开战的房间：仍需预热战局，但不再等待同步信号。
    const reconnectInGame = onlineStateManager.isInGame();
    desyncDiagnostics.record('preloader', 'create', {
      reconnectInGame,
      level: params.level,
      frameId: BackendWS.FrameID,
      roomAllReady: onlineStateManager.getRoomAllReady(),
    });
    try {
      const stageData = await this.loadStageJson(params);
      await this.runLoaderPhase('loadAssets', 1, 50, () => {
        this.load.setPath('assets');
        this.loadAllMonster();
        this.loadAllPlant(params.plants);
        this.loadAllProjectile();
        this.loadAllSprite();
        this.queueStageImages(stageData.load, params);
      });

      await this.runLoaderPhase('loadAudio', 51, 90, () => {
        this.load.setPath('assets');
        this.load.audioSprite('sfx', 'audio/sounds/sfx-sprite.json', 'audio/sounds/sfx-sprite.ogg');
        this.queueStageAudio(stageData.load);
      });

      const gameScene = this.scene.get('Game') as Game;
      await gameScene.waitForMediaReady();

      this.setPhase('initBattle', 91);
      this.reportProgress(91);
      await Game.prepareBattle(gameScene, params, stageData);
      this.reportProgress(96);
      this.battleReady = true;
      desyncDiagnostics.record('preloader', 'battle ready', {
        frameId: BackendWS.FrameID,
        allSyncReceived: this.allSyncReceived,
      });

      // 100 = 资源与战局全部就绪，进入等待同步。
      this.reportProgress(100);

      if (reconnectInGame || this.allSyncReceived) {
        this.switchToGame();
        return;
      }
      this.setPhase('waitSync', 100);
    } catch (error) {
      console.error('[Preloader] load phase failed', error);
      this.progressText?.setText('load error');
    }
  }

  private bindSignals() {
    const onRoomSync = (event: { players: PlayerSyncInfo[] }) => {
      this.syncPlayers = event.players ?? [];
      this.renderPlayers();
    };
    const onRoomAllSync = () => {
      desyncDiagnostics.record('preloader', 'RoomAllSync', {
        battleReady: this.battleReady,
        frameId: BackendWS.FrameID,
      });
      this.allSyncReceived = true;
      this.switchToGame();
    };
    PhaserEventBus.on(PhaserEvents.RoomSync, onRoomSync);
    PhaserEventBus.on(PhaserEvents.RoomAllSync, onRoomAllSync);
    const cleanup = () => {
      PhaserEventBus.off(PhaserEvents.RoomSync, onRoomSync);
      PhaserEventBus.off(PhaserEvents.RoomAllSync, onRoomAllSync);
    };
    this.disposers.push(cleanup);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const dispose of this.disposers) {
        dispose();
      }
      this.disposers = [];
    });
  }

  private switchToGame() {
    if (this.switching || !this.battleReady) {
      return;
    }
    desyncDiagnostics.record('preloader', 'switchToGame', {
      frameId: BackendWS.FrameID,
      allSyncReceived: this.allSyncReceived,
    });
    this.switching = true;
    this.scene.start('Game');
  }

  private async loadStageJson(params: GameParams): Promise<StageData> {
    const stageRecord = StageDataRecords[params.level];
    if (!stageRecord) {
      throw new Error(`Stage ${params.level} is not registered.`);
    }
    const response = await fetch(`${publicUrl}/${stageRecord.dataPath}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch stage data: ${response.status}`);
    }
    const data = await response.json() as StageData;
    const key = `ch${params.level}`;
    if (this.cache.json.exists(key)) {
      this.cache.json.remove(key);
    }
    this.cache.json.add(key, data);
    return data;
  }

  /** 启动一批 Phaser loader 资源，并把 0..1 的进度映射到当前阶段的 1..100 区间。 */
  private runLoaderPhase(phase: LoadPhase, min: number, max: number, queue: () => void): Promise<void> {
    return new Promise((resolve) => {
      this.setPhase(phase, min);
      queue();
      const onProgress = (progress: number) => {
        const value = min + Math.floor((max - min) * Math.max(0, Math.min(1, progress)));
        this.updateProgress(value);
        this.reportProgress(value);
      };
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.load.off('progress', onProgress);
        this.updateProgress(max);
        this.reportProgress(max);
        resolve();
      };
      this.load.on('progress', onProgress);
      this.load.once('complete', finish);
      this.load.start();
    });
  }

  private reportProgress(value: number) {
    const normalized = Math.max(0, Math.min(100, Math.floor(value)));
    if (normalized <= this.lastProgressSent) {
      return;
    }
    this.lastProgressSent = normalized;
    SendPlayerLoaded(normalized);
  }

  private setPhase(phase: LoadPhase, progress: number) {
    const index = PHASE_ORDER.indexOf(phase);
    const label = translate(`game.${phase}`) || phase;
    this.phaseText?.setText(`${index + 1}/4  ${label}`);
    this.updateProgress(progress);
  }

  private updateProgress(progress: number) {
    const value = Math.max(0, Math.min(100, Math.floor(progress)));
    this.progressText?.setText(`${value}%`);
    if (this.progressBar) {
      this.progressBar.width = Math.max(4, (this.progressBarWidth - 4) * value / 100);
    }
  }

  private renderPlayers() {
    const count = Math.max(2, this.syncPlayers.length);
    for (let index = 0; index < count; index += 1) {
      let text = this.playerTexts[index];
      if (!text) {
        const width = this.cameras.main.width;
        const centerY = this.cameras.main.height / 2;
        text = this.add.text(width / 2, centerY + 92 + index * 26, '', {
          fontSize: '15px', color: '#ddd', fontFamily: 'monospace',
        }).setOrigin(0.5);
        this.playerTexts[index] = text;
      }
      const player = this.syncPlayers[index];
      if (!player) {
        text.setText('').setVisible(false);
        continue;
      }
      text.setVisible(true);
      if (player.loaded || player.progress >= 100) {
        text.setText(`✓ ${translate('game.loadPlayerDone', { name: player.name })}`).setColor('#22c55e');
      } else {
        text.setText(translate('game.loadPlayer', { name: player.name, progress: player.progress }))
          .setColor('#dbe8ee');
      }
    }
  }

  // 加载全部器械
  loadAllPlant(_plants: GameParams['plants']) {
    const allRecords = PlantLibrary.GetAllModels();
    for (const record of allRecords) {
      this.load.spritesheet(record.texturePath, record.texturePath + '.png', {
        frameWidth: 64, frameHeight: 64,
      });
      this.load.image(`card/${record.texturePath}`, `card/${record.texturePath}.png`);
    }
  }

  // 加载全部怪物
  loadAllMonster() {
    this.load.image('zombie/zombie', 'zombie/zombie.png');
    this.load.spritesheet('attach/cap', 'attach/cap.png', { frameWidth: 33, frameHeight: 14 });
    this.load.spritesheet('attach/helmet', 'attach/helmet.png', { frameWidth: 33, frameHeight: 14 });
    this.load.spritesheet('attach/turtle', 'attach/turtle.png', { frameWidth: 33, frameHeight: 14 });
    this.load.image('attach/hd_pickaxe', 'attach/hd_pickaxe.png');
    this.load.image('attach/hd_bow', 'attach/hd_bow.png');
    this.load.image('attach/hd_stick', 'attach/hd_stick.png');
    this.load.image('attach/hd_axe', 'attach/hd_axe.png');
    this.load.spritesheet('attach/hd_shield', 'attach/hd_shield.png', { frameWidth: 32, frameHeight: 32 });
    this.load.image('attach/sign', 'attach/sign.png');
    this.load.image('attach/balloon', 'attach/balloon.png');
    this.load.image('attach/boat1', 'attach/sprBoat/sprBoat_0.png');
    this.load.image('attach/boat2', 'attach/sprBoat/sprBoat_1.png');
  }

  // 加载全部发射物
  loadAllProjectile() {
    this.load.image('bullet/snowball', 'bullet/snowball.png');
    this.load.image('bullet/arrow', 'bullet/arrow.png');
    this.load.image('bullet/minecart', 'bullet/minecart.png');
    this.load.image('bullet/firework', 'bullet/firework.png');
    this.load.image('bullet/Hfirework', 'bullet/Hfirework.png');
  }

  // 加载全部 sprite
  loadAllSprite() {
    this.load.image('pickaxe', 'sprite/pickaxe.png');
    this.load.image('starshards', 'sprite/star.png');
    this.load.image('redstone', 'sprite/redstone.png');
    this.load.spritesheet('anime/death_smoke', 'anime/death_smoke.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('anime/explosion', 'anime/explosion.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('anime/fire', 'anime/fire.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('anime/ice_trail', 'anime/ice_trail.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('anime/lightning_trail', 'anime/lightning_trail.png', { frameWidth: 16, frameHeight: 16 });
    this.load.image('shoot_bomb', 'anime/shoot_bomb.png');
    this.load.spritesheet('anime/dirt_out', 'anime/dirt_out.png', { frameWidth: 64, frameHeight: 64 });
    this.load.image('anime/dirt', 'anime/dirt.png');

    this.load.spritesheet('sprZombieBody', 'sprite/zombie/sprZombieBody.png', { frameWidth: 19, frameHeight: 35 });
    this.load.image('sprZombieHead', 'sprite/zombie/sprZombieHead.png');
    this.load.image('sprZombieArm', 'sprite/zombie/sprZombieArm.png');
    this.load.image('sprZombieLeg', 'sprite/zombie/sprZombieLeg.png');

    this.load.spritesheet('sprSkeletonBody', 'sprite/skeleton/sprSkeletonBody.png', { frameWidth: 19, frameHeight: 35 });
    this.load.image('sprSkeletonHead', 'sprite/skeleton/sprSkeletonHead.png');
    this.load.image('sprSkeletonArm', 'sprite/skeleton/sprSkeletonArm.png');
    this.load.image('sprSkeletonLeg', 'sprite/skeleton/sprSkeletonLeg.png');

    this.load.spritesheet('sprEvokerBody', 'sprite/evoker/sprEvokerBody.png', { frameWidth: 19, frameHeight: 35 });
    this.load.image('sprEvokerHead', 'sprite/evoker/sprEvokerHead.png');
    this.load.image('sprEvokerArm', 'sprite/evoker/sprEvokerArm.png');
    this.load.image('sprEvokerLeg', 'sprite/evoker/sprEvokerLeg.png');

    this.load.spritesheet('sprVindicatorBody', 'sprite/vindicator/sprVindicatorBody.png', { frameWidth: 19, frameHeight: 35 });
    this.load.image('sprVindicatorHead', 'sprite/evoker/sprEvokerHead.png');
    this.load.image('sprVindicatorArm', 'sprite/vindicator/sprVindicatorArm.png');
    this.load.image('sprVindicatorLeg', 'sprite/vindicator/sprVindicatorLeg.png');

    this.load.spritesheet('obsidianBody', 'sprite/obsidian_golem/obsidianBody.png', { frameWidth: 19, frameHeight: 35 });
    this.load.image('obsidianHead', 'sprite/obsidian_golem/obsidianHead.png');
    this.load.image('obsidianArm', 'sprite/obsidian_golem/obsidianArm.png');
    this.load.image('obsidianLeg', 'sprite/obsidian_golem/obsidianLeg.png');
    this.load.image('zombie/mob_obsidian', 'zombie/mob_obsidian.png');

    this.load.spritesheet('sprWardenBody', 'sprite/warden_golem/sprWardenBody.png', { frameWidth: 19, frameHeight: 35 });
    this.load.image('sprWardenHead', 'sprite/warden_golem/sprWardenHead.png');
    this.load.image('sprWardenArm', 'sprite/warden_golem/sprWardenArm.png');
    this.load.image('sprWardenLeg', 'sprite/warden_golem/sprWardenLeg.png');

    this.load.spritesheet('sprMutantBody', 'sprite/mutant/body.png', { frameWidth: 52, frameHeight: 89 });
    this.load.image('sprMutantHead', 'sprite/mutant/head.png');
    this.load.image('sprMutantUpperArm', 'sprite/mutant/upperArm.png');
    this.load.image('sprMutantLowerArm', 'sprite/mutant/lowerArm.png');
    this.load.image('sprMutantUpperLeg', 'sprite/mutant/upperLeg.png');
    this.load.image('sprMutantLowerLeg', 'sprite/mutant/lowerLeg.png');
    this.load.image('sprMutantCover', 'sprite/mutant/cover.png');

    this.load.spritesheet('sprCentipedeCharacter', 'sprite/centipede/sprCentipedeCharacter.png', { frameWidth: 128, frameHeight: 160 });
    this.load.image('sfxCentipedeOrb', 'sprite/centipede/sfxCentipedeOrb.png');
    this.load.image('sfxCentipedeSlash', 'sprite/centipede/sfxCentipedeSlash.png');
    this.load.image('sfxCentipedeSummonRing', 'sprite/centipede/sfxCentipedeSummonRing.png');
    this.load.spritesheet('sfxCentipedeChargeDust', 'sprite/centipede/sfxCentipedeChargeDust.png', { frameWidth: 32, frameHeight: 32 });
    this.load.image('sfxCentipedeMinionOrb', 'sprite/centipede/sfxCentipedeMinionOrb.png');

    this.load.spritesheet('sprCentipedeDeprecatedBody', 'sprite/centipede_deprecated/sprCentipedeBody.png', { frameWidth: 60, frameHeight: 48 });
    this.load.image('sprCentipedeDeprecatedHead', 'sprite/centipede_deprecated/sprCentipedeHead.png');
    this.load.image('sprCentipedeDeprecatedSegment', 'sprite/centipede_deprecated/sprCentipedeSegment.png');
    this.load.image('sprCentipedeDeprecatedJoint', 'sprite/centipede_deprecated/sprCentipedeJoint.png');
    this.load.image('sprCentipedeDeprecatedArm', 'sprite/centipede_deprecated/sprCentipedeArm.png');
    this.load.image('sprCentipedeDeprecatedLeg', 'sprite/centipede_deprecated/sprCentipedeLeg.png');
    this.load.image('sprCentipedeDeprecatedSickle', 'sprite/centipede_deprecated/sprCentipedeSickle.png');

    for (const level of LEVEL_BADGE_TEXTURE_LEVELS) {
      this.load.svg(getLevelBadgeTextureKey(level), getLevelBadgeAssetPath(level), { width: 48, height: 48 });
    }
  }

  private queueStageImages(preloadData: PreloadData, params: GameParams) {
    this.load.image('bgimg', preloadData.bgimg[0]);
    for (let i = 1; i < preloadData.bgimg.length; ++i) {
      this.load.image(`bgimg${i}`, preloadData.bgimg[i]);
    }
    for (const plantID of preloadData.plants || []) {
      const texture = PlantLibrary.GetModel(plantID)?.texturePath;
      if (!texture) {
        continue;
      }
      this.load.spritesheet(texture, texture + '.png', { frameWidth: 64, frameHeight: 64 });
    }
    void params;
  }

  private queueStageAudio(preloadData: PreloadData) {
    this.load.audio('bgm', preloadData.bgm[0]);
    for (let i = 1; i < preloadData.bgm.length; ++i) {
      this.load.audio(`bgm${i}`, preloadData.bgm[i]);
    }
  }
}
