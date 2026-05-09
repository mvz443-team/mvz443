import { PlantDepth } from "./Plant";
import { UIDepth } from "./UI";

export const SfxDepth = {
  passthrough(depth: number): number {
    return depth;
  },

  explosion(): number {
    return UIDepth.inGame(-100);
  },

  dirtOut(row: number): number {
    return PlantDepth.base(row);
  },

  starBurstParticle(baseDepth: number): number {
    return baseDepth + 40;
  },

  starBurstGlow(baseDepth: number): number {
    return baseDepth + 39;
  },
};
