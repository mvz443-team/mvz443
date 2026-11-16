import assert from 'node:assert/strict';
import test from 'node:test';

const {
  RegisterSchema,
  bindRegistersToEntity,
} = await import('./LogicRegister.ts');

function makeSchema() {
  return new RegisterSchema([
    { name: 'hp', type: 'f64', default: 100 },
    { name: 'speed', type: 'f64', default: 2 },
    { name: 'level', type: 'i32', default: 1 },
    { name: 'isFrozen', type: 'bool', default: false },
    { name: 'tag', type: 'str', default: '' },
  ]);
}

test('schema 指纹稳定，重复寄存器名会被拒绝', () => {
  const a = makeSchema();
  const b = makeSchema();
  assert.equal(a.fingerprint, b.fingerprint);
  assert.throws(() => new RegisterSchema([
    { name: 'hp', type: 'f64', default: 0 },
    { name: 'hp', type: 'f64', default: 1 },
  ]), /重复声明/);
});

test('寄存器按声明顺序序列化，恢复可完整还原', () => {
  const bank = makeSchema().createBank();
  bank.set('hp', 42.5);
  bank.set('speed', 3);
  bank.set('level', 4);
  bank.set('isFrozen', true);
  bank.set('tag', 'zombie');

  const captured = bank.capture();
  assert.deepEqual(captured, [42.5, 3, 4, true, 'zombie']);

  const restored = makeSchema().createBank();
  assert.equal(restored.restore(captured), true);
  assert.deepEqual(restored.capture(), captured);
});

test('类型按声明强制转换，长度不匹配时拒绝恢复', () => {
  const bank = makeSchema().createBank();
  bank.set('level', 3.9);
  bank.set('isFrozen', 1);
  assert.equal(bank.get('level'), 3);
  assert.equal(bank.get('isFrozen'), true);
  assert.equal(bank.restore([1, 2]), false);
});

test('绑定后 existing 字段迁移进寄存器，读写双向一致', () => {
  const bank = makeSchema().createBank();
  const entity = { hp: 77, speed: 9, level: 2, isFrozen: true, tag: 'plant' };

  bindRegistersToEntity(entity, bank);

  assert.deepEqual(bank.capture(), [77, 9, 2, true, 'plant']);

  entity.hp = 12;
  entity.isFrozen = false;
  assert.equal(bank.get('hp'), 12);
  assert.equal(bank.get('isFrozen'), false);

  bank.set('speed', 5);
  assert.equal(entity.speed, 5);
});

test('寄存器按数组序列化，比对象字段更紧凑', () => {
  const schema = new RegisterSchema(
    Array.from({ length: 20 }, (_, index) => ({
      name: `field${index}`,
      type: 'f64',
      default: index,
    })),
  );
  const bank = schema.createBank();
  const arrayJson = JSON.stringify(bank.capture());
  const objectJson = JSON.stringify(bank.toObject());
  assert.ok(arrayJson.length < objectJson.length, `array=${arrayJson.length} object=${objectJson.length}`);
  assert.ok(!arrayJson.includes('field'), '数组序列化不应携带字段名');
});

test('绑定后新增的逻辑值不会退回对象字段存储', () => {
  const bank = makeSchema().createBank();
  const entity = { hp: 1, speed: 1, level: 1, isFrozen: false, tag: '' };
  bindRegistersToEntity(entity, bank);

  // 访问器已在实例上，直接赋值只改寄存器数组
  entity.hp = 500;
  assert.equal(bank.capture()[0], 500);
  assert.equal(Object.getOwnPropertyDescriptor(entity, 'hp').get !== undefined, true);
});
