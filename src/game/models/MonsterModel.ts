import seedrandom from "seedrandom";
import type { Game } from "../scenes/Game";
import type { BaseEntity } from "./core/BaseEntity";
import { CombatEntity } from "./core/CombatEntity";
import type { MonsterDefinition, MonsterEntity, MountDamagePriority } from "./entities/MonsterEntity";
import { readProjectileHitKind } from "./projectiles/ProjectileModels";
import { LogicModel } from "../core/logic/LogicModel";
import { readBodyLayers } from "../core/logic/BodyTraits";
import { DEFAULT_HABITATS, type TerrainHabitat } from "../core/logic/TerrainHabitat";
import type { JsonValue } from "../core/SimulationState";
import type { ITickTimerHandle } from "../core/logic/EntityTickManager";
import { DEFAULT_TICK_EVENT_NAMES } from "../core/logic/TickEvents";
import {
  BUFF_DEFINITIONS,
  BUFF_EVENTS,
  BUFF_KINDS,
  FROZEN_CHAIN_SLOW_MS,
  type BuffKind,
} from "../core/logic/Buffs";
import { Faction } from "./Enum";
import { isHostile } from "../core/logic/FactionRelations";
import PlantHelper from "../utils/helper/PlantHelper";
import {
  isCarrierPlantPid,
  isPowderPlantPid,
  isShieldPlantPid,
} from "../utils/helper/PlantTargeting";
import type { PlantEntity } from "./entities/PlantEntity";
import CombatManager from "../managers/CombatManager";
import { PositionManager } from "../managers/view/PositionManager";
import ResourceCmd from "../utils/cmd/ResourceCmd";
import { SfxCmd } from "../utils/cmd/SfxCmd";
import { GainStarShardSfx } from "../sfx/star/GainStarShardSfx";
import type { CollisionContext } from "../types";

const MONSTER_EVENTS = {
  Attack: "MonsterAttack",
  DeathSettle: "MonsterDeathSettle",
} as const;

/** 死亡表现时长（与 DeathRotateSfx 的 400ms 对齐），仅决定纯表现何时结束。 */
const DEATH_SETTLE_MS = 400;

/**
 * 同格接力目标的优先级：护盾外壳 0 → 粉尘植物 1 → 普通植物 2 → 承载物 3。
 *
 * 必须是显式全序，不能靠 `IsMorePriorityPlant` 折叠候选列表：那条规则里
 * 粉尘植物与护盾互相"高于"对方（非传递），折叠结果会随 `PlantsMap` 数组顺序变化，
 * 而断线重连按快照 id 重建实体后数组顺序与连续运行的客户端不同 → desync。
 */
export function attackTargetRank(pid: number): number {
  if (isShieldPlantPid(pid)) return 0;
  if (isPowderPlantPid(pid)) return 1;
  if (isCarrierPlantPid(pid)) return 3;
  return 2;
}

export abstract class MonsterModel extends LogicModel {
  public override get tickEventNames(): readonly string[] {
    return [
      ...DEFAULT_TICK_EVENT_NAMES,
      MONSTER_EVENTS.Attack,
      MONSTER_EVENTS.DeathSettle,
      ...BUFF_KINDS.map((kind) => BUFF_EVENTS[kind]),
    ];
  }

  /** 以下运行时字段全部自动进入快照；新增字段直接写在这里即可。 */
  public waveID: number = -1;
  public health: number = 0;
  public speed: number = 0;
  public originalSpeed: number = 0;
  public isDying: boolean = false;
  public isFrozen: boolean = false;
  public isStop: boolean = false;
  public carryStarShards: boolean = false;
  public carriedStarShards: number = 0;
  public starShardsDropped: boolean = false;
  public currentStage: number = -1;
  public hasStick: boolean = false;
  public vaultTargetX: number = 0;
  public isAttacking: boolean = false;
  public isHidden: boolean = false;
  public flashTriggered: boolean = false;
  public lastSkill: number = 0;
  public callCount: number = 0;
  public buffApplied: boolean = false;
  /** buff 到期帧（绝对逻辑帧）；0 表示未激活。三个字段都进快照。 */
  public buffSlowUntilFrame: number = 0;
  public buffFrozenUntilFrame: number = 0;
  public buffBerserkUntilFrame: number = 0;
  public skill1LastRow: number = -1;
  public hpTriggers: number[] = [];
  /** 实体引用关系留在 Entity 编解码，Model 只保存其稳定 id。 */
  public attackingId: string | null = null;

