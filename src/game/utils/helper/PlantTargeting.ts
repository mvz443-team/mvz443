/**
 * 植物格内定位规则（纯函数、零依赖）。
 *
 * 同一个格子里最多可以叠三种角色：
 * - **承载物**：睡莲 / 船，只是底座，永远不是第一目标；
 * - **内部植物**：真正干活的植物（发射器、南瓜头等）；
 * - **护盾植物**：包在内部植物外面的保护壳（南瓜护照），先替内部植物挨打。
 *
 * 这里集中定义"鼠标指向这一格时到底选中谁"的规则，
 * 由 `PlantHelper`、星之碎片预览与执行、护盾伤害路由共用，
 * 避免每个调用点各写一套顺序。
 */

export interface PlantTargetLike {
  pid: number;
  currentHealth: number;
}

/** 承载物：睡莲(6) / 船(100)。 */
export const CARRIER_PLANT_PIDS: readonly number[] = [6, 100];

/** 护盾植物：可以叠在其它植物外面、优先承受伤害的保护壳。 */
export const SHIELD_PLANT_PIDS: readonly number[] = [19];

/** 粉尘植物：可以随意叠种在任意格子上。 */
export const POWDER_PLANT_PIDS: readonly number[] = [10, 17];

export function isCarrierPlantPid(pid: number): boolean {
  return CARRIER_PLANT_PIDS.includes(pid);
}

export function isShieldPlantPid(pid: number): boolean {
  return SHIELD_PLANT_PIDS.includes(pid);
}

export function isPowderPlantPid(pid: number): boolean {
  return POWDER_PLANT_PIDS.includes(pid);
}

function isAlive(plant: PlantTargetLike): boolean {
  return (plant.currentHealth ?? 0) > 0;
}

/**
 * 找出同格仍然存活的护盾植物（可用于替其它植物吸收伤害）。
 *
 * @param exclude 自身；护盾植物不会替自己再转一次伤害。
 */
export function pickShieldPlant<T extends PlantTargetLike>(
  plants: readonly T[],
  exclude?: T | null,
): T | null {
  for (const plant of plants) {
    if (plant === exclude) continue;
    if (!isShieldPlantPid(plant.pid)) continue;
    if (!isAlive(plant)) continue;
    return plant;
  }
  return null;
}

/**
 * 星之碎片作用于同格哪个植物。
 *
 * 对齐《植物大战僵尸2》能量豆的交互：能量豆永远落在"看得见、能干活"的植物上，
 * 睡莲这类底座不会抢走目标；南瓜护照是包在外面的壳，点外壳（格子下半区）才给它。
 *
 * - 有护盾植物 + 内部植物：`down`(外壳) → 护盾植物，`up`(内部植物可见区) → 内部植物；
 * - 只有内部植物：内部植物；
 * - 只有护盾植物：护盾植物；
 * - 只剩承载物：承载物兜底（保留睡莲星碎等既有行为）。
 */
export function pickStarShardsTarget<T extends PlantTargetLike>(
  plants: readonly T[],
  aspect: 'up' | 'down',
): T | null {
  const alive = plants.filter(isAlive);
  if (alive.length === 0) return null;

  const inner = alive.filter((plant) => !isCarrierPlantPid(plant.pid) && !isShieldPlantPid(plant.pid));
  const shields = alive.filter((plant) => isShieldPlantPid(plant.pid));
  const carriers = alive.filter((plant) => isCarrierPlantPid(plant.pid));

  if (shields.length > 0) {
    const shell = shields[0];
    if (aspect === 'down') return shell;
    if (inner.length > 0) return inner[0];
    if (carriers.length > 0) return carriers[0];
    return shell;
  }

  if (inner.length > 0) return inner[0];
  return carriers[0] ?? null;
}
