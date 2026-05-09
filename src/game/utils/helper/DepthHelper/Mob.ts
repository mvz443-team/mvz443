import { CoreDepth } from "./Core";

const MOB_DEPTH_OFFSET = 1000;

export type LegacyMobPart =
  | "backUpperArm"
  | "backLowerArm"
  | "rightLeg"
  | "leftLeg"
  | "rightArm"
  | "body"
  | "head"
  | "leftArm"
  | "hand"
  | "frontLowerArm";

const LEGACY_MOB_PART_OFFSET: Record<LegacyMobPart, number> = {
  backUpperArm: -1,
  backLowerArm: 0,
  rightLeg: 1,
  leftLeg: 2,
  rightArm: 6,
  body: 7,
  head: 8,
  leftArm: 9,
  hand: 10,
  frontLowerArm: 11,
};

export type MobAttachmentPart = "armor" | "shell" | "shield" | "golemEffect" | "handAttachment";

const MOB_ATTACHMENT_OFFSET: Record<MobAttachmentPart, number> = {
  armor: 13,
  shell: 13,
  shield: 14,
  golemEffect: 14,
  handAttachment: 13,
};

export type CentipedePart = "container" | "aura" | "body" | "character" | "orb";

const CENTIPEDE_PART_OFFSET: Record<CentipedePart, number> = {
  container: 0,
  aura: 1,
  body: 1,
  character: 2,
  orb: 2,
};

export const MobDepth = {
  base(row: number, offsetY = 0): number {
    return CoreDepth.lineBase(row) + CoreDepth.yOffsetAdjustment(offsetY) + MOB_DEPTH_OFFSET;
  },

  legacyPart(baseDepth: number, part: LegacyMobPart): number {
    return baseDepth + LEGACY_MOB_PART_OFFSET[part];
  },

  bodyText(bodyDepth: number): number {
    return bodyDepth + 1;
  },

  boatBack(baseDepth: number): number {
    return baseDepth - 2;
  },

  boatFront(baseDepth: number): number {
    return baseDepth + 10;
  },

  deathSmoke(baseDepth: number): number {
    return baseDepth + 15;
  },

  attachment(baseDepth: number, part: MobAttachmentPart): number {
    return baseDepth + MOB_ATTACHMENT_OFFSET[part];
  },

  customAttachment(baseDepth: number, localDepth: number): number {
    return baseDepth + localDepth;
  },

  starOrbitInitial(baseDepth: number): number {
    return baseDepth + 20;
  },

  starOrbitFrame(baseDepth: number, depthRatio: number): number {
    return baseDepth + 18 + Math.round(depthRatio * 4);
  },

  centipedePart(baseDepth: number, part: CentipedePart): number {
    return baseDepth + CENTIPEDE_PART_OFFSET[part];
  },

  deprecatedCentipedeJoint(localDepth: number): number {
    return localDepth + 0.1;
  },

  deprecatedCentipedeChild(baseDepth: number, localDepth: number): number {
    return baseDepth + localDepth;
  },

  sceneFlash(): number {
    return 900000;
  },
};
