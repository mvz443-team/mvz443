import type { BaseEntity } from "../core/BaseEntity";
import type { MonsterEntity } from "../entities/MonsterEntity";
import { PresetMonsterModel } from "../entities/MonsterEntity";
import { readProjectileHitKind } from "../projectiles/ProjectileModels";
import type { DamageKind, EquipmentDef } from "../equipment/Equipment";
import SoundCmd from "../../utils/cmd/SoundCmd";
import type { Game } from "../../scenes/Game";

export type MediumSlot = "head" | "mainHand" | "offHand";

/** 单个装备槽的运行时状态；全部 JSON 安全，进入快照。 */
export type EquipmentSlotState = {
  defId: string;
  health: number;
  maxHealth: number;
  broken: boolean;
  visible: boolean;
  swinging: boolean;
};

function createSlotState(def: EquipmentDef): EquipmentSlotState {
  return {
    defId: def.key,
    health: def.maxHealth,
    maxHealth: def.maxHealth,
    broken: def.maxHealth <= 0,
    visible: true,
    swinging: false,
  };
}

/** 伤害来源 → 统一命中类型；无投射物来源视为近战。 */
export function resolveDamageKind(source: unknown): DamageKind {
  const kind = readProjectileHitKind(source);
  if (kind) return kind;
  // 测试替身/旧 BulletEntity 可能没有 hitKind，但有刚体；按 bullet 处理。
  if (source && typeof source === "object" && "rigidBody" in source) return "bullet";
  return "melee";
}

function sourceVelocityX(source: unknown): number {
  const rigidBody = (source as { rigidBody?: { linvel?: () => { x: number } } } | null)?.rigidBody;
  return rigidBody?.linvel?.().x ?? 0;
}

/**
 * 中型怪物基类：头部 / 主手 / 副手三个装备槽 + 坐骑（沿用 MonsterModel 的 mount 字段）。
 *
 * 伤害路由是唯一入口，子类不再各自重载 takeDamage：
 * - 坐骑：按 Definition.priority / absorbHitKinds / mountPierceHitKinds 结算；
 * - 副手：只吸收配置的命中类型；laser/explosion 同时伤害副手和本体；
 * - 头部：永远为后续伤害吸收，破碎时按 immuneOverkill 决定溢出或丢弃；
 * - 本体：剩余伤害交给 MonsterModel.takeDamage。
 */
export abstract class MediumMonsterModel extends PresetMonsterModel {
  /** 怪物朝左为 -1，朝右为 1；木盾只挡正面来的 bullet。 */
  public facingX: -1 | 1 = -1;

  public equipment: Record<MediumSlot, EquipmentSlotState | null> = {
    head: null,
    mainHand: null,
    offHand: null,
  };

  public get equipmentDefs() {
    return this.definition.equipment ?? {};
  }

  public override initializeState(scene: Game, col: number, row: number, waveID: number): void {
    super.initializeState(scene, col, row, waveID);
    const defs = this.equipmentDefs;
    this.equipment = {
      head: defs.head ? createSlotState(defs.head) : null,
      mainHand: defs.mainHand ? createSlotState(defs.mainHand) : null,
      offHand: defs.offHand ? createSlotState(defs.offHand) : null,
    };
    const mount = this.mountDef;
    if (mount) {
      this.mountHealthMax = mount.maxHealth;
      this.mountHealth = mount.maxHealth;
      this.mountBroken = false;
    }
  }

