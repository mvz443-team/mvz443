import type { Game } from "../../../../scenes/Game";
import { CAP_HELMET, CapZombieModel, CapZombieEntity } from "../cap_zombie";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";

/** 木船帽僵尸：复用帽子装备逻辑，仅改为水生 + 木船。 */
export const BoatCapZombieData = new CapZombieModel({
  mid: 23,
  nameKey: "BoatCapZombie",
  level: 2,
  // 作为皮革帽僵尸的 water 变种生成，不进普通出怪池。
  weight: () => 0,
  leastWaveID: 5,
  habitats: ["water"],
  boatMounted: true,
  mountHealth: 400,
  mountDamagePriority: "rider",
  maxHealth: 300,
  baseSpeed: MonsterSpeed.CapZombie,
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.CapZombie,
  damageThresholds: [150],
  equipment: { head: CAP_HELMET },
  createEntity: (scene: Game, col: number, row: number, model, waveID: number) =>
    new CapZombieEntity(scene, col, row, model as CapZombieModel, waveID),
});
