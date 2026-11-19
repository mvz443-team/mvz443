import Phaser from "phaser";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import type { Game } from "../scenes/Game";
import { BaseManager } from "./BaseManager";

type PoolItem = {
  sound: Phaser.Sound.BaseSound;
  inUse: boolean;
  baseVolume: number;
};

export class ThrottledAudio {
  private lastPlayTime: Map<string, number> = new Map();

  constructor(
    private scene: Phaser.Scene,
    private throttleDelay: number = 200,
    private getVolume: () => number = () => 1,
  ) { }

  play(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    // 场景销毁或尚未就绪时 cache/sound 会变成 null；音频是纯表现层，
    // 任何异常都不能打断调用方（DeferredManager 出怪、技能 tick 等）。
    const scene = this.scene;
    if (!scene?.cache?.audio?.exists?.("sfx")) return;
    if (!scene?.time || !scene?.sound?.playAudioSprite) return;
    const now = scene.time.now;
    const last = this.lastPlayTime.get(key) ?? Number.NEGATIVE_INFINITY;
    if (now - last < this.throttleDelay) return;

    this.lastPlayTime.set(key, now);
    scene.sound.playAudioSprite("sfx", key, {
      ...config,
      volume: (config?.volume ?? 1) * this.getVolume(),
    });
  }
}

export class AudioPool {
  private pool: PoolItem[] = [];
  private lastPlayTime = Number.NEGATIVE_INFINITY;

  constructor(
    private scene: Phaser.Scene,
    private spriteKey: string,
    private markerName: string,
    poolSize: number = 4,
    private getVolume: () => number = () => 1,
    private throttleDelay = 0,
  ) {
    if (!this.scene?.sound?.addAudioSprite) return;
    for (let i = 0; i < poolSize; i++) {
      const snd = this.scene.sound.addAudioSprite(this.spriteKey);
      this.pool.push({ sound: snd, inUse: false, baseVolume: 1 });
    }
  }

  play(loop: boolean = false, config: Phaser.Types.Sound.SoundConfig = {}): Phaser.Sound.BaseSound | null {
    if (!this.scene?.time) return null;
    const now = this.scene.time.now;
    if (this.throttleDelay > 0 && now - this.lastPlayTime < this.throttleDelay) return null;

    const item = this.pool.find(i => !i.inUse);
    if (!item) return null;

    this.lastPlayTime = now;
    item.inUse = true;
    item.baseVolume = config.volume ?? 1;
    item.sound.once("complete", () => {
      item.inUse = false;
    });
    item.sound.play(this.markerName, {
      ...config,
      volume: item.baseVolume * this.getVolume(),
      loop,
    });

    return item.sound;
  }

  stopAll() {
    this.pool.forEach(item => {
      if (!item.inUse) return;
      item.sound.stop();
      item.inUse = false;
    });
  }

  setVolume(volume: number) {
    this.pool.forEach(item => {
      if (!item.inUse) return;
      const sound = item.sound as Phaser.Sound.BaseSound & { setVolume?: (value: number) => void; volume?: number };
      const nextVolume = item.baseVolume * volume;
      if (sound.setVolume) {
        sound.setVolume(nextVolume);
        return;
      }
      sound.volume = nextVolume;
    });
  }
}

export default class SoundManager extends BaseManager {
  private static _instance: SoundManager;
  protected scene: Game | null = null;

  private bgmVolume = 1;
  private soundAudioVolume = 1;
  private loaded = false;
  private music: Phaser.Sound.BaseSound | null = null;
  private dumpMusic: Phaser.Sound.BaseSound | null = null;

  private unlimitAudio: ThrottledAudio | null = null;
  private plantAudio: ThrottledAudio | null = null;
  private zombieSpawnAudio: ThrottledAudio | null = null;
  private generalHitAudio: ThrottledAudio | null = null;
  private shieldHitAudio: ThrottledAudio | null = null;
  private explodeAudio: ThrottledAudio | null = null;

  private shootArrowPool: AudioPool | null = null;
  private shootFireballPool: AudioPool | null = null;
  private shootFireworkPool: AudioPool | null = null;
  private shootLaserPool: AudioPool | null = null;
  private zombieDeathPool: AudioPool | null = null;
  private skeletonDeathPool: AudioPool | null = null;