  /** 兼容旧 mountHealth 字段的坐骑定义；新 preset 可直接写 equipment.mount。 */
  protected get mountDef(): EquipmentDef | null {
    const explicit = this.definition.equipment?.mount;
    if (explicit) return { ...explicit, priority: this.mountDamagePriority };

    const legacyHealth = this.definition.mountHealth ?? this.definition.vehicleHealth ?? 0;
    if (legacyHealth <= 0) return null;

    const priority = this.mountDamagePriority;
    const isBalloon = (this.definition.vehicleHealth ?? 0) > 0;
    return {
      key: isBalloon ? "legacy_balloon" : "legacy_mount",
      maxHealth: legacyHealth,
      thresholds: [],
      priority,
      absorbHitKinds: isBalloon
        ? ["bullet", "laser"]
        : priority === "mount" ? ["bullet", "laser", "melee"] : [],
      mountPierceHitKinds: isBalloon ? ["explosion"] : ["explosion"],
      mountKind: isBalloon ? "balloon" : "boat",
    };
  }

  // --- 兼容旧 mixin / 测试字段 ---

  public get helmetDef(): EquipmentDef | null {
    return this.equipmentDefs.head ?? null;
  }
  public get helmetKey(): string {
    return this.equipmentDefs.head?.key ?? "";
  }
  public get helmetHealth(): number {
    return this.equipment.head?.health ?? 0;
  }
  public set helmetHealth(value: number) {
    if (this.equipment.head) this.equipment.head.health = value;
  }
  public get helmetBroken(): boolean {
    return this.equipment.head?.broken ?? false;
  }
  public set helmetBroken(value: boolean) {
    if (this.equipment.head) this.equipment.head.broken = value;
  }

  public get shieldDef(): EquipmentDef | null {
    return this.equipmentDefs.offHand ?? null;
  }
  public get shieldKey(): string {
    return this.equipmentDefs.offHand?.key ?? "";
  }
  public get shieldHealth(): number {
    return this.equipment.offHand?.health ?? 0;
  }
  public set shieldHealth(value: number) {
    if (this.equipment.offHand) this.equipment.offHand.health = value;
  }
  public get shieldBroken(): boolean {
    return this.equipment.offHand?.broken ?? false;
  }
  public set shieldBroken(value: boolean) {
    if (this.equipment.offHand) this.equipment.offHand.broken = value;
  }

  public get weaponDef(): EquipmentDef | null {
    return this.equipmentDefs.mainHand ?? null;
  }
  public get weaponKey(): string {
    return this.equipmentDefs.mainHand?.key ?? "";
  }
  public get weaponVisible(): boolean {
    return this.equipment.mainHand?.visible ?? false;
  }
  public get weaponSwinging(): boolean {
    return this.equipment.mainHand?.swinging ?? false;
  }

  // --- 武器 ---

  public isMainHandUsable(): boolean {
    const slot = this.equipment.mainHand;
    return !!slot && !slot.broken && slot.health > 0;
  }

  /** 当前有效攻击力：武器破碎后扣掉 damageLossOnBreak。 */
  public override getAttackDamage(): number {
    if (this.isMainHandUsable()) return this.attackDamage;
    return this.attackDamage - (this.equipmentDefs.mainHand?.damageLossOnBreak ?? 0);
  }

  public override onAttackStarted(entity: MonsterEntity): void {
    const slot = this.equipment.mainHand;
    if (!slot) return;
    slot.swinging = true;
    entity.syncViewFromModel();
  }

  public override onAttackStopped(entity: MonsterEntity): void {
    const slot = this.equipment.mainHand;
    if (!slot) return;
    slot.swinging = false;
    entity.syncViewFromModel();
  }

  /** 每次实际命中/射击消耗 1 点武器耐久。 */
  public override onAttackLanded(entity: MonsterEntity): void {
    this.consumeMainHand(entity);
  }

  protected consumeMainHand(entity: MonsterEntity): void {
    const slot = this.equipment.mainHand;
    const def = this.equipmentDefs.mainHand;
    if (!slot || !def || slot.broken || slot.health <= 0) return;

    slot.health = Math.max(0, slot.health - (def.durabilityPerUse ?? 1));
    if (slot.health === 0) {
      slot.broken = true;
      slot.visible = false;
      slot.swinging = false;
      this.onMainHandBroken(entity);
    }
    entity.syncViewFromModel();
  }

  public onMainHandBroken(_entity: MonsterEntity): void { }

