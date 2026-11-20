import assert from "node:assert/strict";
import test from "node:test";

const { SpawnSequence, mobSnapshotId } = await import("./MobSpawnIdentity.ts");

test("出怪序号单调递增，capture/restore 可精确回滚", () => {
  const seq = new SpawnSequence();
  assert.equal(seq.capture(), 0);
  assert.equal(seq.allocate(), 1);
  assert.equal(seq.allocate(), 2);

  const saved = seq.capture();
  assert.equal(saved, 2);
  assert.equal(seq.allocate(), 3);

  seq.restore(saved);
  assert.equal(seq.allocate(), 3, "回滚后重新分配必须得到同一序号");

  seq.reset();
  assert.equal(seq.capture(), 0);
  assert.equal(seq.allocate(), 1);
});

test("非法快照值回退到 0，避免 NaN 污染后续 id", () => {
  const seq = new SpawnSequence();
  seq.allocate();
  seq.restore(undefined);
  assert.equal(seq.capture(), 0);
  seq.restore(Number.NaN);
  assert.equal(seq.capture(), 0);
  seq.restore("7");
  assert.equal(seq.capture(), 7);
});

test("两端用同一快照恢复后生成完全相同的实体 id", () => {
  const source = new SpawnSequence();
  source.allocate();
  source.allocate();

  const restored = new SpawnSequence();
  restored.restore(source.capture());

  const sourceIds = [mobSnapshotId(3, source.allocate()), mobSnapshotId(-10, source.allocate())];
  const restoredIds = [mobSnapshotId(3, restored.allocate()), mobSnapshotId(-10, restored.allocate())];

  assert.deepEqual(sourceIds, restoredIds);
  assert.deepEqual(sourceIds, ["mob:3:3", "mob:-10:4"]);
});

test("波次怪与召唤物用负波次隔离，稳定 key 不冲突", () => {
  assert.equal(mobSnapshotId(3, 4), "mob:3:4");
  assert.equal(mobSnapshotId(-10, 4), "mob:-10:4");
  assert.notEqual(mobSnapshotId(3, 4), mobSnapshotId(-10, 4));
});
