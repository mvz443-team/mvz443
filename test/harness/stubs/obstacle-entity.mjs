import { CombatEntity } from "./combat-entity.mjs";

export class ObstacleEntity extends CombatEntity {
  constructor(scene, col, row, model, config = {}) {
    super(scene, 100 + col * 100, 100 + row * 100, config.hp ?? 1, config.faction ?? 2, model);
    this.col = col;
    this.row = row;
    this.model = model;
    this.health = config.hp ?? 1;
  }
  initializeEntity() { return this; }
  syncViewFromModel() {}
  destroy() { this.destroyed = true; }
}
