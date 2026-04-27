import Phaser from "phaser";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import type { Game } from "../scenes/Game";
import { BaseManager } from "./BaseManager";

type PoolItem = {
  sound: Phaser.Sound.BaseSound;
  inUse: boolean;
};

export class ThrottledAudio {
  private lastPlayTime: Map<string, number> = new Map();

  constructor(
    private scene: Phaser.Scene,
    private throttleDelay: number = 200,
    private isMuted = false,
  ) { }

  play(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    const now = this.scene.time.now;
    const last = this.lastPlayTime.get(key) ?? 0;
    if (now - last < this.throttleDelay) return;

    this.lastPlayTime.set(key, now);
    this.scene.sound.playAudioSprite("sfx", key, {
      ...config,
      volume: this.isMuted ? 0 : (config?.volume ?? 1),
    });
  }
}

export class AudioPool {
  private pool: PoolItem[] = [];
  private lastPlayTime = 0;

  constructor(
    private scene: Phaser.Scene,
    private spriteKey: string,
    private markerName: string,
    poolSize: number = 4,
    private isMuted = false,
    private throttleDelay = 0,
  ) {
    for (let i = 0; i < poolSize; i++) {
      const snd = this.scene.sound.addAudioSprite(this.spriteKey);
      this.pool.push({ sound: snd, inUse: false });
    }
  }

  play(loop: boolean = false, config: Phaser.Types.Sound.SoundConfig = {}): Phaser.Sound.BaseSound | null {
    const now = this.scene.time.now;
    if (this.throttleDelay > 0 && now - this.lastPlayTime < this.throttleDelay) return null;

    const item = this.pool.find(i => !i.inUse);
    if (!item) return null;

    this.lastPlayTime = now;
    item.inUse = true;
    item.sound.once("complete", () => {
      item.inUse = false;
    });
    item.sound.play(this.markerName, {
      ...config,
      volume: this.isMuted ? 0 : (config.volume ?? 1),
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
}

export default class SoundManager extends BaseManager {
  private static _instance: SoundManager;
  protected scene: Game | null = null;

  private isBgm = false;
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

    this.isBgm = this.scene.params.gameSettings.isBgm;
    const isMuted = !this.scene.params.gameSettings.isSoundAudio;

    if (this.isBgm) {
      this.music = this.scene.sound.add("bgm", { loop: true });
    }

    this.unlimitAudio = new ThrottledAudio(this.scene, 50, isMuted);
    this.plantAudio = new ThrottledAudio(this.scene, 200, isMuted);
    this.zombieSpawnAudio = new ThrottledAudio(this.scene, 1500, isMuted);
    this.generalHitAudio = new ThrottledAudio(this.scene, 200, isMuted);
    this.shieldHitAudio = new ThrottledAudio(this.scene, 200, isMuted);
    this.explodeAudio = new ThrottledAudio(this.scene, 500, isMuted);

    this.shootArrowPool = new AudioPool(this.scene, "sfx", "shootArrow", 4, isMuted, 50);
    this.shootFireworkPool = new AudioPool(this.scene, "sfx", "shootFirework", 4, isMuted, 50);
    this.shootLaserPool = new AudioPool(this.scene, "sfx", "shootLaser", 2, isMuted, 50);
    this.shootFireballPool = new AudioPool(this.scene, "sfx", "shootFireball", 3, isMuted, 50);
    this.zombieDeathPool = new AudioPool(this.scene, "sfx", "zombieDeath", 4, isMuted);
    this.skeletonDeathPool = new AudioPool(this.scene, "sfx", "skeletonDeath", 4, isMuted);

    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
  }

  private handleRoomGameStart() {
    this.playCurrent();
  }

  public playCurrent() {
    if (!this.isBgm) return;
    this.music?.play();
  }

  public coverCurrent(key: string) {
    if (!this.isBgm || !this.scene || !this.music) return;
    this.music.pause();
    this.dumpMusic = this.music;
    this.music = this.scene.sound.add(key, { loop: true });
    this.music.play();
  }

  public backToDump() {
    if (!this.isBgm || !this.music) return;
    this.music.stop();
    if (!this.dumpMusic) return;
    this.music = this.dumpMusic;
    this.dumpMusic = null;
    this.music.resume();
  }

  public pause() {
    if (!this.isBgm) return;
    this.music?.pause();
  }

  public resume() {
    if (!this.isBgm || !this.music) return;
    try {
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
    this.isBgm = false;
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