  /** 不可变怪物定义；由 PresetMonsterModel 构造时写入 config，不进入快照。 */
  protected get definition(): MonsterDefinition {
    const def = this.getConfigValue<MonsterDefinition>("definition");
    if (!def) throw new Error(`[MonsterModel] ${this.constructor.name} missing definition`);
    return def;
  }

  public get mid(): number { return this.definition.mid; }
  public get nameKey(): string { return this.definition.nameKey; }
  public get texturePath(): string { return this.definition.texturePath ?? "zombie/zombie"; }
  public get level(): number { return this.definition.level; }
  public get weight(): (waveID: number) => number { return this.definition.weight; }
  public get leastWaveIDByStageID(): ((stageID: number) => number) | undefined {
    return this.definition.leastWaveIDByStageID;
  }
  public get leastWaveID(): number | undefined { return this.definition.leastWaveID; }
  public get rank(): "normal" | "elite" | "boss" { return this.definition.rank ?? "normal"; }
  /** buff 免疫只看这句话标记（golem / centipede 系列），与 rank 无关。 */
  public get isBuffImmune(): boolean { return this.definition.buffImmune === true; }
  public get maxHealth(): number { return this.definition.maxHealth; }
  public get baseSpeed(): number { return this.definition.baseSpeed; }
  public get baseAttackDamage(): number { return this.definition.baseAttackDamage; }
  public get attackInterval(): number { return this.definition.attackInterval ?? 1000; }
  public get isDefaultFlying(): boolean { return this.definition.isDefaultFlying ?? false; }
  public get isDefaultInVoid(): boolean { return this.definition.isDefaultInVoid ?? false; }
  public get couldCarryStarShards(): boolean { return this.definition.couldCarryStarShards ?? true; }
  /** 通行域：决定该怪能被刷在什么地形、能在什么地形存活；与命中体态层正交。 */
  public get habitats(): readonly TerrainHabitat[] { return this.definition.habitats ?? DEFAULT_HABITATS; }
  /** 刷怪变种表（主导地形 → 替换 mid）；缺省为空对象。只读配置，不进快照。 */
  public get spawnVariants(): Readonly<Record<string, number>> { return this.definition.spawnVariants ?? {}; }
  /** 木船僵尸：无论出生行地形如何都挂载木船表现；普通怪在水面行仍按地形自动挂船。 */
  public get boatMounted(): boolean { return this.definition.boatMounted ?? false; }
  /**
   * 阵营，进快照。普通出怪为 ZOMBIE；星碎召唤的气球TNT分身为 PLANT；
   * PvP 中公共出怪为 NEUTRAL。由 `PresetMonsterModel` 构造时从 definition 注入，
   * 不再用原型 getter 读非快照配置——否则回滚/重连后无法保留运行时改阵营。
   */
  public faction: Faction = Faction.ZOMBIE;
  /** 临时魅惑归属；非 null 时覆盖 faction，进快照。 */
  public charmedBy: Faction | null = null;
  /** 魅惑到期绝对帧；0 表示未魅惑或永久魅惑。进快照，回滚后与定时器一致。 */
  public charmUntilFrame: number = 0;
  public get damageThresholds(): readonly number[] { return this.definition.damageThresholds ?? []; }
  public get mountHealthConfig(): number { return this.definition.mountHealth ?? 0; }
  /** 运行时覆盖（测试/特殊变体）；默认读 Definition。 */
  private mountDamagePriorityOverride: MountDamagePriority | null = null;
  public get mountDamagePriority(): MountDamagePriority {
    return this.mountDamagePriorityOverride
      ?? this.definition.equipment?.mount?.priority
      ?? this.definition.mountDamagePriority
      ?? "mount";
  }
  public set mountDamagePriority(value: MountDamagePriority) {
    this.mountDamagePriorityOverride = value;
  }
  /** 能否在不合适的地形中存活；golem/centipede/潜水僵尸为 false。 */
  public get canDrown(): boolean { return this.definition.canDrown ?? true; }

