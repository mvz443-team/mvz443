import assert from 'node:assert/strict';
import test from 'node:test';

const { DeterminismModel } = await import('./DeterminismModel.ts');

function runTo(model, frame) {
  while (model.frame < frame) model.step();
}

function simulate(frames, seed = 12345) {
  const model = new DeterminismModel(seed);
  model.install();
  runTo(model, frames);
  return model;
}

test('相同 seed 的连续运行哈希完全一致', () => {
  const a = simulate(260);
  const b = simulate(260);
  assert.equal(a.hash().h64, b.hash().h64);
  assert.equal(a.hash().h32, b.hash().h32);
});

test('多次 capture/restore 后继续推进的最终哈希与连续运行一致', () => {
  const model = simulate(260);
  const continuous = model.hash().h64;

  const snapshots = [60, 120, 180].map((frame) => {
    const m = simulate(frame);
    return { frame, json: m.snapshotJson() };
  });

  for (const snapshot of snapshots.reverse()) {
    const replay = simulate(260);
    replay.restoreJson(snapshot.json);
    runTo(replay, 260);
    assert.equal(replay.hash().h64, continuous, `从第 ${snapshot.frame} 帧恢复后哈希不一致`);
  }
});

test('弱网追帧：周期性回滚到较旧快照并重放，最终哈希一致', () => {
  const model = new DeterminismModel(999);
  model.install();
  let lastSnapshot = model.snapshotJson();

  for (let frame = 1; frame <= 240; frame++) {
    model.step();
    // 每 7 帧用 14 帧前的快照回滚一次，模拟抖动补帧
    if (frame % 7 === 0) {
      model.restoreJson(lastSnapshot);
      runTo(model, frame);
    }
    if (frame % 14 === 0) {
      lastSnapshot = model.snapshotJson();
    }
  }

  const continuous = simulate(240, 999);
  assert.equal(model.hash().h64, continuous.hash().h64);
});

test('断线冻结后从本地快照恢复，最终哈希一致', () => {
  const model = new DeterminismModel(4242);
  model.install();
  runTo(model, 100);
  const snapshot = model.snapshotJson();
  const frozenFrame = model.frame;

  // 模拟断线冻结：墙上时间流逝但逻辑帧不推进
  for (let i = 0; i < 500; i++) {
    // no-op
  }
  assert.equal(model.frame, frozenFrame);

  model.restoreJson(snapshot);
  runTo(model, 240);

  const continuous = simulate(240, 4242);
  assert.equal(model.hash().h64, continuous.hash().h64);
});

test('实体死亡后回滚可以重建，哈希与连续运行一致', () => {
  const model = new DeterminismModel(777);
  model.install();
  runTo(model, 60);
  const snapshot = model.snapshotJson();
  assert.ok(model.entities.has('mob:1'));

  model.castDamage('mob:1', 999);
  assert.ok(!model.entities.has('mob:1'), 'mob:1 应被击杀');

  model.restoreJson(snapshot);
  assert.ok(model.entities.has('mob:1'), '回滚必须重建已销毁实体');

  runTo(model, 240);
  assert.equal(model.hash().h64, simulate(240, 777).hash().h64);
});

test('植物/僵尸/星碎覆盖：各类型实体与 buff 状态均被建模并可恢复', () => {
  const model = simulate(130);

  for (const pid of [1, 2, 3, 4, 5]) {
    assert.ok([...model.entities.values()].some((e) => e.kind === 'plant' && e.pid === pid), `缺少植物 pid=${pid}`);
  }
  for (const mid of [1, 2, 3, 4, 5]) {
    assert.ok([...model.entities.values()].some((e) => e.kind === 'mob' && e.mid === mid), `缺少僵尸 mid=${mid}`);
  }

  const lightning = model.entities.get('plant:6:1:5');
  assert.equal(lightning?.isLightning, 5000);
  const shield = model.entities.get('plant:4:1:3');
  assert.equal(shield?.shield, 200);
  const brute = model.entities.get('plant:2:1:1');
  assert.equal(brute?.inBruteShoot, true);

  const snapshot = model.snapshotJson();
  const before = model.hash().h64;

  // 修改任意关键 buff / 护盾 / 资源都应改变哈希
  shield.shield = 100;
  assert.notEqual(model.hash().h64, before);

  model.restoreJson(snapshot);
  assert.equal(model.entities.get('plant:4:1:3').shield, 200);
  assert.equal(model.hash().h64, before);
});

test('冻结/减速等计时器状态可快照恢复', () => {
  const model = simulate(95);
  model.castFreeze('mob:2', 25);
  const frozen = model.entities.get('mob:2');
  const xBefore = frozen.x;

  model.step();
  assert.equal(frozen.x, xBefore, '冻结期间不应移动');

  const snapshot = model.snapshotJson();
  runTo(model, 130);
  assert.notEqual(model.entities.get('mob:2')?.x, xBefore);

  model.restoreJson(snapshot);
  assert.equal(model.entities.get('mob:2').x, xBefore);
  assert.ok(model.hasTimer('freeze:mob:2'), '冻结计时器必须恢复');
});
