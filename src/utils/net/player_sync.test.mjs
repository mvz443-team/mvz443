import assert from 'node:assert/strict';
import test from 'node:test';

// 加载进度同步纯逻辑：进度收敛、单调递增、全员完成判定、快照合并。
const {
  clampLoadProgress,
  advanceLoadProgress,
  allPlayersLoaded,
  normalizeSyncPlayers,
  mergeSyncPlayers,
} = await import('./player_sync.ts');

test('clampLoadProgress 把非法/越界值收敛到 0..100 整数', () => {
  assert.equal(clampLoadProgress(37.9), 37);
  assert.equal(clampLoadProgress(-5), 0);
  assert.equal(clampLoadProgress(120), 100);
  assert.equal(clampLoadProgress('42'), 42);
  assert.equal(clampLoadProgress('abc'), 0);
  assert.equal(clampLoadProgress(undefined), 0);
});

test('advanceLoadProgress 单调推进，乱序上报不回退', () => {
  assert.equal(advanceLoadProgress(60, 45), 60);
  assert.equal(advanceLoadProgress(60, 82), 82);
  assert.equal(advanceLoadProgress(100, 1), 100);
});

test('normalizeSyncPlayers 排序并按 progress 推导 loaded', () => {
  const normalized = normalizeSyncPlayers([
    { playerId: 102, progress: 100, name: 'B', loaded: false },
    { playerId: 101, progress: 55, name: 'A', loaded: false },
    { playerId: 103, progress: 999, name: 'C', loaded: false },
  ]);
  assert.deepEqual(normalized.map((entry) => entry.playerId), [101, 102, 103]);
  assert.deepEqual(normalized.map((entry) => entry.loaded), [false, true, true]);
  assert.equal(normalized[2].progress, 100);
});

test('allPlayersLoaded 要求至少一人且全员 100', () => {
  assert.equal(allPlayersLoaded([]), false);
  assert.equal(allPlayersLoaded([
    { playerId: 1, progress: 100, name: 'a', loaded: true },
    { playerId: 2, progress: 99, name: 'b', loaded: false },
  ]), false);
  assert.equal(allPlayersLoaded([
    { playerId: 1, progress: 100, name: 'a', loaded: true },
    { playerId: 2, progress: 100, name: 'b', loaded: true },
  ]), true);
});

test('mergeSyncPlayers 合并乱序 roomSync，进度与已就绪标记单调递增', () => {
  const previous = [
    { playerId: 1, progress: 80, name: 'a', loaded: false },
    { playerId: 2, progress: 100, name: 'b', loaded: true },
  ];
  const merged = mergeSyncPlayers(previous, [
    { playerId: 1, progress: 30, name: 'a', loaded: false },
    { playerId: 2, progress: 100, name: 'b', loaded: true },
  ]);
  assert.equal(merged[0].progress, 80);
  assert.equal(merged[1].loaded, true);
  assert.equal(previous[0].progress, 80, '不得修改输入快照');
});
