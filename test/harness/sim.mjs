/**
 * Preset 模拟测试底座。
 *
 * - 真实代码：preset 的 Model、LevelScaledValue、TickManager、装备 mixin。
 * - 测试替身：Phaser 场景、Entity 物理/视图、Manager、Cmd。
 *
 * 所有测试统一以 50ms 逻辑帧推进，和游戏内 LEGACY_BALANCE_FRAME_INTERVAL_MS 一致。
 */

import { MonsterEntity } from "../../src/game/models/entities/MonsterEntity.ts";
import { attachModelAccessors } from "../../src/game/core/logic/LogicModel.ts";
import {
  resetTickManagerClock,
  updateAllTickManagers,
} from "../../src/game/core/logic/EntityTickManager.ts";
import { PositionManager } from "../../src/game/managers/view/PositionManager.ts";
import manager, {
  flushDeferred,
  getObstaclesMap,
  getPlantsMap,
  getResourceState,
  resetWorld,
  setGridType,
} from "./stubs/manager-generic.mjs";
import { PlantEntity } from "./stubs/plant-entity.mjs";
import { resetSightTarget, setSightTargetProvider } from "./stubs/sightline.mjs";
import { ProjectileCmd } from "./stubs/cmd-projectile.mjs";
import ResourceCmd from "./stubs/cmd-resource.mjs";
import MobCmd from "./stubs/cmd-mob.mjs";
import { PlantCmd } from "./stubs/cmd-plant.mjs";
import ObstacleCmd from "./stubs/cmd-obstacle.mjs";
import { SfxCmd } from "./stubs/cmd-sfx.mjs";

export const FRAME_MS = 50;

const liveModels = [];

/** 读取 1–9 级的值，用于逐级回归断言。 */
export function levelValues(getter) {
  return Array.from({ length: 9 }, (_, index) => getter(index + 1));
}

function trackModel(model) {
  liveModels.push(model);
  return model;
}

