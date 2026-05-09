import SoundManager from "../../managers/SoundManager";

export namespace SoundCmd {
  const plantMarkerAliases: Record<string, string> = {
    RemovePlant: 'plantRemove',
  };

  export function Play(marker: string, config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playUnlimit(marker, config);
  }

  export function PlayPlant(marker: string, config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playPlant(plantMarkerAliases[marker] ?? marker, config);
  }

  export function PlayZombieSpawn(index: number) {
    SoundManager.Instance.playZombieSpawn(`zombieSpawn${index}`);
  }

  export function PlayGeneralHit(config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playGeneralHit(config);
  }

  export function PlayShieldHit(marker: string, config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playShieldHit(marker, config);
  }

  export function PlayExplosion(marker: string, config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playExplosion(marker, config);
  }

  export function PlayShootArrow(config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playShootArrow(config);
  }

  export function PlayShootFirework(config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playShootFirework(config);
  }

  export function PlayShootLaser(config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playShootLaser(config);
  }

  export function PlayShootFireball(config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playShootFireball(config);
  }

  export function PlayZombieDeath(config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playZombieDeath(config);
  }

  export function PlaySkeletonDeath(config?: Phaser.Types.Sound.SoundConfig) {
    SoundManager.Instance.playSkeletonDeath(config);
  }

  export function CoverBgm(key: string) {
    SoundManager.Instance.coverCurrent(key);
  }

  export function BackToPreviousBgm() {
    SoundManager.Instance.backToDump();
  }
}

export default SoundCmd;
