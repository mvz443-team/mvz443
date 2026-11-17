/**
 * 所有 Manager 的共享替身。
 *
 * 真实项目里这些 Manager 依赖 Phaser 场景与单例生命周期；测试只关心
 * Model 读取/写入的世界数据，所以这里提供同名的 Instance 与最小状态。
 */

const deferredQueue = [];

const plantsMap = new Map();
const mobsByLane = new Map();
const obstaclesMap = new Map();
const gridTypes = new Map();
const resourceState = { energy: 0, starShards: 0, energyCalls: [], starCalls: [] };

const sharedInstance = {
  seed: 20261117,
  combatStatus: { dayOrNight: true },
  PlantsMap: plantsMap,
  MobsByLane: mobsByLane,
  Mobs: [],
  ObstaclesMap: obstaclesMap,
  energy: 0,
  starShards: 0,

  EndGame() {},
  Pause() {},
  Resume() {},
  UpdateEnergy(amount) {
    resourceState.energy += amount;
    resourceState.energyCalls.push(amount);
  },
  UpdateStarShards(amount) {
    resourceState.starShards += amount;
    resourceState.starCalls.push(amount);
  },
  GetGridProperty(col, row) {
    const type = gridTypes.get(`${col}-${row}`) ?? "ground";
    return {
      type,
      isWater: type === "water",
      isSky: type === "sky",
      isGround: type === "ground",
    };
  },
  HasObstacle(col, row) {
    return obstaclesMap.has(`${col}-${row}`);
  },
  RegisterObstacle(obstacle) {
    if (obstacle?.col !== undefined && obstacle?.row !== undefined) {
      obstaclesMap.set(`${obstacle.col}-${obstacle.row}`, obstacle);
    }
  },
  RegisterObstacleLaneAlias() {},
  UnregisterObstacleLaneAlias() {},
  RegisterDestroy() {},
  RegisterPlant(plant) {
    if (plant?.col === undefined || plant?.row === undefined) return;
    const key = `${plant.col}-${plant.row}`;
    const list = plantsMap.get(key) ?? [];
    if (!list.includes(plant)) list.push(plant);
    plantsMap.set(key, list);
  },
  UnregisterPlant() {},
  RegisterMonster(monster) {
    sharedInstance.Mobs.push(monster);
  },
};

export const DeferredManager = {
  Instance: {
    defer(fn) { deferredQueue.push(fn); },
  },
};

export function flushDeferred() {
  while (deferredQueue.length > 0) deferredQueue.shift()();
}

export function resetWorld() {
  deferredQueue.length = 0;
  plantsMap.clear();
  mobsByLane.clear();
  obstaclesMap.clear();
  gridTypes.clear();
  resourceState.energy = 0;
  resourceState.starShards = 0;
  resourceState.energyCalls.length = 0;
  resourceState.starCalls.length = 0;
  sharedInstance.seed = 20261117;
  sharedInstance.combatStatus.dayOrNight = true;
  sharedInstance.Mobs.length = 0;
}

export function getResourceState() {
  return resourceState;
}

export function setGridType(col, row, type) {
  gridTypes.set(`${col}-${row}`, type);
}

export function getPlantsMap() {
  return plantsMap;
}

export function getMobsByLane() {
  return mobsByLane;
}

export function getObstaclesMap() {
  return obstaclesMap;
}

export class FrameTimer {}
export class GridProperty {}
export class PlayerIdentify {}
export const ProgressMode = {};
export const ProgressUpdateEvent = {};
export const StageDataRecords = {};

export const MonsterLibrary = {
  Models: new Map(),
  GetModel() { return undefined; },
  Initialize() {},
};
export const PlantLibrary = { Models: new Map(), GetModel() { return undefined; } };
export const ObstacleLibrary = { Models: new Map(), GetModel() { return undefined; } };

const manager = { Instance: sharedInstance };

export default manager;
