import { CoreDepth } from "./Core";

const PLANT_DEPTH_OFFSET = 500;

export type PlantPart =
  | "lilyBody"
  | "dispenserBase"
  | "shieldShellBack"
  | "body"
  | "badge"
  | "sfx"
  | "shootBurst"
  | "shieldShell";

const PLANT_PART_OFFSET: Record<PlantPart, number> = {
  lilyBody: -2,
  dispenserBase: -1,
  // 护盾外壳的后壁：必须画在同格内部植物的所有部件之后。
  shieldShellBack: -4,
  body: 0,
  badge: 1,
  sfx: 1,
  shootBurst: 2,
  shieldShell: 1,
};

export const PlantDepth = {
  base(row: number): number {
    return CoreDepth.lineBase(row) + PLANT_DEPTH_OFFSET;
  },

  part(baseDepth: number, part: PlantPart): number {
    return baseDepth + PLANT_PART_OFFSET[part];
  },

  body(baseDepth: number): number {
    return this.part(baseDepth, "body");
  },

  lilyBody(baseDepth: number): number {
    return this.part(baseDepth, "lilyBody");
  },

  dispenserBase(baseDepth: number): number {
    return this.part(baseDepth, "dispenserBase");
  },

  badge(baseDepth: number): number {
    return this.part(baseDepth, "badge");
  },

  sfx(baseDepth: number): number {
    return this.part(baseDepth, "sfx");
  },

  shootBurst(baseDepth: number): number {
    return this.part(baseDepth, "shootBurst");
  },

  /** 护盾植物外壳：同格叠加时画在内部植物之上。 */
  shieldShell(baseDepth: number): number {
    return this.part(baseDepth, "shieldShell");
  },

  /** 护盾植物外壳的后壁：画在内部植物之下，形成"植物装在壳里"的层次。 */
  shieldShellBack(baseDepth: number): number {
    return this.part(baseDepth, "shieldShellBack");
  },
};
