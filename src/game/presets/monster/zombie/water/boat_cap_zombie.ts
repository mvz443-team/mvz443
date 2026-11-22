import type { Game } from "../../../../scenes/Game";
import { CAP_HELMET, CapZombieModel, CapZombieEntity } from "../cap_zombie";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";

/** 木船帽僵尸：复用帽子装备逻辑，仅改为水生 + 木船。 */
export const BoatCapZombieData = new CapZombieModel({
  mid: 23,
  nameKey: "BoatCapZombie",
  level: 2,
  weight: (waveID) => Math.max(400, 2200 - (waveID - 7) * 120),
  leastWaveID: 5,
  habitats: ["water"],
  boatMounted: true,
  mountHealth: 400,
  mountDamagePriority: "rider",
  maxHealth: 300,
  baseSpeed: MonsterSpeed.CapZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.CapZombie,
  damageThresholds: [150],
  equipment: { head: CAP_HELMET },
  createEntity: (scene: Game, col: number, row: number, model, waveID: number) =>
    new CapZombieEntity(scene, col, row, model as CapZombieModel, waveID),
});
