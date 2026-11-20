import assert from 'node:assert/strict';
import test from 'node:test';

import { logicEvents } from './LogicEvents.ts';

test('跨局重置清空逻辑事件队列与自增序号', () => {
  logicEvents.setFrame(321);
  const first = logicEvents.emit('Shoot', 'plant:0:0:1:0', { damage: 1 });
  assert.equal(first.eventId, 1);
  assert.equal(logicEvents.all().length, 1);

  logicEvents.reset();

  assert.deepEqual(logicEvents.snapshot(), { frame: 0, nextEventId: 1, events: [] });
  const next = logicEvents.emit('Shoot', 'plant:0:0:1:0', { damage: 1 });
  assert.equal(next.eventId, 1, '新局事件序号必须从 1 重新计数');
});