  /** 兼容旧 mixin：直接打碎主手（手杖撑杆跳这类一次性消耗）。 */
  public breakMainHand(entity: MonsterEntity): void {
    const slot = this.equipment.mainHand;
    if (!slot || slot.broken) return;
    slot.health = 0;
    slot.broken = true;
    slot.visible = false;
    slot.swinging = false;
    this.onMainHandBroken(entity);
    entity.syncViewFromModel();
  }

  // --- 兼容旧 mixin / 单槽测试入口 ---

  /** 兼容旧接口：只结算头部，不经过坐骑/副手。 */
  public absorbHelmetDamage(
    entity: MonsterEntity,
    amount: number,
    dealer?: BaseEntity,
    source?: BaseEntity,
  ): boolean {
    const def = this.equipmentDefs.head;
    const slot = this.equipment.head;
    if (!def || !slot || slot.broken || slot.health <= 0) return false;

    const reduced = amount * (def.damageScale ?? 1);
    const absorbed = reduced * (def.absorbRatio ?? 1);
    const unabsorbed = reduced - absorbed;
    if (slot.health > absorbed) {
      slot.health -= absorbed;
      this.playHitFeedback(entity, def);
      entity.syncViewFromModel();
      return true;
    }

    const overflow = Math.max(0, absorbed - slot.health);
    slot.health = 0;
    slot.broken = true;
    slot.visible = false;
    this.onHeadBroken(entity, overflow);
    entity.syncViewFromModel();
    const remaining = def.breakOverflow === "full"
      ? amount
      : unabsorbed + (def.immuneOverkill ? 0 : overflow);
    if (remaining > 0) super.takeDamage(entity, remaining, dealer, source);
    return true;
  }

  /** 兼容旧接口：只结算副手，不经过头部/本体（除非破盾溢出）。 */
  public absorbShieldDamage(
    entity: MonsterEntity,
    amount: number,
    dealer?: BaseEntity,
    source?: BaseEntity,
  ): boolean {
    const def = this.equipmentDefs.offHand;
    const slot = this.equipment.offHand;
    if (!def || !slot || slot.broken || slot.health <= 0) return false;
    if (!this.canShieldBlock(entity, source)) return false;

    const reduced = amount * (def.damageScale ?? 1);
    if (slot.health > reduced) {
      slot.health -= reduced;
      this.playHitFeedback(entity, def);
      entity.syncViewFromModel();
      return true;
    }

    const overflow = Math.max(0, reduced - slot.health);
    slot.health = 0;
    slot.broken = true;
    slot.visible = false;
    this.onOffHandBroken(entity, overflow);
    entity.syncViewFromModel();
    const remaining = def.breakOverflow === "full" ? amount : overflow;
    if (remaining > 0) super.takeDamage(entity, remaining, dealer, source);
    return true;
  }

  public canShieldBlock(_entity: MonsterEntity, source?: BaseEntity): boolean {
    const def = this.equipmentDefs.offHand;
    if (!def) return false;
    if (!(def.blockHitKinds ?? []).includes(resolveDamageKind(source))) return false;
    return this.canOffHandBlock(def, source);
  }

  // --- 伤害路由 ---

