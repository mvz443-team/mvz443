import assert from 'node:assert/strict';
import test from 'node:test';

const { Faction } = await import('../../models/Enum.ts');
const { SIMULATION_STATE_VERSION, hashSimulationState } = await import('../SimulationState.ts');
const { snapshotModel, restoreModel, cloneLogicModel } = await import('./LogicModel.ts');
const { getLogicHandle } = await import('./LogicState.ts');
const { isHostile } = await import('./FactionRelations.ts');
const { DispenserData } = await import('../../presets/plant/chapter1/dispenser.ts');
const { BalloonTntCloneData } = await import('../../presets/monster/summon/balloon_tnt_clone.ts');

function stateWithFaction(faction) {
  return {
    version: SIMULATION_STATE_VERSION,
    seed: 1,
    frameId: 1,
    values: {},
    localValues: {},
    timers: {},
    prngs: [],
    entities: [{
      kind: 'monster', id: 'entity_1', col: 0, row: 0, x: 0, y: 0,
      hp: 100, maxHp: 100, speed: 0,
      flags: { model: { faction } },
      timers: [],
      extra: {},
    }],
    physics: null,
  };
}

test('植物与怪物 faction 都进入 Model 快照，restoreModel 可恢复', () => {
  const plant = DispenserData.clone();
  const mob = BalloonTntCloneData.clone();

  assert.equal(snapshotModel(plant).faction, Faction.PLANT);
  assert.equal(snapshotModel(mob).faction, Faction.PLANT); // 星碎分身永久魅惑到植物方

  plant.faction = Faction.PLAYER2;
  const savedPlant = snapshotModel(plant);
  const restoredPlant = DispenserData.clone();
  restoreModel(restoredPlant, savedPlant);
  assert.equal(restoredPlant.faction, Faction.PLAYER2);
  assert.equal(DispenserData.faction, Faction.PLANT, '模板不能被实例写入污染');

  mob.faction = Faction.NEUTRAL;
  const restoredMob = BalloonTntCloneData.clone();
  restoreModel(restoredMob, snapshotModel(mob));
  assert.equal(restoredMob.faction, Faction.NEUTRAL);
  assert.equal(BalloonTntCloneData.faction, Faction.PLANT);
});

test('faction 按帧回滚，且 clone 之间不串线', () => {
  const a = BalloonTntCloneData.clone();
  const b = BalloonTntCloneData.clone();
  const handle = getLogicHandle(a);

  handle.setFrame(1);
  a.faction = Faction.PLAYER1;
  handle.setFrame(2);
  a.faction = Faction.PLAYER2;

  assert.equal(b.faction, Faction.PLANT, '另一个 clone 不受影响');

  handle.rollbackTo(1);
  assert.equal(a.faction, Faction.PLAYER1);
  handle.rollbackTo(0);
  assert.equal(a.faction, Faction.PLANT, '回到初始帧恢复 definition 注入的 PLANT');
});

test('cloneLogicModel 保留 faction，且不再依赖非快照 definition getter', () => {
  const clone = cloneLogicModel(BalloonTntCloneData);
  assert.equal(clone.faction, Faction.PLANT);
  assert.equal(Object.prototype.hasOwnProperty.call(clone, 'faction'), true);
  assert.equal('faction' in snapshotModel(clone), true);
});

test('faction 进入跨端哈希；不同阵营必然分叉', () => {
  const a = hashSimulationState(stateWithFaction(Faction.PLANT));
  const b = hashSimulationState(stateWithFaction(Faction.ZOMBIE));
  const again = hashSimulationState(stateWithFaction(Faction.PLANT));

  assert.notEqual(a.h32, b.h32);
  assert.notEqual(a.h64, b.h64);
  assert.deepEqual(a, again, '相同阵营两次采样哈希一致');
});

test('恢复快照后敌对判定同步改变，回滚后战斗关系一致', () => {
  const mob = BalloonTntCloneData.clone();
  assert.equal(isHostile(mob, Faction.PLANT), false);

  mob.faction = Faction.ZOMBIE;
  const snapshot = snapshotModel(mob);
  restoreModel(mob, snapshot);
  assert.equal(isHostile(mob, Faction.PLANT), true, '恢复后立刻按新阵营判定敌对');

  mob.faction = Faction.PLAYER1;
  assert.equal(isHostile(mob, Faction.PLANT), true);
  assert.equal(isHostile(mob, Faction.PLAYER2), true);
  assert.equal(isHostile(mob, Faction.PLAYER1), false);
});