  public static get Instance(): SoundManager {
    if (!this._instance) {
      this._instance = new SoundManager();
    }
    return this._instance;
  }

  public Load(): void {
    if (!this.scene) return;
    if (this.loaded) return;

    this.bgmVolume = this.normalizeVolume(
      this.scene.params.gameSettings.bgmVolume ?? (this.scene.params.gameSettings.isBgm ? 1 : 0)
    );
    this.soundAudioVolume = this.normalizeVolume(
      this.scene.params.gameSettings.soundAudioVolume ?? (this.scene.params.gameSettings.isSoundAudio ? 1 : 0)
    );

    const hasBgm = this.scene.cache.audio.exists("bgm");
    const hasSfx = this.scene.cache.audio.exists("sfx");
    if (hasBgm) {
      this.music = this.scene.sound.add("bgm", { loop: true, volume: this.bgmVolume });
    }
    if (!hasSfx) {
      // Safari/WebKit does not decode OGG audio sprites. Keep the battle
      // playable instead of aborting the whole Game scene on missing cache.
      console.warn("[SoundManager] sfx audio sprite is unavailable; continuing without sound effects.");
    }

    if (hasSfx) {
      this.unlimitAudio = new ThrottledAudio(this.scene, 50, () => this.soundAudioVolume);
      this.plantAudio = new ThrottledAudio(this.scene, 200, () => this.soundAudioVolume);
      this.zombieSpawnAudio = new ThrottledAudio(this.scene, 1500, () => this.soundAudioVolume);
      this.generalHitAudio = new ThrottledAudio(this.scene, 200, () => this.soundAudioVolume);
      this.shieldHitAudio = new ThrottledAudio(this.scene, 200, () => this.soundAudioVolume);
      this.explodeAudio = new ThrottledAudio(this.scene, 500, () => this.soundAudioVolume);

      this.shootArrowPool = new AudioPool(this.scene, "sfx", "shootArrow", 4, () => this.soundAudioVolume, 50);
      this.shootFireworkPool = new AudioPool(this.scene, "sfx", "shootFirework", 4, () => this.soundAudioVolume, 50);
      this.shootLaserPool = new AudioPool(this.scene, "sfx", "shootLaser", 2, () => this.soundAudioVolume, 50);
      this.shootFireballPool = new AudioPool(this.scene, "sfx", "shootFireball", 3, () => this.soundAudioVolume, 50);
      this.zombieDeathPool = new AudioPool(this.scene, "sfx", "zombieDeath", 4, () => this.soundAudioVolume);
      this.skeletonDeathPool = new AudioPool(this.scene, "sfx", "skeletonDeath", 4, () => this.soundAudioVolume);
    }

    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    this.loaded = true;
  }

  private handleRoomGameStart() {
    this.playCurrent();
  }

  private normalizeVolume(volume: number) {
    if (!Number.isFinite(volume)) return 1;
    return Math.max(0, Math.min(1, volume));
  }

  private applyMusicVolume(sound: Phaser.Sound.BaseSound | null, volume = this.bgmVolume) {
    if (!sound) return;
    // 音频底层对象可能已被场景 shutdown 释放（setVolume 内部访问空节点），
    // 音量调整属于表现层，异常不能冒泡打断 RoomGameStart 等事件链。
    try {
      const mutableSound = sound as Phaser.Sound.BaseSound & { setVolume?: (value: number) => void; volume?: number };
      if (mutableSound.setVolume) {
        mutableSound.setVolume(volume);
        return;
      }
      mutableSound.volume = volume;
    } catch (error) {
      console.warn("[SoundManager] applyMusicVolume skipped because audio is no longer available.", error);
    }
  }

  public setBgmVolume(volume: number) {
    this.bgmVolume = this.normalizeVolume(volume);
    if (this.scene) {
      this.scene.params.gameSettings.bgmVolume = this.bgmVolume;
      this.scene.params.gameSettings.isBgm = this.bgmVolume > 0;
    }
    this.applyMusicVolume(this.music);
    this.applyMusicVolume(this.dumpMusic);
  }

