import assert from 'node:assert/strict';
import test from 'node:test';

const { LogicModel, attachModelAccessors, snapshotModel, restoreModel } = await import('./LogicModel.ts');
const { getLogicHandle } = await import('./LogicState.ts');

class ExplosionModel extends LogicModel {
  texture = 'bullet/snowball';
  explodeDamage = 20;
  penetrated = 0;
  destroyed = 0;

  onModelDestroy() {
    this.destroyed += 1;
  }
}

test('Model 的普通字段自动进入快照，配置对象不进入', () => {
  const model = new ExplosionModel();
  assert.equal(model.explodeDamage, 20);
  assert.deepEqual(snapshotModel(model), {
    health: 0,
    healthMax: 0,
    explodeDamage: 20,
    penetrated: 0,
    destroyed: 0,
    texture: 'bullet/snowball',
  });
});

test('字段写入无需 reg，回滚按帧还原', () => {
  const model = new ExplosionModel();
  const handle = getLogicHandle(model);

  handle.setFrame(1);
  model.explodeDamage = 35;
  model.penetrated = 2;
  handle.setFrame(2);
  model.explodeDamage = 0;

  handle.rollbackTo(1);
  assert.equal(model.explodeDamage, 35);
  assert.equal(model.penetrated, 2);
});

test('Entity 字段访问器只是视图，实际存储与回滚都在 Model', () => {
  const model = new ExplosionModel();
  const entity = {};
  attachModelAccessors(entity, model);

  const handle = getLogicHandle(model);
  handle.setFrame(4);
  entity.explodeDamage = 60;
  assert.equal(model.explodeDamage, 60);

  handle.rollbackTo(3);
  assert.equal(entity.explodeDamage, 20);
});

test('快照恢复只覆盖运行时字段，Model 配置保持不变', () => {
  const model = new ExplosionModel();
  model.explodeDamage = 100;
  const snapshot = snapshotModel(model);

  const restored = new ExplosionModel();
  restoreModel(restored, snapshot);
  assert.equal(restored.explodeDamage, 100);
  assert.equal(restored.texture, 'bullet/snowball');
});

test('每个实体拿到独立 Model，爆炸逻辑由 Model 自己触发', () => {
  const template = new ExplosionModel();
  const clone = template.clone();
  clone.explodeDamage = 99;
  assert.equal(template.explodeDamage, 20);

  const calls = [];
  clone.onModelDestroy({ id: 'projectile:1' }, calls);
  assert.equal(clone.destroyed, 1);
});

test('配置函数不进入快照，clone 后仍可读取', () => {
  class PresetModel extends LogicModel {
    get weight() {
      return this.getConfigValue('weight');
    }

    constructor() {
      super();
      this.setConfigValue('weight', (waveID) => waveID * 2);
      this.level = 1;
    }
  }

  const template = new PresetModel();
  assert.equal(template.weight(3), 6);
  assert.equal(snapshotModel(template).weight, undefined);

  const clone = template.clone();
  assert.equal(clone.weight(3), 6);
  clone.level = 2;
  assert.equal(template.level, 1);
});

test('attachModelAccessors 只装访问器，不在 Entity 上复制 Model 状态', () => {
  const model = new ExplosionModel();
  const entity = {};
  attachModelAccessors(entity, model);

  const descriptor = Object.getOwnPropertyDescriptor(entity, 'explodeDamage');
  assert.equal(typeof descriptor.get, 'function');
  assert.equal(typeof descriptor.set, 'function');
  assert.equal(descriptor.value, undefined);
  entity.explodeDamage = 80;
  assert.equal(model.explodeDamage, 80);
  assert.equal(Object.getOwnPropertyDescriptor(entity, 'explodeDamage').value, undefined);
});
