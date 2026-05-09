export type ProjectileDepthType = "bullet" | "projectile" | "laser";

const LINE_DEPTH_INCREMENT = 10000;
const PROJECTILE_TYPE_OFFSET: Record<ProjectileDepthType, number> = {
  bullet: 100000,
  projectile: 300000,
  laser: 500000,
};

export const CoreDepth = {
  lineBase(line: number): number {
    return (line + 1) * LINE_DEPTH_INCREMENT;
  },

  projectileTypeOffset(type: ProjectileDepthType): number {
    return PROJECTILE_TYPE_OFFSET[type] ?? 0;
  },

  yOffsetAdjustment(offsetY: number): number {
    return Math.floor(offsetY * 15);
  },

  component(base: number, componentOffset = 0, offsetY = 0): number {
    return base + this.yOffsetAdjustment(offsetY) + componentOffset;
  },

  sprite(line: number, componentOffset = 0, offsetY = 0): number {
    return this.component(this.lineBase(line), componentOffset, offsetY);
  },
};
