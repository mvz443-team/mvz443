import { CombatEntity } from "./combat-entity.mjs";

/** BulletEntity 替身：只用于 `instanceof` 与盾牌方向判定。 */
export class BulletEntity extends CombatEntity {
  constructor(options = {}) {
    super(options.scene ?? null, options.x ?? 0, options.y ?? 0, 1, options.faction ?? 1, null);
    this.rigidBody = {
      linvel: () => ({ x: options.vx ?? 0, y: options.vy ?? 0 }),
      setTranslation() {},
    };
    this.currentDamage = options.damage ?? 0;
    this.bounceable = options.bounceable ?? true;
    this.faction = options.faction ?? 1;
  }
  reverseVelocityX() {}
  catchEnhancement() {}
}
