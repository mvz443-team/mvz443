import assert from 'node:assert/strict';
import test from 'node:test';

const {
  createEntityRandom,
  copyRandomState,
  restoreRandomState,
  reseedEntityRandom,
  createAleaWithState,
} = await import('./DeterministicRandom.ts');

const consume = (random, count) => Array.from({ length: count }, () => random());

test('实体随机流由 worldSeed / 用途 / 稳定身份唯一决定', () => {
  const first = createEntityRandom(2026, 'tnt_mines', 'plant:1:2:4:0');
  const same = createEntityRandom(2026, 'tnt_mines', 'plant:1:2:4:0');
  const otherIdentity = createEntityRandom(2026, 'tnt_mines', 'plant:1:3:4:0');
  const otherPurpose = createEntityRandom(2026, 'tnt', 'plant:1:2:4:0');
  const otherWorld = createEntityRandom(2027, 'tnt_mines', 'plant:1:2:4:0');

  assert.deepEqual(consume(first, 8), consume(same, 8));
  assert.notDeepEqual(consume(first, 8), consume(otherIdentity, 8));
  assert.notDeepEqual(consume(first, 8), consume(otherPurpose, 8));
  assert.notDeepEqual(consume(first, 8), consume(otherWorld, 8));
});

test('PRNG 状态捕获后回滚，再继续步进与未回滚序列完全一致', () => {
  const random = createEntityRandom(2026, 'golem:19', 'mob:13:7');
  consume(random, 5);
  const snapshot = copyRandomState(random);
  const expected = consume(random, 10);

  restoreRandomState(random, snapshot);
  assert.deepEqual(consume(random, 10), expected);
});

test('reseed 原地重播种，保持 PRNG 对象引用供快照系统继续使用', () => {
  const random = createEntityRandom(2026, 'tnt', 'entity_1');
  const reference = random;
  const expected = createEntityRandom(2026, 'tnt', 'plant:1:2:5:0');

  reseedEntityRandom(random, 2026, 'tnt', 'plant:1:2:5:0');

  assert.equal(random, reference);
  assert.deepEqual(consume(random, 6), consume(expected, 6));
});

test('主随机流快照恢复：带状态重建必须与连续运行一致（重连 desync 回归）', () => {
  const seed = '22518025';
  const original = createAleaWithState(seed);
  consume(original, 137);
  const saved = original.state();
  const expected = consume(original, 8);

  const restored = createAleaWithState(seed, saved);
  assert.deepEqual(restored.state(), saved);
  assert.deepEqual(consume(restored, 8), expected);

  // seedrandom 的 alea .state() 是只读 getter：向它传状态会被静默忽略。
  // 旧实现正是这样做的，恢复后 PRNG 退化成按 seed 重新播种，必然分叉。
  const broken = createAleaWithState(seed);
  broken.state(saved);
  assert.notDeepEqual(broken.state(), saved);
  assert.equal(broken.state().c, 1);
});
