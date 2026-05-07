import { getOneGridVelocityForSeconds, legacyRapierVelocityToUnitsPerSecond } from "./physics";

export type _Typedebuffs = 'slow' | 'frozen' | null;

export type _TypeArrowEnhancement = 'none' | 'fire' | 'ice' | 'lightning';
export const DEBUG_TOGGLE_KEY = 'D';

export function EnhancementPriority(new_en: _TypeArrowEnhancement, old_en: _TypeArrowEnhancement): boolean {
  const priority = {
    'none': 0,
    'ice': 1,
    'fire': 2,
    'lightning': 3
  };
  return priority[new_en] > priority[old_en];
}

export const DamageConstants = {
  SECKILL: 99889988,
}

const NormalZombieSpeed = getOneGridVelocityForSeconds(5.0);

export const MonsterSpeed = {
  VindicatorSolider: getOneGridVelocityForSeconds(4.7),
  Mutant: NormalZombieSpeed,
  TurtleZombie: NormalZombieSpeed,
  Zombie: NormalZombieSpeed,
  Skeleton: NormalZombieSpeed,
  SkeletonBow: NormalZombieSpeed,
  MinerZombie: NormalZombieSpeed,
  MinerHelmetZombie: NormalZombieSpeed,
  CapZombie: NormalZombieSpeed,
  HelmetZombie: NormalZombieSpeed,
  TurtleSkeletonBow: NormalZombieSpeed,
  Evoker: NormalZombieSpeed,
  ObsidianGolem: 0,
  Warden: 0,
  Vindicator: getOneGridVelocityForSeconds(4.0),
  StickZombie: getOneGridVelocityForSeconds(2.5),
} as const;

export const ZombieAttackInterval = {
  Zombie: 200,
  CapZombie: 200,
  HelmetZombie: 200,
  MinerZombie: 200,
  MinerHelmetZombie: 200,
  Skeleton: 200,
  SkeletonBow: 200,
  StickZombie: 200,
  Evoker: 200,
  Vindicator: 200,
  VindicatorSolider: 200,
  TurtleZombie: 200,
  TurtleSkeletonBow: 200,
} as const;
