/**
 * 装备能力：helmet / shield / weapon。
 *
 * 约定：
 * - Model 侧接口实现装备数值、减伤、破碎、挥动状态；所有字段都是 JSON 安全数据。
 * - Entity 侧接口实现 sprite/Tween，只根据 Model 状态渲染，不保存业务数值。
 * - 通过 mixin 组合：miner_helmet = helmet + weapon，vindicator_soldier = shield + weapon。
 */

import DepthHelper from "../../utils/helper/DepthHelper";
import { PositionManager } from "../../managers/view/PositionManager";
import type { BaseEntity } from "../core/BaseEntity";
import type { BaseMonsterEntity } from "../entities/MonsterEntity";
import { StagedBodyMonsterEntity } from "../entities/MonsterEntity";
import type { MonsterModel } from "../MonsterModel";
import SoundCmd from "../../utils/cmd/SoundCmd";

export type EquipmentVisualDef = {
  /** 固定件的相对坐标；手持件忽略此值。 */
  x?: number;
  y?: number;
  scale?: number;
  originX?: number;
  originY?: number;
  depth?: number;
  attachment?: "fixed" | "hand";
  /** weapon：挥动角度与时长。 */
  swingAngle?: number;
  swingDuration?: number;
  /** weapon：动画控制器的 handObject（无 sprite）。 */
  handObject?: boolean;
};

export type EquipmentDef = {
  key: string;
  maxHealth: number;
  thresholds: number[];
  damageScale?: number;
  hitSound?: "ironHit" | "leatherHit";
  visual?: EquipmentVisualDef;
};

type ModelCtor = abstract new (...args: any[]) => MonsterModel;
type EntityCtor = abstract new (...args: any[]) => BaseMonsterEntity;
type DamageDealer = BaseEntity | undefined;
type DamageSource = BaseEntity | undefined;

/** 装备定义是静态配置；冻结阈值/视觉对象，避免运行时被意外改写。 */
function freezeEquipmentDef(def: EquipmentDef): EquipmentDef {
  Object.freeze(def.thresholds);
  if (def.visual) Object.freeze(def.visual);
  return Object.freeze(def);
}

function equipmentFrame(health: number, thresholds: number[]): number {
  for (let i = 0; i < thresholds.length; i++) {
    if (health > thresholds[i]) return i;
  }
  return thresholds.length;
}

function createEquipmentSprite(
  entity: BaseMonsterEntity,
  key: string,
  visual: EquipmentVisualDef = {},
): Phaser.GameObjects.Sprite | null {
  if (visual.handObject) {
    const raw = (entity as any).getLegacyController?.()?.raw;
    raw?.setHandObject?.(key);
    return null;
  }

  const hand = visual.attachment === "hand";
  const px = hand
    ? entity.x + entity.offsetX - PositionManager.Instance.GRID_SIZEX * 0.42
    : entity.x + entity.offsetX + (visual.x ?? 0);
  const py = hand
    ? entity.y + entity.offsetY - PositionManager.Instance.GRID_SIZEY * 0.7
    : entity.y + entity.offsetY + (visual.y ?? -PositionManager.Instance.GRID_SIZEY * 1.15);

  const sprite = entity.scene.add.sprite(px, py, key);
  sprite
    .setScale((visual.scale ?? (hand ? 1.4 : 1.4)) * PositionManager.Instance.scaleFactor)
    .setOrigin(visual.originX ?? 0.5, visual.originY ?? (hand ? 1 : 0.5))
    .setFrame(0)
    .setDepth(DepthHelper.Mob.customAttachment(entity.baseDepth, visual.depth ?? 13));

  entity.attachSprites.set(key, sprite);
  if (hand) entity.registerHandAttachment(key);
  else entity.registerEquipmentAttachment(key);
  return sprite;
}

// --- Helmet -----------------------------------------------------------------

