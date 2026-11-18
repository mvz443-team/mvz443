import assert from 'node:assert/strict';
import test from 'node:test';

// 页面刷新/Preload 阶段到达的 replay 快照与帧都可能先进入 pending。
// setQueue 必须先恢复快照（restoreToFrame 会重建接收队列），再灌入帧，
// 否则刚排队的未来帧会被快照恢复清掉，重连后永久卡在缺失帧。

const QueueReceive = (await import('../../game/sync/queue_receive.ts')).default;
const { WebSocketClient } = await import('./sync.ts');
const { PhaserEventBus, PhaserEvents } = await import('../../game/EventBus.ts');

test('setQueue 先恢复 replay 快照，再灌入 pending 帧', () => {
  const client = new WebSocketClient();
  const queue = new QueueReceive();
  const calls = [];
  const originalRestore = queue.restoreToFrame.bind(queue);
  const originalHandle = queue.handleInGameResponse.bind(queue);
  queue.restoreToFrame = (frameId) => {
    calls.push(`restore:${frameId}`);
    originalRestore(frameId);
  };
  queue.handleInGameResponse = (response) => {
    calls.push(`frame:${response.frameId}`);
    originalHandle(response);
  };

  const listener = ({ frameId }) => {
    queue.restoreToFrame(frameId);
  };
  PhaserEventBus.on(PhaserEvents.ReplaySnapshotReceived, listener);

  client.enqueuePendingInGameResponse({ frameId: 3, operations: [] });
  client.enqueuePendingReplaySnapshot({ snapshot: { version: 5 }, frameId: 2 });
  client.setQueue(queue, {});
  PhaserEventBus.off(PhaserEvents.ReplaySnapshotReceived, listener);

  assert.deepEqual(calls, ['restore:2', 'frame:3']);
  assert.equal(queue.currentFrameId, 2);
  assert.equal(queue.Consume(), true, '快照恢复后必须仍能消费 pending frame 3');
  assert.equal(queue.currentFrameId, 3);
});
