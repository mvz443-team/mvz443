import assert from 'node:assert/strict';
import test from 'node:test';

const { Faction } = await import('../../models/Enum.ts');
const { SIMULATION_STATE_VERSION, hashSimulationState } = await import('../SimulationState.ts');
const { snapshotModel, restoreModel, cloneLogicModel } = await import('./LogicModel.ts');
const { getLogicHandle } = await import('./LogicState.ts');
const { isHostile } = await import('./FactionRelations.ts');
const { DispenserData } = await import('../../presets/plant/chapter1/dispenser.ts');
const { BalloonTntCloneData } = await import('../../presets/monster/summon/balloon_tnt_clone.ts');

function stateWithFaction(faction, charmedBy = null, charmUntilFrame = 0) {
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
      flags: { model: { faction, charmedBy, charmUntilFrame } },
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

test('charmedBy 进快照并随回滚恢复，有效阵营由它覆盖', () => {
  const mob = BalloonTntCloneData.clone();
  const plant = DispenserData.clone();

  assert.equal(snapshotModel(mob).charmedBy, null);
  mob.setCharm(Faction.PLAYER2);
  plant.setCharm(Faction.ZOMBIE);
  assert.equal(snapshotModel(mob).charmedBy, Faction.PLAYER2);
  assert.equal(snapshotModel(plant).charmedBy, Faction.ZOMBIE);
  assert.equal(isHostile(mob, Faction.PLAYER2), false, '魅惑后与覆盖阵营同属一方');
  assert.equal(isHostile(mob, Faction.PLANT), true);

  const saved = snapshotModel(mob);
  const restored = BalloonTntCloneData.clone();
  restoreModel(restored, saved);
  assert.equal(restored.charmedBy, Faction.PLAYER2);
  assert.equal(isHostile(restored, Faction.PLAYER2), false);

  const handle = getLogicHandle(mob);
  handle.setFrame(1);
  mob.setCharm(Faction.NEUTRAL);
  handle.rollbackTo(0);
  assert.equal(mob.charmedBy, Faction.PLAYER2);
  plant.setCharm(null);
  assert.equal(snapshotModel(plant).charmedBy, null);
});

test('魅惑持续时间是绝对帧字段，进快照并随回滚恢复', () => {
  const mob = BalloonTntCloneData.clone();
  const handle = getLogicHandle(mob);
  handle.setFrame(10);
  mob.tickmanager.setFrame(10);

  mob.setCharm(Faction.PLAYER2, 1000);
  const until = mob.charmUntilFrame;
  assert.equal(until, 10 + Math.ceil(1000 / mob.tickmanager.frameInterval));
  assert.equal(snapshotModel(mob).charmUntilFrame, until);
  assert.equal(mob.getCharmLeftMs(), 1000);
  assert.equal(
    mob.tickmanager.capture().filter((timer) => timer.kind === 'CharmExpired').length,
    1,
    '任何时刻只有一条魅惑到期 timer',
  );

  // 重复施加只保留最新一条 timer，到期帧更新为较短的那个。
  mob.setCharm(Faction.PLAYER2, 500);
  const savedUntil = mob.charmUntilFrame;
  assert.equal(savedUntil, 10 + Math.ceil(500 / mob.tickmanager.frameInterval));
  assert.equal(
    mob.tickmanager.capture().filter((timer) => timer.kind === 'CharmExpired').length,
    1,
  );

  const saved = snapshotModel(mob);
  const restored = BalloonTntCloneData.clone();
  restoreModel(restored, saved);
  assert.equal(restored.charmUntilFrame, mob.charmUntilFrame);
  assert.equal(restored.charmedBy, Faction.PLAYER2);

  handle.setFrame(11);
  mob.tickmanager.setFrame(11);
  mob.setCharm(Faction.NEUTRAL, 300);
  handle.rollbackTo(10);
  assert.equal(mob.charmedBy, Faction.PLAYER2);
  assert.equal(mob.charmUntilFrame, savedUntil);

  // 解除魅惑必须同时清掉到期帧与 timer。
  mob.setCharm(null);
  assert.equal(mob.charmUntilFrame, 0);
  assert.equal(
    mob.tickmanager.capture().filter((timer) => timer.kind === 'CharmExpired').length,
    0,
  );
});

test('faction 进入跨端哈希；不同阵营必然分叉', () => {
  const a = hashSimulationState(stateWithFaction(Faction.PLANT));
  const b = hashSimulationState(stateWithFaction(Faction.ZOMBIE));
  const again = hashSimulationState(stateWithFaction(Faction.PLANT));

  assert.notEqual(a.h32, b.h32);
  assert.notEqual(a.h64, b.h64);
  assert.deepEqual(a, again, '相同阵营两次采样哈希一致');

  const charmed = hashSimulationState(stateWithFaction(Faction.PLANT, Faction.ZOMBIE));
  assert.notEqual(charmed.h32, a.h32, '魅惑覆盖必须改变跨端哈希');
  assert.equal(charmed.h64.length, 16);

  const timed = hashSimulationState(stateWithFaction(Faction.PLANT, Faction.ZOMBIE, 42));
  assert.notEqual(timed.h32, charmed.h32, '魅惑到期帧必须改变跨端哈希');
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
