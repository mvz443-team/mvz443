import { _Typedebuffs } from "../../../constants/game";
import type { BuffKind } from "../../core/logic/Buffs";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { Faction } from "../Enum";
import { IDamageable } from "../Interface";
import { BaseEntity } from "./BaseEntity";

export abstract class CombatEntity extends BaseEntity implements IDamageable {
  /** 血量实际存储在 Model；这里只提供兼容访问器。 */
  public get currentHealth(): number { return (this.model as { health?: number } | null)?.health ?? 0; }
  public set currentHealth(value: number) {
    if (this.model) (this.model as unknown as Record<string, unknown>).health = value;
  }
  public get maxHealth(): number { return (this.model as { healthMax?: number } | null)?.healthMax ?? 0; }
  public set maxHealth(value: number) {
    if (this.model) (this.model as unknown as Record<string, unknown>).healthMax = value;
  }
  /**
   * 阵营实际存储在 Model；这里只提供兼容访问器。
   * 不能用自有字段遮蔽，否则 `attachModelAccessors` 会跳过，阵营无法进入快照。
   */
  public get faction(): Faction {
    return (this.model as { faction?: Faction } | null)?.faction ?? Faction.PLANT;
  }
  public set faction(value: Faction) {
    const model = this.model as unknown as { faction?: Faction } | null;
    if (model) model.faction = value;
  }

  public ExtraData: Record<string, any> = {}; // 用于存储额外数据，供子类使用

  // 正在被这些东西（应该是monster）攻击
  public underAttackBy: Set<CombatEntity> = new Set<CombatEntity>(); // alias attackingZombie

  constructor(scene: Game, x: number, y: number, maxHealth: number, faction: Faction, model?: import("../../core/logic/LogicModel").LogicModel) {
    super(scene, x, y, model ?? null);
    this.maxHealth = maxHealth;
    this.currentHealth = maxHealth;
    this.faction = faction;
  }

  public GetRow(): number {
    return PositionManager.Instance.getRowByY(this.y);
  }

  /**
   * 统一的受击逻辑
   * @param amount 伤害数值
   * @param dealer 伤害来源，如僵尸，植物， 矿车
   * @param source 伤害来源的具体对象（比如子弹/爆炸），可选
   */
  public takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (this.currentHealth <= 0) return;

    const realDamage = Math.min(amount, this.currentHealth);
    this.currentHealth -= amount;
    this.onHurt(amount, realDamage, dealer, source); // 提供给子类的钩子，用于播特效/音效

    if (this.currentHealth <= 0) {
      this.currentHealth = 0;
      this.die();
    }
  }

  // 供子类重写：受伤时的表现（比如植物闪烁，僵尸掉胳膊）
  protected abstract onHurt(amount: number, realDamage: number, dealer?: BaseEntity, source?: BaseEntity): void;

  // 死亡逻辑
  public die(): void {
    this.onDeath(); // 供子类重写：播死亡动画/掉落阳光
    this.destroy(); // 调用 BaseEntity 的清理
  }

  protected abstract onDeath(): void;

  public GetExtraData<T>(key: string): T | undefined {
    return this.ExtraData[key] as T;
  }

  // --- 泛用的 Buff/Debuff 逻辑：状态全在 Model，Entity 只做委托 -----------------

  /** 供投射物命中等入口调用；真正状态与 timer 在 Model。 */
  public addDebuff(debuff: _Typedebuffs, durationMs: number): void {
    if (!debuff) return;
    const model = this.model as unknown as { applyBuff?: (kind: BuffKind, ms: number) => boolean } | null;
    model?.applyBuff?.(debuff, durationMs);
  }

  protected removeDebuff(debuff: _Typedebuffs): void {
    if (!debuff) return;
    const model = this.model as unknown as { clearBuff?: (kind: BuffKind) => void } | null;
    model?.clearBuff?.(debuff);
  }

  /** 返回剩余毫秒（0 表示没有）；基于帧号，回滚后一致。 */
  public hasDebuff(name: _Typedebuffs): number {
    if (!name) return 0;
    const model = this.model as unknown as { getBuffLeftMs?: (kind: BuffKind) => number } | null;
    return model?.getBuffLeftMs?.(name) ?? 0;
  }

  protected clearAllDebuffs(): void {
    const model = this.model as unknown as { clearAllBuffs?: () => void } | null;
    model?.clearAllBuffs?.();
  }
}
