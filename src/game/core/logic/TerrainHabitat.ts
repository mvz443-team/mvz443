/**
 * 地形通行域（决定"能刷在哪、能活在哪"）与体态层（决定"谁能打中谁"）是两个正交概念：
 *
 * - `BodyTraits` 的 tiny / flying / inVoid 描述命中层，投射物与普攻按它判定能否命中；
 * - 本文件的 TerrainHabitat 描述怪物自身的通行能力，只用于刷怪行过滤与落水兜底。
 *
 * 本文件零依赖、纯函数、所有判定都是显式集合判断，保证客户端/服务端/回放得到相同结果。
 */

export type TerrainHabitat = "ground" | "water" | "air";

/** 与 GridManager 的 GridType 对齐；void（虚空）归入空域通行域。 */
export type GridTerrain = "ground" | "water" | "void" | "sky";

export type RowTerrainRatio = {
  ground: number;
  water: number;
  void: number;
  sky: number;
};

export const DEFAULT_HABITATS: readonly TerrainHabitat[] = ["ground"] as const;
export const ALL_HABITATS: readonly TerrainHabitat[] = ["ground", "water", "air"] as const;

const HABITAT_GRID_TYPES: Record<TerrainHabitat, readonly GridTerrain[]> = {
  ground: ["ground"],
  water: ["water"],
  air: ["sky", "void"],
};

/** 缺省/非法配置一律回落到"仅地面"，避免配置错误让陆地怪刷进水里。 */
export function normalizeHabitats(habitats: readonly TerrainHabitat[] | undefined | null): readonly TerrainHabitat[] {
  if (!habitats || habitats.length === 0) return DEFAULT_HABITATS;
  const valid = habitats.filter(habitat => ALL_HABITATS.includes(habitat));
  return valid.length > 0 ? valid : DEFAULT_HABITATS;
}

/**
 * 行的主导地形：水面或空域占比超过 50% 时，该行只允许对应通行域的怪。
 * 阈值用严格大于，正好 50% 的混行按普通地面行处理。
 */
export function dominantHabitat(ratios: RowTerrainRatio): TerrainHabitat | null {
  if (ratios.water > 0.5) return "water";
  if (ratios.sky > 0.5) return "air";
  return null;
}

export function canSurviveOn(
  habitats: readonly TerrainHabitat[] | undefined | null,
  gridType: GridTerrain,
): boolean {
  return normalizeHabitats(habitats).some(habitat => HABITAT_GRID_TYPES[habitat].includes(gridType));
}

/**
 * 刷怪行过滤的核心判定，对应"行类型 × 怪物通行掩码"交叉过滤。
 * 飞行怪属于命中层的特殊单位，按经典塔防约定无视地面/水面限制，可刷任意行。
 */
export function canSpawnMonsterInRow(args: {
  habitats: readonly TerrainHabitat[] | undefined | null;
  isFlying: boolean;
  ratios: RowTerrainRatio;
}): boolean {
  if (args.isFlying) return true;
  const required = dominantHabitat(args.ratios);
  const normalized = normalizeHabitats(args.habitats);
  if (required) return normalized.includes(required);
  return normalized.includes("ground");
}