export interface IHelmetModel {
  helmetDef: EquipmentDef | null;
  helmetHealth: number;
  helmetBroken: boolean;
  helmetKey: string;
  equipHelmet(entity: BaseEntity | null, def: EquipmentDef): void;
  absorbHelmetDamage(
    entity: BaseMonsterEntity,
    amount: number,
    dealer?: DamageDealer,
    source?: DamageSource,
  ): boolean;
  onHelmetBroken?(entity: BaseMonsterEntity, overflow: number): void;
}

export interface IHelmetEntity {
  attachHelmetView(def: EquipmentDef): void;
  syncHelmetView(): void;
}

export function withHelmetModel<TBase extends ModelCtor>(Base: TBase) {
  abstract class HelmetModelMixin extends Base implements IHelmetModel {
    public get helmetDef(): EquipmentDef | null {
      return this.getConfigValue<EquipmentDef>("helmetDef") ?? null;
    }
    public helmetHealth = 0;
    public helmetBroken = false;
    public get helmetKey(): string {
      return this.getConfigValue<string>("helmetKey") ?? "";
    }

    public equipHelmet(entity: BaseEntity | null, def: EquipmentDef): void {
      this.setConfigValue("helmetDef", freezeEquipmentDef(def));
      this.setConfigValue("helmetKey", def.key);
      this.helmetHealth = def.maxHealth;
      this.helmetBroken = false;
      if (entity) (entity as unknown as IHelmetEntity).attachHelmetView(def);
      entity?.syncViewFromModel();
    }

    public absorbHelmetDamage(
      entity: BaseMonsterEntity,
      amount: number,
      dealer?: DamageDealer,
      source?: DamageSource,
    ): boolean {
      const def = this.helmetDef;
      if (!def || this.helmetBroken || this.helmetHealth <= 0) return false;

      const scaled = amount * (def.damageScale ?? 1);
      if (this.helmetHealth > scaled) {
        this.helmetHealth -= scaled;
        if (def.hitSound) SoundCmd.PlayShieldHit(def.hitSound);
        entity.animController.highlight();
        entity.syncViewFromModel();
        return true;
      }

      const overflow = Math.max(0, scaled - this.helmetHealth);
      this.helmetHealth = 0;
      this.helmetBroken = true;
      this.onHelmetBroken(entity, overflow);
      entity.syncViewFromModel();
      if (overflow > 0) this.takeDamage(entity, overflow, dealer, source);
      return true;
    }

    public onHelmetBroken(_entity: BaseMonsterEntity, _overflow: number): void { }
  }
  return HelmetModelMixin;
}

export function withHelmetEntity<TBase extends EntityCtor>(Base: TBase) {
  abstract class HelmetEntityMixin extends Base implements IHelmetEntity {
    private helmetViewKey: string | null = null;

    public attachHelmetView(def: EquipmentDef): void {
      createEquipmentSprite(this, def.key, def.visual);
      this.helmetViewKey = def.key;
    }

    public syncHelmetView(): void {
      const model = this.model as unknown as IHelmetModel;
      const key = this.helmetViewKey ?? model.helmetKey;
      if (!key) return;
      const sprite = this.attachSprites.get(key);
      if (!sprite) return;
      sprite.setVisible(!model.helmetBroken && model.helmetHealth > 0);
      const thresholds = model.helmetDef?.thresholds ?? [];
      sprite.setFrame(equipmentFrame(model.helmetHealth, thresholds));
    }

    public override syncViewFromModel(): void {
      super.syncViewFromModel();
      this.syncHelmetView();
    }
  }
  return HelmetEntityMixin;
}

// --- Shield -----------------------------------------------------------------

export interface IShieldModel {
  shieldDef: EquipmentDef | null;
  shieldHealth: number;
  shieldBroken: boolean;
  shieldKey: string;
  equipShield(entity: BaseEntity | null, def: EquipmentDef): void;
  absorbShieldDamage(
    entity: BaseMonsterEntity,
    amount: number,
    dealer?: DamageDealer,
    source?: DamageSource,
  ): boolean;
  canShieldBlock?(entity: BaseMonsterEntity, source?: DamageSource): boolean;
  /** 破碎时溢出到血量的伤害；默认按减伤后的溢出计算。 */
  shieldBreakOverflow?(entity: BaseMonsterEntity, amount: number, scaled: number): number;
  onShieldBroken?(entity: BaseMonsterEntity, overflow: number): void;
}

