import type { BaseEntity } from "../core/BaseEntity";
import { StagedBodyMonsterEntity } from "./MonsterEntity";
import type { MediumMonsterModel, MediumSlot } from "../monster/MediumMonsterModel";
import {
  createEquipmentSprite,
  equipmentFrame,
  type EquipmentDef,
} from "../equipment/Equipment";

/**
 * 中型怪物 Entity 基类：身体动画由子类提供，装备槽只做视图同步。
 *
 * 伤害路由全部在 MediumMonsterModel；Entity 不重载每个怪物的 takeDamage。
 */
export abstract class MediumMonsterEntity extends StagedBodyMonsterEntity {
  declare public model: MediumMonsterModel;

  private readonly slotViewKeys = new Map<MediumSlot, string>();
  private mainHandTween: Phaser.Tweens.Tween | null = null;
  private slotsAttached = false;

  public override initializeEntity(): this {
    const result = super.initializeEntity();
    if (!this.slotsAttached) {
      this.slotsAttached = true;
      this.attachSlotViews();
    }
    this.syncViewFromModel();
    return result;
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    this.model.takeMediumDamage(this, amount, dealer, source);
    this.updateBodyDamageStage();
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    // 测试替身可能直接调用原型方法；没有真实 Entity 字段时跳过槽位同步。
    (this as unknown as { syncSlotViews?: () => void }).syncSlotViews?.();
  }

  private attachSlotViews(): void {
    for (const slot of ["head", "mainHand", "offHand"] as const) {
      const def = this.model.equipmentDefs[slot];
      const state = this.model.equipment[slot];
      if (!def || !state || def.viewless) continue;
      createEquipmentSprite(this, def.key, def.visual);
      this.slotViewKeys.set(slot, def.key);
    }
  }

  private syncSlotViews(): void {
    for (const slot of ["head", "mainHand", "offHand"] as const) {
      const def = this.model.equipmentDefs[slot];
      const state = this.model.equipment[slot];
      if (!def || !state || def.viewless) continue;

      const key = this.slotViewKeys.get(slot) ?? def.key;
      const sprite = this.attachSprites.get(key);
      if (!sprite) continue;

      sprite.setVisible(state.visible && !state.broken && state.health > 0);
      sprite.setFrame(equipmentFrame(state.health, def.thresholds));
      if (slot === "mainHand") this.syncMainHandSwing(sprite, def, state.swinging);
    }
  }

  private syncMainHandSwing(
    sprite: Phaser.GameObjects.Sprite,
    def: EquipmentDef,
    swinging: boolean,
  ): void {
    const visual = def.visual;
    const angle = visual?.swingAngle ?? 0;
    const duration = visual?.swingDuration ?? 0;
    const shouldSwing = Boolean(angle && duration && swinging && sprite.visible);

    if (shouldSwing && !this.mainHandTween) {
      this.mainHandTween = this.scene.tweens.add({
        targets: sprite,
        angle: -Math.abs(angle),
        duration,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else if (!shouldSwing && this.mainHandTween) {
      this.mainHandTween.stop();
      this.mainHandTween = null;
      sprite.setAngle(0);
    }
  }
}
