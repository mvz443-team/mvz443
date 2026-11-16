import assert from 'node:assert/strict';
import test from 'node:test';

const { EntityTickManager } = await import('./EntityTickManager.ts');

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