  /** 坐骑（木船/海豚）当前血量；所有字段进快照。 */
  public mountHealth: number = 0;
  public mountHealthMax: number = 0;
  public mountBroken: boolean = false;

  public abstract getWeight(waveID: number): number;

  /** 每个实体由 Model 负责初始化自己的运行时状态。 */
  public initializeState(scene: Game, col: number, row: number, waveID: number): void {
    this.waveID = waveID;
    this.health = this.maxHealth;
    this.healthMax = this.maxHealth;
    this.originalSpeed = this.baseSpeed;
    this.speed = this.originalSpeed;
    this.flying = this.isDefaultFlying;
    this.inVoid = this.isDefaultInVoid;
    this.mountHealthMax = this.mountHealthConfig;
    this.mountHealth = this.mountHealthConfig;
    this.mountBroken = false;
  }

  // --- Buff 系统：全部状态在 Model，到期走 tickmanager 事件，可快照可回滚 ---------

  private getBuffUntilFrame(kind: BuffKind): number {
    switch (kind) {
      case "slow": return this.buffSlowUntilFrame;
      case "frozen": return this.buffFrozenUntilFrame;
      case "berserk": return this.buffBerserkUntilFrame;
    }
  }

  private setBuffUntilFrame(kind: BuffKind, frame: number): void {
    switch (kind) {
      case "slow": this.buffSlowUntilFrame = frame; break;
      case "frozen": this.buffFrozenUntilFrame = frame; break;
      case "berserk": this.buffBerserkUntilFrame = frame; break;
    }
  }

  public hasBuff(kind: BuffKind): boolean {
    return this.getBuffUntilFrame(kind) > this.tickmanager.currentFrame;
  }

  /** 供实体/测试读取剩余毫秒；基于帧号而非墙钟，回滚后一致。 */
  public getBuffLeftMs(kind: BuffKind): number {
    const left = this.getBuffUntilFrame(kind) - this.tickmanager.currentFrame;
    return left > 0 ? left * this.tickmanager.frameInterval : 0;
  }

  /**
   * 施加 buff。幂等：同一 kind 多次施加取剩余时间最长者；不叠加、不缩短。
   * 对 definition.buffImmune 的实体（golem / centipede）直接拒绝，与 rank 无关。
   * @param durationMs 必须为正有限数；不允许永久（用足够长但有界的值表达）。
   */
  public applyBuff(kind: BuffKind, durationMs: number): boolean {
    if (this.isBuffImmune) return false;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return false;

    // 获得时清除声明的其它 buff（默认空 —— 当前三种可共存）。
    for (const other of BUFF_DEFINITIONS[kind].clearBuffs ?? []) {
      this.clearBuff(other);
    }

    const untilFrame = this.tickmanager.currentFrame
      + Math.ceil(durationMs / this.tickmanager.frameInterval);
    if (untilFrame <= this.getBuffUntilFrame(kind)) return false;
    this.setBuffUntilFrame(kind, untilFrame);

    // 先清同事件名的旧 timer，保证任意时刻每种 buff 只有一条到期 timer。
    this.tickmanager.removeByEvent(BUFF_EVENTS[kind]);
    this.tickmanager.schedule(BUFF_EVENTS[kind], durationMs);
    this.onBuffsChanged();
    return true;
  }

  public clearBuff(kind: BuffKind): void {
    if (this.getBuffUntilFrame(kind) <= 0) return;
    this.setBuffUntilFrame(kind, 0);
    this.tickmanager.removeByEvent(BUFF_EVENTS[kind]);
    this.onBuffsChanged();
  }

