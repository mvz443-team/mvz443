let targetProvider = () => false;

/** 测试通过这里控制“当前是否有目标”。 */
export function setSightTargetProvider(provider) {
  targetProvider = provider;
}

export function resetSightTarget() {
  targetProvider = () => false;
}

export class SightLineEntity {
  constructor(scene, options) {
    this.scene = scene;
    this.options = options;
  }
  hasTarget() { return Boolean(targetProvider(this.options)); }
  getTargets() { return this.hasTarget() ? [{ fake: true }] : []; }
  destroy() {}
}

export class SightLineGroup {
  constructor(scene, options) {
    this.scene = scene;
    this.options = options;
    this.lines = [];
  }
  hasTarget() { return Boolean(targetProvider(this.options)); }
  getTargets() { return this.hasTarget() ? [{ fake: true }] : []; }
  destroy() {}
}