export interface IShieldEntity {
  attachShieldView(def: EquipmentDef): void;
  syncShieldView(): void;
}

export function withShieldModel<TBase extends ModelCtor>(Base: TBase) {
  abstract class ShieldModelMixin extends Base implements IShieldModel {
    public get shieldDef(): EquipmentDef | null {
      return this.getConfigValue<EquipmentDef>("shieldDef") ?? null;
    }
    public shieldHealth = 0;
    public shieldBroken = false;
    public get shieldKey(): string {
      return this.getConfigValue<string>("shieldKey") ?? "";
    }

    public equipShield(entity: BaseEntity | null, def: EquipmentDef): void {
      this.setConfigValue("shieldDef", freezeEquipmentDef(def));
      this.setConfigValue("shieldKey", def.key);
      this.shieldHealth = def.maxHealth;
      this.shieldBroken = false;
      if (entity) (entity as unknown as IShieldEntity).attachShieldView(def);
      entity?.syncViewFromModel();
    }

    public absorbShieldDamage(
      entity: BaseMonsterEntity,
      amount: number,
      dealer?: DamageDealer,
      source?: DamageSource,
    ): boolean {
      const def = this.shieldDef;
      if (!def || this.shieldBroken || this.shieldHealth <= 0) return false;
      if (!this.canShieldBlock(entity, source)) return false;

      const scaled = amount * (def.damageScale ?? 1);
      if (this.shieldHealth > scaled) {
        this.shieldHealth -= scaled;
        if (def.hitSound) SoundCmd.PlayShieldHit(def.hitSound);
        entity.animController.highlight();
        entity.syncViewFromModel();
        return true;
      }

      const overflow = this.shieldBreakOverflow(entity, amount, scaled);
      this.shieldHealth = 0;
      this.shieldBroken = true;
      this.onShieldBroken(entity, overflow);
      entity.syncViewFromModel();
      if (overflow > 0) this.takeDamage(entity, overflow, dealer, source);
      return true;
    }

    public canShieldBlock(_entity: BaseMonsterEntity, _source?: DamageSource): boolean { return true; }
    public shieldBreakOverflow(_entity: BaseMonsterEntity, _amount: number, scaled: number): number {
      return Math.max(0, scaled - this.shieldHealth);
    }
    public onShieldBroken(_entity: BaseMonsterEntity, _overflow: number): void { }
  }
  return ShieldModelMixin;
}

export function withShieldEntity<TBase extends EntityCtor>(Base: TBase) {
  abstract class ShieldEntityMixin extends Base implements IShieldEntity {
    private shieldViewKey: string | null = null;

    public attachShieldView(def: EquipmentDef): void {
      createEquipmentSprite(this, def.key, def.visual);
      this.shieldViewKey = def.key;
    }

    public syncShieldView(): void {
      const model = this.model as unknown as IShieldModel;
      const key = this.shieldViewKey ?? model.shieldKey;
      if (!key) return;
      const sprite = this.attachSprites.get(key);
      if (!sprite) return;
      sprite.setVisible(!model.shieldBroken && model.shieldHealth > 0);
      const thresholds = model.shieldDef?.thresholds ?? [];
      sprite.setFrame(equipmentFrame(model.shieldHealth, thresholds));
    }

    public override syncViewFromModel(): void {
      super.syncViewFromModel();
      this.syncShieldView();
    }
  }
  return ShieldEntityMixin;
}

// --- Weapon -----------------------------------------------------------------

export interface IWeaponModel {
  weaponDef: EquipmentDef | null;
  weaponKey: string;
  weaponVisible: boolean;
  weaponSwinging: boolean;
  equipWeapon(entity: BaseEntity | null, def: EquipmentDef): void;
  consumeWeapon(entity: BaseEntity | null): void;
  onAttackStarted(entity: BaseEntity | null): void;
  onAttackStopped(entity: BaseEntity | null): void;
}

