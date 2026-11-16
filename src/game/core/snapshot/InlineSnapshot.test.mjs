import assert from 'node:assert/strict';
import test from 'node:test';

const { createInlineSnapshot, estimateInlineSnapshotBytes, buildInlineSnapshotOrHash, restoreInlineSnapshot } =
  await import('./InlineSnapshot.ts');

const state = {
  version: 1,
  seed: 1,
  frameId: 2,
  values: { a: 1 },
  timers: {},
  prngs: [],
  entities: [],
  physics: 'ignored-inline',
};

test('inline 快照不包含 Rapier physics 字段', () => {
  const snapshot = createInlineSnapshot(state, 'abc');
  assert.equal(snapshot.hash, 'abc');
  assert.equal(JSON.stringify(snapshot).includes('physics'), false);
});

test('超过阈值时只保留 hash，避免膨胀 WS 包', () => {
  const big = {
    ...state,
    values: { text: 'x'.repeat(8000) },
  };
  assert.ok(estimateInlineSnapshotBytes(createInlineSnapshot(big, 'abc')) > 6000);
  assert.deepEqual(buildInlineSnapshotOrHash(big, 'abc'), { hash: 'abc', snapshot: null });
});

test('inline 快照可还原为不含 physics 的 SimulationState', () => {
  const snapshot = createInlineSnapshot(state, 'abc');
  const restored = restoreInlineSnapshot(snapshot);
  assert.equal(restored.version, 1);
  assert.equal(restored.seed, 1);
  assert.equal(restored.frameId, 2);
  assert.deepEqual(restored.values, { a: 1 });
  assert.equal(restored.physics, null);
});
