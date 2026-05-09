import { CoreDepth, ProjectileDepthType } from "./Core";

export const ProjectileDepth = {
  base(type: ProjectileDepthType, line: number, offsetY = 0, componentOffset = 0): number {
    return CoreDepth.lineBase(line)
      + CoreDepth.projectileTypeOffset(type)
      + CoreDepth.yOffsetAdjustment(offsetY)
      + componentOffset;
  },

  bullet(line: number, offsetY = 0): number {
    return this.base("bullet", line, offsetY);
  },

  bulletColumn(col: number): number {
    return this.bullet(col);
  },

  projectile(line: number, offsetY = 0): number {
    return this.base("projectile", line, offsetY);
  },

  laser(line: number, offsetY = 0): number {
    return this.base("laser", line, offsetY);
  },

  sprite(baseDepth: number): number {
    return baseDepth;
  },

  trail(baseDepth: number): number {
    return baseDepth + 1;
  },

  arc(): number {
    return this.projectile(0);
  },

  centipedeSkill(): number {
    return this.projectile(0) + 30;
  },
};
