import assert from 'node:assert/strict';
import test from 'node:test';

const {
  EntityTickManager,
  updateAllTickManagers,
  resetTickManagerClock,
} = await import('./EntityTickManager.ts');
const { TickEventNameEnums } = await import('./TickEvents.ts');

test('公共 TickEventNameEnums 只保留框架级事件', () => {
  assert.deepEqual(
    Object.keys(TickEventNameEnums).sort(),
    ['LogicTick', 'TimerTriggered'],
  );
});

test('EntityTickManager.restore 精确恢复快照时的 nextTimerId', () => {
  const manager = new EntityTickManager({ handleTickEvent() {} });
  manager.setFrame(1);
  const first = manager.schedule('first', 100);
  assert.equal(first.id, 1);
  assert.equal(manager.getNextTimerId(), 2);

  const snapshot = manager.capture();
  const snapshotNextTimerId = manager.getNextTimerId();

  manager.setFrame(2);
  manager.schedule('discarded', 100);
  assert.equal(manager.getNextTimerId(), 3);

  manager.restore(snapshot, {
    frameId: 1,
    mode: 'in-place',
    nextTimerId: snapshotNextTimerId,
    report: { ok: true, restored: [], missing: [], errors: [] },
  });

  assert.equal(manager.getNextTimerId(), snapshotNextTimerId);
  assert.equal(manager.capture().length, 1);
  assert.equal(manager.schedule('replayed', 100).id, 2);

  manager.dispose();
});

test('中途创建的 manager 以当前逻辑帧为基准，不会立即触发定时器', () => {
  const fired = [];
  const before = new EntityTickManager({
    handleTickEvent(name) { fired.push(`before:${name}`); },
  });
  updateAllTickManagers(100, 50);

  const late = new EntityTickManager({
    handleTickEvent(name) { fired.push(`late:${name}`); },
  });
  assert.equal(late.currentFrame, 100);

  const handle = late.schedule('late-event', 1000);
  assert.equal(handle.targetFrame, 120);

  late.update();
  assert.deepEqual(fired, []);

  updateAllTickManagers(120, 50);
  assert.deepEqual(fired, ['late:late-event']);

  before.dispose();
  late.dispose();
});

test('新开一局时实体定时器时钟回到 0', () => {
  updateAllTickManagers(500, 50);
  resetTickManagerClock();

  const manager = new EntityTickManager({ handleTickEvent() {} });
  assert.equal(manager.currentFrame, 0);
  manager.dispose();
});
