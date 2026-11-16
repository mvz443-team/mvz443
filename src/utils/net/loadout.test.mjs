import assert from 'node:assert/strict';
import test from 'node:test';

const { canonicalizeLoadout, computeLoadoutHash } = await import('./loadout.ts');

const vector = {
  cards: [{ pid: 3, level: 1 }, { pid: 1, level: 2 }, { pid: 3, level: 9 }],
  level: 5,
  initialEnergy: 0,
  initialStarShards: 0,
  globalModifiers: [{ key: 'atk', value: 10 }],
};

test('loadout 规范化会按 pid 去重排序', () => {
  const canonical = canonicalizeLoadout(vector);
  assert.deepEqual(canonical.cards, [{ pid: 1, level: 2 }, { pid: 3, level: 1 }]);
});

test('loadout 哈希与 Go 服务端实现一致', () => {
  assert.equal(computeLoadoutHash(vector), 'a90a6c47');
});

test('输入顺序变化不影响 loadout 哈希，内容变化会改变哈希', () => {
  const shuffled = {
    ...vector,
    cards: [{ pid: 1, level: 2 }, { pid: 3, level: 1 }],
  };
  assert.equal(computeLoadoutHash(shuffled), computeLoadoutHash(vector));
  assert.notEqual(
    computeLoadoutHash({ ...vector, cards: [{ pid: 1, level: 3 }, { pid: 3, level: 1 }] }),
    computeLoadoutHash(vector),
  );
});