function makeGameObject(extra = {}) {
  const data = new Map();
  const obj = {
    x: 0,
    y: 0,
    angle: 0,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    displayWidth: 100,
    displayHeight: 100,
    frame: { name: "0" },
    setOrigin() { return this; },
    setDisplaySize() { return this; },
    setDepth() { return this; },
    setFrame(value) { this.frame = { name: String(value) }; return this; },
    setVisible(value) { this.visible = value; return this; },
    setScale(x, y) { this.scaleX = x; this.scaleY = y ?? x; return this; },
    setAlpha(value) { this.alpha = value; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setRotation(value) { this.rotation = value; return this; },
    setAngle(value) { this.angle = value; return this; },
    setData(key, value) { data.set(key, value); return this; },
    getData(key) { return data.get(key); },
    setDepthValue(value) { this.depth = value; return this; },
    destroy() { this.destroyed = true; },
    ...extra,
  };
  return obj;
}

function makeGroup() {
  const children = [];
  return {
    children,
    add(child) { children.push(child); return this; },
    addMultiple(list) { children.push(...list); return this; },
    getChildren() { return children; },
    remove(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      return this;
    },
    setVisible() { return this; },
    destroy() { children.length = 0; },
  };
}

export function makeScene() {
  const delayed = [];
  const scene = {
    delayed,
    time: {
      delayedCall(ms, callback) {
        const item = { ms, callback, cancelled: false };
        delayed.push(item);
        return {
          remove() { item.cancelled = true; },
        };
      },
    },
    tweens: {
      add() { return { stop() {}, remove() {} }; },
      killTweensOf() {},
    },
    add: {
      group: makeGroup,
      sprite: () => makeGameObject(),
      image: () => makeGameObject(),
      text: () => makeGameObject(),
      rectangle: () => makeGameObject(),
      zone: () => makeGameObject(),
      container: () => makeGameObject({ add() { return this; } }),
    },
    textures: { exists: () => false },
    params: { gameSettings: {} },
    rapierWorld: null,
  };
  return scene;
}

function makeAnimController() {
  const raw = {
    startLeftArmSmash(callback) { callback?.(); },
    startBodySwing() {},
    stopArmSwing() {},
    startArmSwing() {},
    stopLegSwing() {},
    startLegSwing() {},
    switchBodyFrame() {},
    highJump() {},
    land() {},
    dig() {},
    getOut() {},
  };
  return {
    isInAnim: false,
    raw,
    updatePosition() {},
    setDepth() {},
    getHandAnchor() { return null; },
    highlight() {},
    twinkle() {},
    startLegSwing() {},
    stopLegSwing() {},
    startArmSwing() {},
    stopArmSwing() {},
    startArc(_from, _to, _duration, _height, _texture, done) { done?.(); },
    destroy() {},
    getTargets() { return []; },
  };
}

export function resetSim({
  rows = 5,
  cols = 9,
  seed = 20261117,
  dayOrNight = true,
} = {}) {
  for (const model of liveModels.splice(0)) model.disposeTickManager?.();
  resetWorld();
  resetSightTarget();
  resetTickManagerClock();
  PositionManager.Instance.setStageGrid(1, rows, cols);
  manager.Instance.seed = seed;
  manager.Instance.combatStatus.dayOrNight = dayOrNight;
  ProjectileCmd.reset();
  ResourceCmd.reset();
  MobCmd.reset(seed);
  PlantCmd.reset();
  ObstacleCmd.reset();
  SfxCmd.reset();
  return {
    rows,
    cols,
    seed,
    dayOrNight,
    frame: 0,
  };
}

export function spawnPlant(data, {
  level = 1,
  col = 0,
  row = 0,
  scene = makeScene(),
  initialize = true,
} = {}) {
  const model = data.clone();
  trackModel(model);
  const entity = new PlantEntity(scene, col, row, model, level);
  model.attachHost(entity);
  model.setTickOwnerId(`plant:${col}:${row}:${model.pid}`);
  if (initialize) entity.initializeEntity();
  return { model, entity, scene };
}

/** 通过真实 preset createEntity 创建，便于验证替换基座等 Entity 侧入口。 */
export function spawnPlantViaData(data, {
  level = 1,
  col = 0,
  row = 0,
  scene = makeScene(),
} = {}) {
  const model = data.clone();
  trackModel(model);
  const entity = model.createEntity(scene, col, row, level);
  // 真实 createEntity 可能使用 preset 单例作为 entity.model（例如 ATDispenser），
  // 也要纳入 resetSim 的清理范围，避免跨测试继续 tick。
  if (entity?.model && entity.model !== model) trackModel(entity.model);
  return { model: entity.model, entity, scene };
}

function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function spawnMob(data, {
  col = 8,
  row = 2,
  waveID = 1,
  scene = makeScene(),
  initialize = true,
  sightTarget = false,
} = {}) {
  const model = data.clone();
  trackModel(model);
  const entity = new MonsterEntity(scene, col, row, model, waveID);
  entity.model = model;
  entity.animController = makeAnimController();
  entity.attacking = null;
  entity.attackTimer = null;
  entity.recoverTimer = null;
  entity.attackedPlants = [];
  entity.preAttackedPlant = null;
  entity.offsetX = 0;
  entity.offsetY = 0;
  entity.destroyed = false;
  entity.moveCalls = [];
  entity.viewCalls = [];
  entity.attachSprites = new Map();
  entity.rigidBody = { setTranslation() {}, linvel: () => ({ x: 0, y: 0 }) };
  entity.random = makeRandom(20261117 + waveID * 31 + row);
  entity.sightTarget = sightTarget;
  entity.hasSightTarget = () => entity.sightTarget;
  entity.getRandom = () => entity.random;
  entity.randomInt = (max) => Math.floor(entity.random() * max);
  entity.shuffleRandom = (items) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(entity.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  };
  entity.getLegacyController = () => ({ raw: entity.animController.raw });
  entity.startMove = () => { entity.moveCalls.push("start"); };
  entity.stopMove = () => { entity.moveCalls.push("stop"); };
  entity.startAttacking = (target) => model.tryStartAttack(entity, target);
  entity.stopAttacking = () => model.stopAttacking(entity);
  entity.hurtTarget = () => model.hurtTarget(entity);
  entity.takeDamage = (amount, dealer, source) => model.takeDamage(entity, amount, dealer, source);
  entity.destroySelf = () => { entity.destroyed = true; };
  entity.destroy = () => { entity.destroyed = true; };
  entity.setVelocityX = (value) => { entity.velocityX = value; };
  entity.playDeathAnimation = () => { entity.viewCalls.push("death"); };
  entity.startStarShardsOrbitEffect = () => { entity.viewCalls.push("starOrbit"); };
  entity.playSummonEffects = () => { entity.viewCalls.push("summonEffects"); };
  entity.playSceneFlash = () => { entity.viewCalls.push("sceneFlash"); };
  entity.playArc = () => { entity.viewCalls.push("arc"); };
  entity.playCharge = (startCol, targetCol, targetRow, done) => {
    entity.col = targetCol;
    entity.row = targetRow;
    entity.viewCalls.push("charge");
    done?.();
  };
  entity.startArcReposition = (newCol, newRow, done) => {
    entity.col = newCol;
    entity.row = newRow;
    entity.viewCalls.push("arcReposition");
    done?.();
  };
  entity.notifySpawnHooks = () => { entity.viewCalls.push("spawnHooks"); };
  entity.notifyHalfHealthHooks = () => { entity.viewCalls.push("halfHealthHooks"); };
  entity.playSkillSfx = (kind) => { entity.viewCalls.push(`skill:${kind}`); };
  entity.playObsidianHighJump = () => { entity.viewCalls.push("obsidianHighJump"); };
  entity.playWardenHighJump = () => { entity.viewCalls.push("wardenHighJump"); };
  entity.playWardenLand = () => { entity.viewCalls.push("wardenLand"); };
  entity.playWardenDig = () => { entity.viewCalls.push("wardenDig"); };
  entity.onWardenLand = () => model.onWardenLand(entity);
  let golemPendingDone = null;
  entity.onGolemBegin = () => { entity.viewCalls.push("golemBegin"); };
  entity.onGolemArmStop = () => { entity.viewCalls.push("golemArmStop"); };
  entity.repositionGolem = (done) => {
    golemPendingDone = done;
    if (typeof model.beginReposition === "function") model.beginReposition(entity, done);
    else done?.();
  };
  entity.applyObsidianReposition = (newRow) => {
    entity.row = newRow;
    entity.viewCalls.push("obsidianReposition");
    const done = golemPendingDone;
    golemPendingDone = null;
    done?.();
  };
  entity.applyWardenReposition = (newRow, newCol) => {
    entity.row = newRow;
    entity.col = newCol;
    entity.viewCalls.push("wardenReposition");
    const done = golemPendingDone;
    golemPendingDone = null;
    done?.();
  };
  entity.getGolemCallBase = () => (model.mid === 13 ? 40 : 38);
  entity.getGolemCastDelay = () => (model.mid === 13 ? 4000 : 7000);
  entity.getGolemRecoverDelay = () => (model.mid === 13 ? 3000 : 2000);
  entity.attachWeaponView = (def) => { entity.viewCalls.push(`weapon:${def.key}`); };
  entity.attachShieldView = (def) => { entity.viewCalls.push(`shield:${def.key}`); };
  entity.attachHelmetView = (def) => { entity.viewCalls.push(`helmet:${def.key}`); };
  entity.syncWeaponView = () => {};
  entity.syncShieldView = () => {};
  entity.syncHelmetView = () => {};
  entity.syncViewFromModel = () => { entity.viewCalls.push("syncView"); };
  entity.registerHandAttachment = () => {};
  entity.registerEquipmentAttachment = () => {};

  attachModelAccessors(entity, model);
  model.attachHost(entity);
  model.setTickOwnerId(`mob:${col}:${row}:${model.mid}`);
  if (initialize) model.onCreate(entity);
  return { model, entity, scene };
}

export function makePlantTarget({
  col = 0,
  row = 2,
  hp = 300,
  pid = 1,
  scene = makeScene(),
  sleeping = false,
} = {}) {
  const model = {
    pid,
    level: 1,
    health: hp,
    healthMax: hp,
    maxHealth: { getValueAt: () => hp },
    isSleeping: sleeping,
    shieldHealth: 0,
    onSleepStateChange() {},
    onDeath() {},
  };
  const entity = new PlantEntity(scene, col, row, model, 1);
  entity.model = model;
  entity.takeDamage = (amount) => {
    model.health = Math.max(0, model.health - amount);
    if (model.health <= 0) entity.destroyed = true;
  };
  entity.setSleeping = (value) => { model.isSleeping = value; };
  return entity;
}

export function tick(sim, ms = FRAME_MS) {
  const frames = Math.max(1, Math.round(ms / FRAME_MS));
  for (let i = 0; i < frames; i++) {
    sim.frame += 1;
    updateAllTickManagers(sim.frame, FRAME_MS);
    flushDeferred();
  }
  return sim.frame;
}

export function tickFrames(sim, frames) {
  return tick(sim, frames * FRAME_MS);
}

export function tickUntil(sim, predicate, maxMs = 60000) {
  const maxFrames = Math.ceil(maxMs / FRAME_MS);
  for (let i = 0; i < maxFrames; i++) {
    tick(sim, FRAME_MS);
    if (predicate()) return true;
  }
  return false;
}

export function setSightTarget(value) {
  setSightTargetProvider(() => value);
}

export function setSightTargetFn(fn) {
  setSightTargetProvider(fn);
}

export {
  manager,
  PlantCmd,
  ProjectileCmd,
  ResourceCmd,
  MobCmd,
  ObstacleCmd,
  SfxCmd,
  getPlantsMap,
  getObstaclesMap,
  getResourceState,
  setGridType,
  flushDeferred,
  PositionManager,
};
