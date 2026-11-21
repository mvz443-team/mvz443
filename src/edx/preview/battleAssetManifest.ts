import type Phaser from "phaser";
import { PlantLibrary } from "../../game/managers/library/PlantLibrary";
import {
  getLevelBadgeAssetPath,
  getLevelBadgeTextureKey,
  LEVEL_BADGE_TEXTURE_LEVELS,
} from "../../game/ui/levelBadgeSvg";

/**
 * 战斗素材清单。
 *
 * 战斗场景（Preloader）和图鉴预览场景（EdxPreview）共用同一份清单，
 * 避免两处各维护一套 key：预览里跑的是真实 Model/Entity，
 * 少加载一张贴图就会在某个 preset 上静默变成空白或抛错。
 *
 * 调用方负责先 `loader.setPath('assets')`。
 */

export function queueAllPlantAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const record of PlantLibrary.GetAllModels()) {
    loader.spritesheet(record.texturePath, record.texturePath + '.png', {
      frameWidth: 64, frameHeight: 64,
    });
    loader.image(`card/${record.texturePath}`, `card/${record.texturePath}.png`);
  }
}

export function queueAllMonsterAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.image('zombie/zombie', 'zombie/zombie.png');
  loader.spritesheet('attach/cap', 'attach/cap.png', { frameWidth: 33, frameHeight: 14 });
  loader.spritesheet('attach/helmet', 'attach/helmet.png', { frameWidth: 33, frameHeight: 14 });
  loader.spritesheet('attach/turtle', 'attach/turtle.png', { frameWidth: 33, frameHeight: 14 });
  loader.image('attach/hd_pickaxe', 'attach/hd_pickaxe.png');
  loader.image('attach/hd_bow', 'attach/hd_bow.png');
  loader.image('attach/hd_stick', 'attach/hd_stick.png');
  loader.image('attach/hd_axe', 'attach/hd_axe.png');
  loader.spritesheet('attach/hd_shield', 'attach/hd_shield.png', { frameWidth: 32, frameHeight: 32 });
  loader.image('attach/sign', 'attach/sign.png');
  loader.image('attach/balloon', 'attach/balloon.png');
  loader.image('attach/boat1', 'attach/sprBoat/sprBoat_0.png');
  loader.image('attach/boat2', 'attach/sprBoat/sprBoat_1.png');
  // 潜水僵尸的多图层部件：镜框与呼吸管分层绘制，按 Model 状态同步。
  loader.image('attach/diving_goggles', 'attach/diving_goggles.svg');
  loader.image('attach/diving_snorkel', 'attach/diving_snorkel.svg');
  // 海豚坐骑：身体/尾鳍/背鳍三个独立图层。
  loader.image('attach/dolphin_body', 'attach/dolphin_body.svg');
  loader.image('attach/dolphin_tail', 'attach/dolphin_tail.svg');
  loader.image('attach/dolphin_fin', 'attach/dolphin_fin.svg');
}

export function queueAllProjectileAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.image('bullet/snowball', 'bullet/snowball.png');
  loader.image('bullet/arrow', 'bullet/arrow.png');
  loader.image('bullet/minecart', 'bullet/minecart.png');
  loader.image('bullet/firework', 'bullet/firework.png');
  loader.image('bullet/Hfirework', 'bullet/Hfirework.png');
}

