import type { Game } from "../../../../scenes/Game";
import { TURTLE_SHELL, TurtleZombieModel, TurtleZombieEntity } from "../turtle_zombie";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";

/** 木船龟壳僵尸：复用龟甲破碎加速逻辑，仅改为水生 + 木船。 */
export const BoatTurtleZombieData = new TurtleZombieModel({
  mid: 25,
  nameKey: "BoatTurtleZombie",
  level: 2,
  // 不进普通出怪池（保留 preset 供特殊召唤使用）。
  weight: () => 0,
  leastWaveID: 9,
  habitats: ["water"],
  boatMounted: true,
  mountHealth: 400,
  mountDamagePriority: "rider",
  maxHealth: 300,
  baseSpeed: MonsterSpeed.TurtleZombie,
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.TurtleZombie,
  damageThresholds: [150],
  equipment: { head: TURTLE_SHELL },
  createEntity: (scene: Game, col: number, row: number, model, waveID: number) =>
    new TurtleZombieEntity(scene, col, row, model as TurtleZombieModel, waveID),
});