  public setSoundAudioVolume(volume: number) {
    this.soundAudioVolume = this.normalizeVolume(volume);
    if (this.scene) {
      this.scene.params.gameSettings.soundAudioVolume = this.soundAudioVolume;
      this.scene.params.gameSettings.isSoundAudio = this.soundAudioVolume > 0;
    }
    this.shootArrowPool?.setVolume(this.soundAudioVolume);
    this.shootFireworkPool?.setVolume(this.soundAudioVolume);
    this.shootLaserPool?.setVolume(this.soundAudioVolume);
    this.shootFireballPool?.setVolume(this.soundAudioVolume);
    this.zombieDeathPool?.setVolume(this.soundAudioVolume);
    this.skeletonDeathPool?.setVolume(this.soundAudioVolume);
  }

  public getBgmVolume() {
    return this.bgmVolume;
  }

  public getSoundAudioVolume() {
    return this.soundAudioVolume;
  }

  public playCurrent() {
    this.applyMusicVolume(this.music);
    if (!this.music) return;
    try {
      this.music.play();
    } catch (error) {
      console.warn("[SoundManager] playCurrent skipped because audio is no longer available.", error);
    }
  }

  public coverCurrent(key: string) {
    if (!this.scene || !this.music) return;
    this.music.pause();
    this.dumpMusic = this.music;
    this.music = this.scene.sound.add(key, { loop: true, volume: this.bgmVolume });
    this.music.play();
  }

  public backToDump() {
    if (!this.music) return;
    this.music.stop();
    if (!this.dumpMusic) return;
    this.music = this.dumpMusic;
    this.dumpMusic = null;
    this.applyMusicVolume(this.music);
    this.music.resume();
  }

  public pause() {
    this.music?.pause();
  }

  public resume() {
    if (!this.music) return;
    try {
      this.applyMusicVolume(this.music);
      this.music.resume();
    } catch (error) {
      console.warn("[SoundManager] resume skipped because sound manager is no longer available.", error);
    }
  }

  public playUnlimit(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    this.unlimitAudio?.play(key, config);
  }

  public playPlant(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    this.plantAudio?.play(key, config);
  }

  public playZombieSpawn(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    this.zombieSpawnAudio?.play(key, config);
  }

  public playGeneralHit(config?: Phaser.Types.Sound.SoundConfig) {
    this.generalHitAudio?.play("generalHit", config);
  }

  public playShieldHit(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    this.shieldHitAudio?.play(key, config);
  }

  public playExplosion(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    this.explodeAudio?.play(key, config);
  }

  public playShootArrow(config?: Phaser.Types.Sound.SoundConfig) {
    this.shootArrowPool?.play(false, config);
  }

  public playShootFirework(config?: Phaser.Types.Sound.SoundConfig) {
    this.shootFireworkPool?.play(false, config);
  }

  public playShootLaser(config?: Phaser.Types.Sound.SoundConfig) {
    this.shootLaserPool?.play(false, config);
  }

  public playShootFireball(config?: Phaser.Types.Sound.SoundConfig) {
    this.shootFireballPool?.play(false, config);
  }

  public playZombieDeath(config?: Phaser.Types.Sound.SoundConfig) {
    this.zombieDeathPool?.play(false, config);
  }

  public playSkeletonDeath(config?: Phaser.Types.Sound.SoundConfig) {
    this.skeletonDeathPool?.play(false, config);
  }

  public Reset(): void {
    PhaserEventBus.off(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);

    this.music?.stop();
    this.dumpMusic?.stop();
    this.shootArrowPool?.stopAll();
    this.shootFireworkPool?.stopAll();
    this.shootLaserPool?.stopAll();
    this.shootFireballPool?.stopAll();
    this.zombieDeathPool?.stopAll();
    this.skeletonDeathPool?.stopAll();

    this.scene = null;
    this.loaded = false;
    this.bgmVolume = 1;
    this.soundAudioVolume = 1;
    this.music = null;
    this.dumpMusic = null;
    this.unlimitAudio = null;
    this.plantAudio = null;
    this.zombieSpawnAudio = null;
    this.generalHitAudio = null;
    this.shieldHitAudio = null;
    this.explodeAudio = null;
    this.shootArrowPool = null;
    this.shootFireworkPool = null;
    this.shootLaserPool = null;
    this.shootFireballPool = null;
    this.zombieDeathPool = null;
    this.skeletonDeathPool = null;
  }
}