  public takeMediumDamage(
    entity: MonsterEntity,
    amount: number,
    dealer?: BaseEntity,
    source?: BaseEntity,
  ): void {
    if (amount <= 0 || entity.currentHealth <= 0) return;
    const kind = resolveDamageKind(source);
    let remaining = amount;

    // 1) 坐骑：优先/穿透/完全吸收。
    const mount = this.mountDef;
    if (mount && this.hasMount()) {
      const pierce = (mount.mountPierceHitKinds ?? ["explosion"]).includes(kind);
      const absorb = (mount.absorbHitKinds ?? []).includes(kind);
      if (pierce) {
        this.damageMount(entity, amount);
      } else if (absorb && mount.priority !== "rider") {
        this.damageMount(entity, amount);
        remaining = 0;
      }
    }

    // 2) 副手：木盾只挡正面 bullet；laser/explosion 同时伤害盾和本体。
    const offDef = this.equipmentDefs.offHand;
    const offSlot = this.equipment.offHand;
    if (remaining > 0 && offDef && offSlot && !offSlot.broken && offSlot.health > 0) {
      const pierce = (offDef.pierceHitKinds ?? ["laser", "explosion"]).includes(kind);
      if (pierce) {
        this.damageOffHand(entity, amount * (offDef.damageScale ?? 1), offDef);
      } else if ((offDef.blockHitKinds ?? []).includes(kind) && this.canOffHandBlock(offDef, source)) {
        const reduced = remaining * (offDef.damageScale ?? 1);
        if (offSlot.health > reduced) {
          offSlot.health -= reduced;
          this.playHitFeedback(entity, offDef);
          remaining = 0;
        } else {
          const overflow = Math.max(0, reduced - offSlot.health);
          offSlot.health = 0;
          offSlot.broken = true;
          offSlot.visible = false;
          this.onOffHandBroken(entity, overflow);
          remaining = offDef.overflow === "discard"
            ? 0
            : offDef.breakOverflow === "full" ? remaining : overflow;
        }
        entity.syncViewFromModel();
      }
    }

    // 3) 头部：永远吸收；破碎后按 immuneOverkill 溢出/丢弃。
    const headDef = this.equipmentDefs.head;
    const headSlot = this.equipment.head;
    if (remaining > 0 && headDef && headSlot && !headSlot.broken && headSlot.health > 0) {
      const reduced = remaining * (headDef.damageScale ?? 1);
      const absorbed = reduced * (headDef.absorbRatio ?? 1);
      const unabsorbed = reduced - absorbed;

      if (headSlot.health > absorbed) {
        headSlot.health -= absorbed;
        this.playHitFeedback(entity, headDef);
        remaining = unabsorbed;
      } else {
        const overflow = Math.max(0, absorbed - headSlot.health);
        headSlot.health = 0;
        headSlot.broken = true;
        headSlot.visible = false;
        this.onHeadBroken(entity, overflow);
        remaining = headDef.breakOverflow === "full"
          ? remaining
          : unabsorbed + (headDef.immuneOverkill ? 0 : overflow);
      }
      entity.syncViewFromModel();
    }

    // 4) 本体。
    if (remaining > 0) {
      super.takeDamage(entity, remaining, dealer, source);
    }

    // 本体死亡 → 坐骑一起死亡。
    if (this.health <= 0 && this.hasMount()) {
      this.breakMount(entity);
    }
    entity.syncViewFromModel();
  }

  protected canOffHandBlock(def: EquipmentDef, source?: BaseEntity): boolean {
    if (def.blockDirection !== "facing") return true;
    const vx = sourceVelocityX(source);
    if (vx === 0) return false;
    return vx * this.facingX < 0;
  }

  private damageMount(entity: MonsterEntity, amount: number): void {
    this.mountHealth = Math.max(0, this.mountHealth - amount);
    if (this.mountHealth === 0) this.breakMount(entity);
  }

  private damageOffHand(entity: MonsterEntity, amount: number, def: EquipmentDef): void {
    const slot = this.equipment.offHand;
    if (!slot || slot.broken) return;
    slot.health = Math.max(0, slot.health - amount);
    this.playHitFeedback(entity, def);
    if (slot.health === 0) {
      slot.broken = true;
      slot.visible = false;
      this.onOffHandBroken(entity, 0);
    }
  }

  private playHitFeedback(entity: MonsterEntity, def: EquipmentDef): void {
    if (def.hitSound) SoundCmd.PlayShieldHit(def.hitSound);
    entity.animController.highlight();
  }

  public onHeadBroken(_entity: MonsterEntity, _overflow: number): void { }
  public onOffHandBroken(_entity: MonsterEntity, _overflow: number): void { }
}
