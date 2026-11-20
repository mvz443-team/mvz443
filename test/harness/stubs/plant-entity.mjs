import { CombatEntity } from "./combat-entity.mjs";
import { attachModelAccessors } from "../../../src/game/core/logic/LogicModel.ts";
import { ProjectileCmd } from "./cmd-projectile.mjs";
import { SfxCmd } from "./cmd-sfx.mjs";
import manager from "./manager-generic.mjs";
import seedrandom from "seedrandom";

/** PlantEntity 替身：只保留 Model 访问的字段/方法。 */
export class PlantEntity extends CombatEntity {
  constructor(scene, col, row, model, level = 1) {
    const pos = { x: 100 + col * 100, y: 100 + row * 100 };
    super(scene, pos.x, pos.y, model.maxHealth.getValueAt(level), 1, model);
    this.col = col;
    this.row = row;
    this.level = level;
    this.model = model;
    this.game = scene;
    this.baseDepth = row * 1000;
    this.viewGroup = {
      children: [],
      add() {},
      addMultiple() {},
      getChildren() { return this.children; },
      remove() {},
      setVisible() {},
      destroy() {},
    };
    model.level = level;
    model.healthMax = model.maxHealth.getValueAt(level);
    model.health = model.healthMax;
    this.viewCalls = [];
    this.random = seedrandom.alea(`plant:${col}:${row}:${model.pid}`, { state: true });
    // 真实 TntMinesEntity 在构造时把自己设为埋藏状态。
    if (model.pid === 4) model.isBuried = true;

    // attachModelAccessors 只跳过“自有属性”，会把 CombatEntity/PlantEntity
    // 原型上的 maxHealth、isSleeping、pid 等访问器遮蔽成 Model 配置对象。
    // 测试替身保留原型语义，避免把 LevelScaledValue 当成数值使用。
    const prototypeKeys = new Set();
    for (let proto = Object.getPrototypeOf(this); proto; proto = Object.getPrototypeOf(proto)) {
      for (const key of Object.getOwnPropertyNames(proto)) prototypeKeys.add(key);
    }
    attachModelAccessors(this, model);
    for (const key of prototypeKeys) {
      if (key === "constructor") continue;
      if (Object.prototype.hasOwnProperty.call(this, key)) delete this[key];
    }
  }

  get pid() { return this.model.pid; }
  get isSleeping() { return this.model.isSleeping; }

  /** 与真实 PlantEntity.getCellPlants 一致：同格植物列表，仅供 Model 查询。 */
  getCellPlants() {
    const map = manager.Instance?.PlantsMap;
    return [...(map?.get(`${this.col}-${this.row}`) ?? [])];
  }

  /** 与真实 PlantEntity.takeDamage 一致：先走 Model 的护盾路由判定。 */
  takeDamage(amount, dealer, source) {
    if (this.model.redirectDamageToShield?.(this, amount, dealer, source)) return;
    super.takeDamage(amount, dealer, source);
  }

  onHurt(amount, realDamage, dealer, source) {
    this.model.onHurt?.(this, amount, realDamage, dealer, source);
  }

  playSpikeActivateAnimation() { this.viewCalls.push("playSpikeActivateAnimation"); }
  syncInflateView() { this.viewCalls.push("syncInflateView"); }

  /** 与真实 BalloonTntEntity.onCollision 一致：碰撞交给 Model 判定。 */
  onCollision(ctx) {
    this.model.handleCollision?.(this, ctx?.targetEntity);
  }
  syncSpikyView() { this.viewCalls.push(`syncSpikyView:${this.model.isSpiky}`); }
  get inBruteShoot() { return this.model.inBruteShoot; }
  set inBruteShoot(value) { this.model.inBruteShoot = value; }

