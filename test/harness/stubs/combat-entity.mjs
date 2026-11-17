import { PositionManager } from "../../../src/game/managers/view/PositionManager.ts";

/**
 * CombatEntity 替身：保留 Model 逻辑需要的血量/阵营/目标集合语义。
 * 真实游戏里血量存储在 Model，这里保持一致。
 */
export class CombatEntity {
  constructor(scene, x, y, maxHealth, faction, model = null) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.model = model;
    this.faction = faction;
    this.ExtraData = {};
    this.underAttackBy = new Set();
    this.isTiny = false;
    this.SnapshotId = `test:${Math.random().toString(36).slice(2)}`;
    this.maxHealth = maxHealth;
    this.currentHealth = maxHealth;
  }

  get currentHealth() {
    return this.model?.health ?? this._health ?? 0;
  }

  set currentHealth(value) {
    if (this.model) this.model.health = value;
    this._health = value;
  }

  get maxHealth() {
    return this.model?.healthMax ?? this._healthMax ?? 0;
  }

  set maxHealth(value) {
    if (this.model) this.model.healthMax = value;
    this._healthMax = value;
  }

  GetRow() {
    return PositionManager.Instance.getRowByY(this.y);
  }

  takeDamage(amount, dealer, source) {
    if (this.currentHealth <= 0) return;
    const realDamage = Math.min(amount, this.currentHealth);
    this.currentHealth -= amount;
    this.onHurt?.(amount, realDamage, dealer, source);
    if (this.currentHealth <= 0) {
      this.currentHealth = 0;
      this.onDeath?.();
      this.destroy?.();
    }
  }

  addDebuff() {}
  hasDebuff() { return 0; }
  destroy() { this.destroyed = true; }
  syncViewFromModel() {}
}
