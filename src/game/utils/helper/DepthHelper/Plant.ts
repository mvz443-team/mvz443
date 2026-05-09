import { CoreDepth } from "./Core";

const PLANT_DEPTH_OFFSET = 500;

export type PlantPart =
  | "lilyBody"
  | "dispenserBase"
  | "body"
  | "badge"
  | "sfx"
  | "shootBurst";

const PLANT_PART_OFFSET: Record<PlantPart, number> = {
  lilyBody: -2,
  dispenserBase: -1,
  body: 0,
  badge: 1,
  sfx: 1,
  shootBurst: 2,
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
};
