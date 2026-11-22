import assert from 'node:assert/strict';
import test from 'node:test';

const { Faction } = await import('../../models/Enum.ts');
const { isFaction, effectiveFaction, isHostile } = await import('./FactionRelations.ts');

test('isFaction 只接受已定义阵营，PvP 预留值也算合法', () => {
  for (const value of [
    Faction.PLANT, Faction.ZOMBIE, Faction.NEUTRAL, Faction.PLAYER1, Faction.PLAYER2,
  ]) {
    assert.equal(isFaction(value), true);
  }
  for (const value of [0, 6, -1, null, undefined, 'PLANT', {}]) {
    assert.equal(isFaction(value), false);
  }
});

test('PvE 敌对口径：PLANT 与 ZOMBIE 互为敌人，同阵营不互殴', () => {
  assert.equal(isHostile(Faction.PLANT, Faction.ZOMBIE), true);
  assert.equal(isHostile(Faction.ZOMBIE, Faction.PLANT), true);
  assert.equal(isHostile(Faction.PLANT, Faction.PLANT), false);
  assert.equal(isHostile(Faction.ZOMBIE, Faction.ZOMBIE), false);
});

test('PvP 口径：双方种植者互为敌人，且都与 NEUTRAL 公共出怪互为敌人', () => {
  assert.equal(isHostile(Faction.PLAYER1, Faction.PLAYER2), true);
  assert.equal(isHostile(Faction.PLAYER1, Faction.NEUTRAL), true);
  assert.equal(isHostile(Faction.PLAYER2, Faction.NEUTRAL), true);
  assert.equal(isHostile(Faction.NEUTRAL, Faction.NEUTRAL), false);
  assert.equal(isHostile(Faction.PLAYER1, Faction.PLAYER1), false);
});

test('实体与 Model 等价：Entity 访问器和 Model 字段走同一入口', () => {
  const entity = { faction: Faction.ZOMBIE };
  const model = { faction: Faction.PLANT };
  const entityWithModel = { model };

  assert.equal(effectiveFaction(entity), Faction.ZOMBIE);
  assert.equal(effectiveFaction(model), Faction.PLANT);
  assert.equal(effectiveFaction(entityWithModel), Faction.PLANT);
  assert.equal(isHostile(entity, model), true);
});

test('charmedBy 临时覆盖原始阵营（为未来魅惑预留，字段必须进 Model 快照）', () => {
  const charmed = { faction: Faction.ZOMBIE, charmedBy: Faction.PLANT };
  assert.equal(effectiveFaction(charmed), Faction.PLANT);
  // 已被植物方魅惑：不再被植物攻击，但仍会被僵尸攻击。
  assert.equal(isHostile(charmed, Faction.PLANT), false);
  assert.equal(isHostile(charmed, Faction.ZOMBIE), true);
});

test('阵营缺失或脏数据一律按非敌对处理，避免重建期误伤', () => {
  assert.equal(effectiveFaction(null), null);
  assert.equal(effectiveFaction({}), null);
  assert.equal(effectiveFaction({ faction: 999 }), null);
  assert.equal(isHostile({}, Faction.PLANT), false);
  assert.equal(isHostile(Faction.PLANT, {}), false);
});