  public clearAllBuffs(): void {
    for (const kind of BUFF_KINDS) {
      if (this.getBuffUntilFrame(kind) > 0) this.clearBuff(kind);
    }
  }

  private onBuffExpired(kind: BuffKind): void {
    this.setBuffUntilFrame(kind, 0);
    // frozen 结束立即获得 5s slow；applyBuff 内部已触发 onBuffsChanged。
    if (kind === "frozen") {
      this.applyBuff("slow", FROZEN_CHAIN_SLOW_MS);
      return;
    }
    this.onBuffsChanged();
  }

  /** 速度/动画倍率：slow 减半、berserk 加倍，同时存在按比例相乘；frozen 归零。 */
  public get speedMultiplier(): number {
    if (this.hasBuff("frozen")) return 0;
    let m = 1;
    if (this.hasBuff("slow")) m *= 0.5;
    if (this.hasBuff("berserk")) m *= 2;
    return m;
  }

  /** 手部/腿部动画速度倍率，与移动/攻速同向。 */
  public get motionSpeedScale(): number {
    if (this.hasBuff("frozen")) return 0;
    return this.speedMultiplier;
  }

  /** 攻击间隔倍率：slow 翻倍（频率减半）、berserk 减半（频率加倍）。 */
  public get attackIntervalMultiplier(): number {
    let m = 1;
    if (this.hasBuff("slow")) m *= 2;
    if (this.hasBuff("berserk")) m *= 0.5;
    return m;
  }

  public get effectiveAttackInterval(): number {
    return Math.max(50, this.attackInterval * this.attackIntervalMultiplier);
  }

  /** 远程/技能 timer 的重排钩子；弓手覆写，其余实体默认无远程循环。 */
  protected clearRangedTimers(): void { }
  protected rebuildRangedTimers(): void { }

  /**
   * buff 变化后统一刷新行为：frozen 立刻停攻停移并重置计时器；
   * 恢复后按新攻速重建攻击/远程循环并把新移速写进刚体。
   */
  private onBuffsChanged(): void {
    const entity = this.host as MonsterEntity | null;
    const frozen = this.hasBuff("frozen");
    this.isFrozen = frozen;
    if (!entity) return;

    if (frozen) {
      this.clearAttackTimer(entity);
      this.clearRangedTimers();
      if (entity.attacking) this.stopAttacking(entity);
      entity.stopMove();
      return;
    }

    if (entity.attacking) {
      (entity as any).attackTimer = this.beginAttackTimer(entity, this.effectiveAttackInterval);
    }
    this.rebuildRangedTimers();
    if (!this.isStop && !this.isDying) entity.startMove();
  }

  /** 坐骑是否仍在架。 */
  public hasMount(): boolean {
    return this.mountHealthMax > 0 && !this.mountBroken && this.mountHealth > 0;
  }

  /**
   * 坐骑伤害路由（Entity.takeDamage 第一站）。
   *
   * - explosion：坐骑与本体同时结算（扣坐骑血后返回 false 让本体继续）。
   * - mount 优先：bullet / laser 由坐骑吸收；rider 优先：bullet / laser 直接打本体。
   */
  public absorbMountDamage(
    entity: MonsterEntity,
    amount: number,
    _dealer?: BaseEntity,
    source?: BaseEntity,
  ): boolean {
    if (!this.hasMount()) return false;
    const hitKind = readProjectileHitKind(source);
    if (hitKind === "explosion") {
      this.applyMountDamage(entity, amount);
      return false;
    }
    if (this.mountDamagePriority === "mount") {
      this.applyMountDamage(entity, amount);
      return true;
    }
    return false;
  }

  private applyMountDamage(entity: MonsterEntity, amount: number): void {
    this.mountHealth = Math.max(0, this.mountHealth - amount);
    if (this.mountHealth === 0) this.breakMount(entity);
  }

