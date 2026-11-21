function controller() {
  return {
    isInAnim: false,
    updatePosition() {},
    setDepth() {},
    getHandAnchor() { return null; },
    highlight() {},
    twinkle() {},
    startLegSwing() {},
    stopLegSwing() {},
    startArmSwing() {},
    stopArmSwing() {},
    destroy() {},
    getTargets() { return []; },
    setAirborne(value) { this.airborne = value; },
    getHangPivot() { return null; },
    setRidingPose(value) { this.riding = value; },
    setDivingPose(value) { this.diving = value; },
    getHeadAnchor() { return this.headAnchor ?? { x: 0, y: 0 }; },
    setHeadAnchor(x, y) { this.headAnchor = { x, y }; },
    raw: {},
  };
}

export class LegacyMonsterAnimController {
  constructor(raw = {}) { this.raw = raw; }
  get isInAnim() { return false; }
  updatePosition() {}
  setDepth() {}
  getHandAnchor() { return null; }
  highlight() {}
  twinkle() {}
  startLegSwing() {}
  stopLegSwing() {}
  startArmSwing() {}
  stopArmSwing() {}
  destroy() {}
  getTargets() { return []; }
}

export function createZombieAnimController() { return controller(); }
export function createFlyingZombieAnimController() { return controller(); }
export function createBalloonTntAnimController() { return controller(); }
export function createGolemAnimController() { return controller(); }
export function createMutantAnimController() { return controller(); }
export function createSkeletonAnimController() { return controller(); }
export function createSkeletonBowAnimController() { return controller(); }
