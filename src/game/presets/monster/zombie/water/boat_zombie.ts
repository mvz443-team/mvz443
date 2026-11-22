import { ZombieEntity, ZombieModel } from "../zombie";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";

/** 木船普通僵尸：普通僵尸的水生版本，唯一差别是始终挂载木船表现。 */
export const BoatZombieData = new ZombieModel({
  mid: 22,
  nameKey: "BoatZombie",
  level: 1,
  weight: (waveID) => Math.max(300, 3000 - (waveID - 6) * 160),
  leastWaveID: 4,
  habitats: ["water"],
  boatMounted: true,
  mountHealth: 400,
  mountDamagePriority: "rider",
  maxHealth: 300,
  baseSpeed: MonsterSpeed.Zombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Zombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) => new ZombieEntity(scene, col, row, model as ZombieModel, waveID),
});