export interface IWeaponEntity {
  attachWeaponView(def: EquipmentDef): void;
  syncWeaponView(): void;
}

export function withWeaponModel<TBase extends ModelCtor>(Base: TBase) {
  abstract class WeaponModelMixin extends Base implements IWeaponModel {
    public get weaponDef(): EquipmentDef | null {
      return this.getConfigValue<EquipmentDef>("weaponDef") ?? null;
    }
    public get weaponKey(): string {
      return this.getConfigValue<string>("weaponKey") ?? "";
    }
    public weaponVisible = true;
    public weaponSwinging = false;

    public equipWeapon(entity: BaseEntity | null, def: EquipmentDef): void {
      this.setConfigValue("weaponDef", freezeEquipmentDef(def));
      this.setConfigValue("weaponKey", def.key);
      this.weaponVisible = true;
      this.weaponSwinging = false;
      if (entity) (entity as unknown as IWeaponEntity).attachWeaponView(def);
      entity?.syncViewFromModel();
    }

    public consumeWeapon(entity: BaseEntity | null): void {
      this.weaponVisible = false;
      this.weaponSwinging = false;
      entity?.syncViewFromModel();
    }

    public onAttackStarted(entity: BaseEntity | null): void {
      this.weaponSwinging = true;
      entity?.syncViewFromModel();
    }

    public onAttackStopped(entity: BaseEntity | null): void {
      this.weaponSwinging = false;
      entity?.syncViewFromModel();
    }
  }
  return WeaponModelMixin;
}

export function withWeaponEntity<TBase extends EntityCtor>(Base: TBase) {
  abstract class WeaponEntityMixin extends Base implements IWeaponEntity {
    private weaponViewKey: string | null = null;
    private weaponTween: Phaser.Tweens.Tween | null = null;

    public attachWeaponView(def: EquipmentDef): void {
      createEquipmentSprite(this, def.key, def.visual);
      this.weaponViewKey = def.key;
    }

    public syncWeaponView(): void {
      const model = this.model as unknown as IWeaponModel;
      const key = this.weaponViewKey ?? model.weaponKey;
      if (!key) return;

      const def = model.weaponDef;
      const visual = def?.visual;
      const sprite = this.attachSprites.get(key);
      if (sprite) sprite.setVisible(model.weaponVisible);

      const angle = visual?.swingAngle ?? 0;
      const duration = visual?.swingDuration ?? 0;
      const shouldSwing = Boolean(angle && duration && model.weaponSwinging && model.weaponVisible);
      if (shouldSwing && !this.weaponTween && sprite) {
        this.weaponTween = this.scene.tweens.add({
          targets: sprite,
          angle: -Math.abs(angle),
          duration,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      } else if (!shouldSwing && this.weaponTween) {
        this.weaponTween.stop();
        this.weaponTween = null;
        sprite?.setAngle(0);
      }
    }

    public override syncViewFromModel(): void {
      super.syncViewFromModel();
      this.syncWeaponView();
    }
  }
  return WeaponEntityMixin;
}

// --- 组合基类 ---------------------------------------------------------------

const HelmetEntityBase = withHelmetEntity(StagedBodyMonsterEntity);
const ShieldEntityBase = withShieldEntity(HelmetEntityBase);
const EquippedEntityBase = withWeaponEntity(ShieldEntityBase);

/** 同时具备 helmet / shield / weapon 渲染能力的怪物 Entity 基类。 */
export abstract class EquippedMonsterEntity extends EquippedEntityBase {
  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    const model = this.model as MonsterModel & Partial<IShieldModel> & Partial<IHelmetModel>;
    if (model.absorbShieldDamage?.(this, amount, dealer, source)) return;
    if (model.absorbHelmetDamage?.(this, amount, dealer, source)) return;
    super.takeDamage(amount, dealer, source);
  }
}