export function queueAllSpriteAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.image('pickaxe', 'sprite/pickaxe.png');
  loader.image('starshards', 'sprite/star.png');
  loader.image('redstone', 'sprite/redstone.png');
  loader.spritesheet('anime/death_smoke', 'anime/death_smoke.png', { frameWidth: 16, frameHeight: 16 });
  loader.spritesheet('anime/explosion', 'anime/explosion.png', { frameWidth: 32, frameHeight: 32 });
  loader.spritesheet('anime/fire', 'anime/fire.png', { frameWidth: 16, frameHeight: 16 });
  loader.spritesheet('anime/ice_trail', 'anime/ice_trail.png', { frameWidth: 16, frameHeight: 16 });
  loader.spritesheet('anime/lightning_trail', 'anime/lightning_trail.png', { frameWidth: 16, frameHeight: 16 });
  loader.image('shoot_bomb', 'anime/shoot_bomb.png');
  loader.spritesheet('anime/dirt_out', 'anime/dirt_out.png', { frameWidth: 64, frameHeight: 64 });
  loader.image('anime/dirt', 'anime/dirt.png');

  loader.spritesheet('sprZombieBody', 'sprite/zombie/sprZombieBody.png', { frameWidth: 19, frameHeight: 35 });
  loader.image('sprZombieHead', 'sprite/zombie/sprZombieHead.png');
  loader.image('sprZombieArm', 'sprite/zombie/sprZombieArm.png');
  loader.image('sprZombieLeg', 'sprite/zombie/sprZombieLeg.png');

  loader.spritesheet('sprSkeletonBody', 'sprite/skeleton/sprSkeletonBody.png', { frameWidth: 19, frameHeight: 35 });
  loader.image('sprSkeletonHead', 'sprite/skeleton/sprSkeletonHead.png');
  loader.image('sprSkeletonArm', 'sprite/skeleton/sprSkeletonArm.png');
  loader.image('sprSkeletonLeg', 'sprite/skeleton/sprSkeletonLeg.png');

  loader.spritesheet('sprEvokerBody', 'sprite/evoker/sprEvokerBody.png', { frameWidth: 19, frameHeight: 35 });
  loader.image('sprEvokerHead', 'sprite/evoker/sprEvokerHead.png');
  loader.image('sprEvokerArm', 'sprite/evoker/sprEvokerArm.png');
  loader.image('sprEvokerLeg', 'sprite/evoker/sprEvokerLeg.png');

  loader.spritesheet('sprVindicatorBody', 'sprite/vindicator/sprVindicatorBody.png', { frameWidth: 19, frameHeight: 35 });
  loader.image('sprVindicatorHead', 'sprite/evoker/sprEvokerHead.png');
  loader.image('sprVindicatorArm', 'sprite/vindicator/sprVindicatorArm.png');
  loader.image('sprVindicatorLeg', 'sprite/vindicator/sprVindicatorLeg.png');

  loader.spritesheet('obsidianBody', 'sprite/obsidian_golem/obsidianBody.png', { frameWidth: 19, frameHeight: 35 });
  loader.image('obsidianHead', 'sprite/obsidian_golem/obsidianHead.png');
  loader.image('obsidianArm', 'sprite/obsidian_golem/obsidianArm.png');
  loader.image('obsidianLeg', 'sprite/obsidian_golem/obsidianLeg.png');
  loader.image('zombie/mob_obsidian', 'zombie/mob_obsidian.png');

  loader.spritesheet('sprWardenBody', 'sprite/warden_golem/sprWardenBody.png', { frameWidth: 19, frameHeight: 35 });
  loader.image('sprWardenHead', 'sprite/warden_golem/sprWardenHead.png');
  loader.image('sprWardenArm', 'sprite/warden_golem/sprWardenArm.png');
  loader.image('sprWardenLeg', 'sprite/warden_golem/sprWardenLeg.png');

  loader.spritesheet('sprMutantBody', 'sprite/mutant/body.png', { frameWidth: 52, frameHeight: 89 });
  loader.image('sprMutantHead', 'sprite/mutant/head.png');
  loader.image('sprMutantUpperArm', 'sprite/mutant/upperArm.png');
  loader.image('sprMutantLowerArm', 'sprite/mutant/lowerArm.png');
  loader.image('sprMutantUpperLeg', 'sprite/mutant/upperLeg.png');
  loader.image('sprMutantLowerLeg', 'sprite/mutant/lowerLeg.png');
  loader.image('sprMutantCover', 'sprite/mutant/cover.png');

  loader.spritesheet('sprCentipedeCharacter', 'sprite/centipede/sprCentipedeCharacter.png', { frameWidth: 128, frameHeight: 160 });
  loader.image('sfxCentipedeOrb', 'sprite/centipede/sfxCentipedeOrb.png');
  loader.image('sfxCentipedeSlash', 'sprite/centipede/sfxCentipedeSlash.png');
  loader.image('sfxCentipedeSummonRing', 'sprite/centipede/sfxCentipedeSummonRing.png');
  loader.spritesheet('sfxCentipedeChargeDust', 'sprite/centipede/sfxCentipedeChargeDust.png', { frameWidth: 32, frameHeight: 32 });
  loader.image('sfxCentipedeMinionOrb', 'sprite/centipede/sfxCentipedeMinionOrb.png');

  loader.spritesheet('sprCentipedeDeprecatedBody', 'sprite/centipede_deprecated/sprCentipedeBody.png', { frameWidth: 60, frameHeight: 48 });
  loader.image('sprCentipedeDeprecatedHead', 'sprite/centipede_deprecated/sprCentipedeHead.png');
  loader.image('sprCentipedeDeprecatedSegment', 'sprite/centipede_deprecated/sprCentipedeSegment.png');
  loader.image('sprCentipedeDeprecatedJoint', 'sprite/centipede_deprecated/sprCentipedeJoint.png');
  loader.image('sprCentipedeDeprecatedArm', 'sprite/centipede_deprecated/sprCentipedeArm.png');
  loader.image('sprCentipedeDeprecatedLeg', 'sprite/centipede_deprecated/sprCentipedeLeg.png');
  loader.image('sprCentipedeDeprecatedSickle', 'sprite/centipede_deprecated/sprCentipedeSickle.png');

  for (const level of LEVEL_BADGE_TEXTURE_LEVELS) {
    loader.svg(getLevelBadgeTextureKey(level), getLevelBadgeAssetPath(level), { width: 48, height: 48 });
  }
}