  playShootAnimation() { this.viewCalls.push("playShootAnimation"); }
  playBruteShootAnimation(total) { this.viewCalls.push(`playBruteShootAnimation:${total}`); }
  recoverHeadPosition() { this.viewCalls.push("recoverHeadPosition"); }
  resetHeadPosition() { this.viewCalls.push("resetHeadPosition"); }
  playLaserAnimation() { this.viewCalls.push("playLaserAnimation"); }
  playFreezeAnimation() { this.viewCalls.push("playFreezeAnimation"); }
  playPowderAnimation() { this.viewCalls.push("playPowderAnimation"); }
  playGenerateAnimation() { this.viewCalls.push("playGenerateAnimation"); }
  playAwakAnimation() { this.viewCalls.push("playAwakAnimation"); }
  playAwakeAnimation() { this.viewCalls.push("playAwakeAnimation"); }
  playAttackAnimation() { this.viewCalls.push("playAttackAnimation"); }
  playBruteShootSequence() { this.viewCalls.push("playBruteShootSequence"); }
  playMasterSparkAnimation() { this.viewCalls.push("playMasterSparkAnimation"); }
  playShieldActivateAnimation() { this.viewCalls.push("playShieldActivateAnimation"); }
  playSkillSfx() { this.viewCalls.push("playSkillSfx"); }
  playSummonEffects() { this.viewCalls.push("playSummonEffects"); }
  playSceneFlash() { this.viewCalls.push("playSceneFlash"); }
  playCharge() { this.viewCalls.push("playCharge"); }
  playArc() { this.viewCalls.push("playArc"); }
  playObsidianHighJump() { this.viewCalls.push("playObsidianHighJump"); }
  playWardenHighJump() { this.viewCalls.push("playWardenHighJump"); }
  playWardenLand() { this.viewCalls.push("playWardenLand"); }
  playWardenDig() { this.viewCalls.push("playWardenDig"); }
  playWardenSkillSfx() { this.viewCalls.push("playWardenSkillSfx"); }
  createVisualEffect() {
    this.viewCalls.push("createVisualEffect");
    SfxCmd.Create({ name: "PowderScatterSfx" }, { scene: this.scene, x: this.x, y: this.y });
  }
  updateDisplayFrame() { this.viewCalls.push("updateDisplayFrame"); }
  wakeup() { this.model.isBuried = false; this.viewCalls.push("wakeup"); }
  awakePlantsInGrid() {
    const plants = manager.Instance.PlantsMap.get(`${this.col}-${this.row}`) ?? [];
    for (const plant of plants) {
      if (plant === this) continue;
      plant.setSleeping?.(false);
    }
    this.viewCalls.push("awakePlantsInGrid");
  }
  notifySpawnHooks() { this.viewCalls.push("notifySpawnHooks"); }
  notifyHalfHealthHooks() { this.viewCalls.push("notifyHalfHealthHooks"); }
  activateLightning(duration) {
    this.model.isLightning = true;
    this.model.tickmanager.delayedCall({
      delay: duration,
      callback: () => {
        if (this.currentHealth > 0) this.model.isLightning = false;
      },
    });
    this.viewCalls.push("activateLightning");
  }
  canExtendSightLineFor(faction) {
    return this.currentHealth > 0 && !this.model.isSleeping && this.faction === faction;
  }
  setVelocityX() {}
  setVisible(value) { this.visible = value; }
  syncViewFromModel() { this.viewCalls.push("syncViewFromModel"); }
  setSleeping(value) { this.model.isSleeping = value; this.model.onSleepStateChange?.(this, value); }
  hasSightTarget() { return false; }
  onDeath() { this.model.onDeath(this); }
  destroySelf() { this.destroyed = true; }

  /**
   * 与真实 PlantEntity.destroy 一致：先通知正在啃自己的怪物，
   * 让 Model 在权威帧决定"同格接力"还是"继续前进"。
   */
  destroy() {
    this.currentHealth = 0;
    for (const attacker of [...this.underAttackBy]) {
      if (typeof attacker?.onAttackTargetDestroyed === "function") {
        attacker.onAttackTargetDestroyed(this);
      }
    }
    this.underAttackBy.clear();
    this.model.onDeath?.(this);
    manager.Instance?.RegisterDestroy?.(this);
    this.destroyed = true;
  }
  initializeEntity() {
    if (this.initialized) return this;
    this.initialized = true;
    this.model.onCreate(this);
    return this;
  }
  createExplosion(config, x, _y, row) {
    ProjectileCmd.CreateExplosion(this.scene, x ?? this.x, row ?? this.row, config);
  }
}