  /** 坐骑破碎：清视图、恢复正常形态；骑手此后暴露在环境中（可能溺亡）。 */
  public breakMount(entity: MonsterEntity): void {
    if (this.mountBroken) return;
    this.mountHealth = 0;
    this.mountBroken = true;
    this.onMountBroken(entity);
    entity.syncViewFromModel();
    entity.startMove();
  }

  public onMountBroken(_entity: MonsterEntity): void { }

  /**
   * 普攻定时器由 Model 创建；Entity 只保存句柄用于停止。
   *
   * 每次都必须先按事件名清掉旧循环：同格叠了多株植物时一次接触就会连续触发
   * 多次 `tryStartAttack`，而 Entity 上的句柄在跨进程重连重建后已经失效
   * （快照里只有 timer 的 id/帧号，没有句柄）。不清旧循环会出现两条普攻定时器，
   * 重连端攻击速度翻倍 → 与对端/服务端分叉。
   */
  public beginAttackTimer(_entity: MonsterEntity, intervalMs: number): ITickTimerHandle {
    this.tickmanager.removeByEvent(MONSTER_EVENTS.Attack);
    return this.tickmanager.schedule(MONSTER_EVENTS.Attack, intervalMs, { loop: true });
  }

  /** 清掉普攻循环：句柄可能已失效，必须再按事件名兜底清理。 */
  private clearAttackTimer(entity: MonsterEntity): void {
    (entity as any).attackTimer?.remove();
    (entity as any).attackTimer = null;
    this.tickmanager.removeByEvent(MONSTER_EVENTS.Attack);
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === MONSTER_EVENTS.Attack) {
      if (!this.isFrozen) (this.host as MonsterEntity | null)?.hurtTarget();
      return;
    }
    if (eventName === MONSTER_EVENTS.DeathSettle) {
      (this.host as MonsterEntity | null)?.destroy();
      return;
    }
    const buffKind = BUFF_KINDS.find((kind) => BUFF_EVENTS[kind] === eventName);
    if (buffKind) {
      this.onBuffExpired(buffKind);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  // --- 通用战斗逻辑：Entity 只做胶水调用，决策全部留在这里 -----------------

  public getSpawnViewOffset(col: number, row: number, spawnSeq: number): { x: number; y: number } {
    const rng = seedrandom.alea(
      `${CombatManager.Instance.seed}:${this.waveID}:${col}:${row}:${spawnSeq}`,
    );
    return {
      x: rng() * PositionManager.Instance.GRID_SIZEX / 5,
      y: rng() * PositionManager.Instance.GRID_SIZEY / 10,
    };
  }

  public checkOutOfBounds(entity: MonsterEntity): void {
    if (entity.x >= PositionManager.Instance.getWorldBounds().left) return;
    entity.destroySelf();
    CombatManager.Instance.EndGame(false);
  }

  /**
   * 移动方向上的最后一格列号。
   *
   * `MonsterEntity.startMove()` 用 `-speed` 作为横向速度，因此 speed 的符号
   * 就是移动的反向：speed > 0 → vx < 0 → 向左 → 最后一格是 col 0；
   * speed < 0 → vx > 0 → 向右 → 最后一格是最右列。
   *
   * 与"最左/最右列"的硬编码不同，这里从 speed 推导，保证换方向后判定仍成立。
   */
  public getLastColInMoveDirection(): number {
    const lastCol = Math.max(0, PositionManager.Instance.Col_Number - 1);
    return this.speed < 0 ? lastCol : 0;
  }

  /**
   * 是否已"刚进入"移动方向上的最后一格。
   *
   * 判定用格子边界而不是格子中心：向左时踏进 col 0 的右边界即触发，
   * 向右时踏进最右列的左边界即触发。x 来自刚体 translation 且进快照，
   * 固定步重放与回滚恢复后结果一致。
   */
  public hasEnteredLastCellInMoveDirection(entity: MonsterEntity): boolean {
    const pm = PositionManager.Instance;
    const cellLeft = pm.getGridTopLeft(this.getLastColInMoveDirection(), entity.row).x;
    return this.speed < 0
      ? entity.x >= cellLeft
      : entity.x <= cellLeft + pm.GRID_SIZEX;
  }

  public tryStartAttack(entity: MonsterEntity, target: BaseEntity): boolean {
    if (this.isFrozen || !this.canStartAttack(target)) return false;

    const current = entity.attacking as unknown as { col?: number; row?: number } | null;
    if (current && typeof current.col === "number" && typeof (target as any).col === "number"
      && PlantHelper.IsMorePriorityPlant(current as any, target as any)) {
      this.stopAttacking(entity);
    }

    entity.attacking = target as any;
    this.attackingId = target.SnapshotId;
    this.isStop = true;
    entity.stopMove();
    (target as any).underAttackBy?.add(entity);
    entity.animController.startArmSwing();
    (entity as any).attackTimer = this.beginAttackTimer(entity, this.effectiveAttackInterval);
    this.onAttackStarted(entity);
    return true;
  }

  public stopAttacking(entity: MonsterEntity): void {
    entity.attacking?.underAttackBy?.delete(entity);
    entity.attacking = null;
    this.attackingId = null;
    entity.animController.stopArmSwing();
    this.clearAttackTimer(entity);
    this.isStop = false;
    this.onAttackStopped(entity);
    entity.startMove();
  }

  /** 武器能力覆写；Model 决定开始/停止攻击，Entity 只按状态播放动画。 */
  public onAttackStarted(_entity: MonsterEntity): void { }
  public onAttackStopped(_entity: MonsterEntity): void { }
  /** 当前有效近战攻击力；中型怪物会把可用武器的 weaponDamage 加到这里。 */
  public getAttackDamage(): number { return this.baseAttackDamage; }
  /** 一次实际命中后触发；中型怪物用它消耗武器耐久。 */
  public onAttackLanded(_entity: MonsterEntity): void { }

  public hurtTarget(entity: MonsterEntity): void {
    const target = entity.attacking;
    if (!target || !this.isValidAttackTarget(target)) {
      this.onAttackTargetDestroyed(entity, target);
      return;
    }
    target.takeDamage(this.getAttackDamage(), entity as any);
    this.onAttackLanded(entity);
    if (!this.isValidAttackTarget(entity.attacking)) {
      this.onAttackTargetDestroyed(entity, entity.attacking);
    }
  }

  /**
   * 当前普攻目标消失（被打碎 / 被铲除）时的一次性接触重检。
   *
   * 信号来源：`PlantEntity.destroy()` 在权威帧把"我死了"发给 `underAttackBy` 里的怪物。
   * Rapier 的 sensor 只在 overlap-start 派发事件，僵尸停下来啃护盾时与同格其它植物
   * 的那次碰撞早已消耗掉，不会再有新事件；所以收到信号的这一帧做**一次**接触重检：
   * 扫「刚死掉的那一格」和「怪物自己当前所在的格」，挑一个继续啃。
   * 之后不再轮询，避免每帧开销和渲染时钟依赖。
   */
  public onAttackTargetDestroyed(entity: MonsterEntity, destroyed: BaseEntity | null): void {
    // 已经被别的路径换过目标，不再重复处理。
    if (destroyed && entity.attacking && entity.attacking !== destroyed) return;
    const next = this.pickContactTarget(entity, destroyed);
    if (next && this.retargetAttack(entity, next)) return;
    this.stopAttacking(entity);
  }

  /**
   * 阵营（被魅惑）改变后的确定性收尾。
   *
   * 当前啃食目标可能刚变成友军：按新的有效阵营重判一次。
   * 仍敌对则保持；否则按 `attackTargetRank` 全序重选接触目标，`retargetAttack`
   * 不重建普攻定时器，避免 flush / 渲染时机造成帧差。没有可啃目标才停攻。
   */
  public override onCharmChanged(): void {
    const entity = this.host as MonsterEntity | null;
    if (!entity || this.isDying || entity.currentHealth <= 0) return;

    if (this.isFrozen) {
      if (entity.attacking) {
        this.stopAttacking(entity);
        entity.stopMove();
      }
      return;
    }

    const current = entity.attacking;
    if (current && this.isValidAttackTarget(current)) return;

    const next = this.pickContactTarget(entity, current);
    if (next && this.retargetAttack(entity, next)) return;
    // 只有原本在啃的目标失效才停攻；本来空闲时不要无谓地重新 startMove。
    if (current) this.stopAttacking(entity);
  }

  /**
   * 一次性接触重检：把「死掉的那一格」与「自己当前所在格」的植物收集起来。
   *
   * 两格都要扫：僵尸啃植物时身体中心通常落在目标格的右邻格，
   * 只按自己的格子找会漏；而目标被别的路径清空时又只剩自己的格子可用。
   */
  private pickContactTarget(entity: MonsterEntity, destroyed: BaseEntity | null): PlantEntity | null {
    const cells: Array<{ col: number, row: number }> = [];
    const lost = destroyed as unknown as { col?: number, row?: number } | null;
    if (lost && typeof lost.col === "number" && typeof lost.row === "number") {
      cells.push({ col: lost.col, row: lost.row });
    }
    const selfCell = PositionManager.Instance.GetGridByPos(entity.x, entity.y);
    if (selfCell.col >= 0 && selfCell.row >= 0) {
      cells.push({ col: selfCell.col, row: selfCell.row });
    }

    const visited = new Set<string>();
    const candidates: PlantEntity[] = [];
    for (const cell of cells) {
      const key = `${cell.col}-${cell.row}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const plant of PlantHelper.GetPlantsInGrid(cell.col, cell.row)) {
        if ((plant as unknown as BaseEntity) === destroyed) continue;
        if (candidates.includes(plant)) continue;
        if (!this.canStartAttack(plant)) continue;
        candidates.push(plant);
      }
    }
    return this.pickBestCandidate(candidates);
  }

  /**
   * 选出下一个普攻目标。
   *
   * 结果必须与 `PlantsMap` 里的数组顺序无关：断线重连时实体是按快照顺序
   * （稳定 id 排序）重建的，插入顺序与"连续运行"的客户端不同。
   * 用 `IsMorePriorityPlant` 折叠会退化成顺序相关（粉尘植物与护盾会互相"高于"对方），
   * 于是这里改成显式全序：护盾外壳 → 粉尘植物 → 普通植物 → 承载物，同级再按 pid / 稳定 id 兜底。
   */
  private pickBestCandidate(candidates: PlantEntity[]): PlantEntity | null {
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const rank = attackTargetRank(a.pid) - attackTargetRank(b.pid);
      if (rank !== 0) return rank;
      if (a.pid !== b.pid) return a.pid - b.pid;
      const aId = a.SnapshotId ?? "";
      const bId = b.SnapshotId ?? "";
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
    return candidates[0];
  }

  /**
   * 换目标但不重置攻击计时器：护盾碎了以后接着啃内部植物，节奏不断档。
   *
   * 只改 Model 记录的目标与关系集合，不新建定时器，因此与 flush/渲染时刻无关。
   */
  public retargetAttack(entity: MonsterEntity, target: BaseEntity): boolean {
    if (this.isFrozen || this.isDying) return false;
    if (entity.currentHealth <= 0) return false;
    if (!this.canStartAttack(target)) return false;

    entity.attacking?.underAttackBy?.delete(entity);
    entity.attacking = target as any;
    this.attackingId = target.SnapshotId;
    this.isStop = true;
    entity.stopMove();
    (target as any).underAttackBy?.add(entity);
    return true;
  }

  public isValidAttackTarget(target: BaseEntity | null): boolean {
    if (!target || target.SnapshotId !== this.attackingId || target.currentHealth <= 0) return false;
    return this.canStartAttack(target);
  }

  /** 目标是否可作为新的普攻对象；已锁定的目标仍可被当前攻击继续命中。 */
  public canStartAttack(target: BaseEntity): boolean {
    if (!(target instanceof CombatEntity)) return false;
    if (target.currentHealth <= 0) return false;
    if (!isHostile(this, target)) return false;
    if ((target as { hasExploded?: boolean }).hasExploded) return false;
    const targetLayers = readBodyLayers(target);
    if (targetLayers.flying && !this.flying) return false;
    if (targetLayers.inVoid) return false;
    return true;
  }

  public takeDamage(entity: MonsterEntity, amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (entity.currentHealth <= 0 || this.isDying) return;
    const realDamage = Math.min(amount, entity.currentHealth);
    entity.currentHealth -= amount;
    this.health = entity.currentHealth;
    this.onHurt(entity, amount, realDamage, dealer, source);
    entity.animController.highlight();
    if (entity.currentHealth <= 0) {
      entity.currentHealth = 0;
      this.health = 0;
      this.zombieDie(entity);
    }
  }

  public onCollision(entity: MonsterEntity, ctx: CollisionContext): void {
    const target = ctx.targetEntity as unknown as BaseEntity;
    if (target && (target as any).faction !== undefined && isHostile(this, target)) {
      this.tryStartAttack(entity, target);
    }
  }

  public zombieDie(entity: MonsterEntity): void {
    if (this.isDying) return;
    this.isDying = true;
    this.dropCarriedStarShards(entity);
    this.stopAttacking(entity);
    (entity as any).playDeathAnimation();

    // 击杀入账、赛道移除与波次推进由权威帧定时器驱动，不能挂在 Phaser 死亡
    // 动画的 onComplete 上。表现时钟在暂停/回滚/帧率差异下两端不一致，会让
    // 同帧清波（如 TNT 爆炸）的 killed_count 达标帧不同，进而使下一波计时器
    // 的启动时刻分叉。DeathSettle 进入 Model 快照，重放时在同一权威帧触发。
    this.tickmanager.schedule(MONSTER_EVENTS.DeathSettle, DEATH_SETTLE_MS);
  }

  public addStarShards(entity: MonsterEntity, amount = 1): void {
    if (amount <= 0) return;
    this.carryStarShards = true;
    this.carriedStarShards += amount;
    (entity as any).startStarShardsOrbitEffect();
  }

  public dropCarriedStarShards(entity: MonsterEntity): void {
    if (this.starShardsDropped || !this.carryStarShards) return;
    this.starShardsDropped = true;
    const amount = Math.max(1, this.carriedStarShards);
    const view = entity as unknown as { scene?: Game; x: number; y: number };
    if (view.scene) {
      SfxCmd.Create(GainStarShardSfx, {
        scene: view.scene,
        x: view.x,
        y: view.y - PositionManager.Instance.GRID_SIZEY * 0.8,
        amount,
      });
    }
    ResourceCmd.AddStarshardToAll(amount);
    this.carryStarShards = false;
    this.carriedStarShards = 0;
  }

  public updateBodyDamageStage(entity: MonsterEntity, thresholds: readonly number[]): void {
    let stage = -1;
    for (let i = 0; i < thresholds.length; i++) {
      if (entity.currentHealth <= thresholds[i]) stage = i;
    }
    if (stage === this.currentStage) return;
    this.currentStage = stage;
    const raw = (entity.animController as any)?.raw as { switchBodyFrame?: (value: boolean | number) => void } | undefined;
    const fn = raw?.switchBodyFrame?.bind(raw);
    if (!fn) return;
    if (thresholds.length === 1) fn(stage >= 0);
    else fn(stage < 0 ? 0 : Math.min(stage + 1, thresholds.length));
  }

  public onCreate(_entity: MonsterEntity) { }

  public onHurt(_entity: MonsterEntity, _damage: number, _realDamage: number,
    _dealer?: BaseEntity, _source?: BaseEntity) { }

  public onDeath(_entity: MonsterEntity) { }

  protected initializeEntity<TEntity extends MonsterEntity>(entity: TEntity): TEntity {
    return entity.initializeEntity();
  }

  public abstract createEntity(scene: Game, col: number, row: number, waveID: number): MonsterEntity;
}
