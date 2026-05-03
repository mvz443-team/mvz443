import { legacyRapierVelocityToUnitsPerSecond } from "./physics";

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

export const MonsterSpeed = {
  VindicatorSolider: legacyRapierVelocityToUnitsPerSecond(25),
  Mutant: legacyRapierVelocityToUnitsPerSecond(30),
  TurtleZombie: legacyRapierVelocityToUnitsPerSecond(35),
  Zombie: legacyRapierVelocityToUnitsPerSecond(35),
  Skeleton: legacyRapierVelocityToUnitsPerSecond(35),
  SkeletonBow: legacyRapierVelocityToUnitsPerSecond(35),
  MinerZombie: legacyRapierVelocityToUnitsPerSecond(35),
  MinerHelmetZombie: legacyRapierVelocityToUnitsPerSecond(35),
  CapZombie: legacyRapierVelocityToUnitsPerSecond(35),
  HelmetZombie: legacyRapierVelocityToUnitsPerSecond(35),
  TurtleSkeletonBow: legacyRapierVelocityToUnitsPerSecond(35),
  Evoker: legacyRapierVelocityToUnitsPerSecond(40),
  ObsidianGolem: 0,
  Warden: 0,
  Vindicator: legacyRapierVelocityToUnitsPerSecond(55),
  StickZombie: legacyRapierVelocityToUnitsPerSecond(60),
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
