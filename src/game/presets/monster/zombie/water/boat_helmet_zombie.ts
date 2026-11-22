import type { Game } from "../../../../scenes/Game";
import { STEEL_HELMET, HelmetZombieModel, HelmetZombieEntity } from "../helmet_zombie";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";

/** 木船钢盔僵尸：复用钢盔装备逻辑，仅改为水生 + 木船。 */
export const BoatHelmetZombieData = new HelmetZombieModel({
  mid: 24,
  nameKey: "BoatHelmetZombie",
  level: 4,
  weight: () => 900,
  leastWaveID: 8,
  habitats: ["water"],
  boatMounted: true,
  mountHealth: 400,
  mountDamagePriority: "rider",
  maxHealth: 300,
  baseSpeed: MonsterSpeed.HelmetZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.HelmetZombie,
  damageThresholds: [150],
  equipment: { head: STEEL_HELMET },
  createEntity: (scene: Game, col: number, row: number, model, waveID: number) =>
    new HelmetZombieEntity(scene, col, row, model as HelmetZombieModel, waveID),
});
