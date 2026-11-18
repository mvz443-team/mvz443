import assert from 'node:assert/strict';
import test from 'node:test';

// 帧权威性回归：只有收到服务端该帧的 InGameResponse 才能推进；
// 仅凭“某个回包顺带携带了未来帧操作”推进会让客户端在没有该帧完整
// 操作集合时提前 ACK，服务端于是把未完整执行的帧当成双方已确认。

const QueueReceive = (await import('./queue_receive.ts')).default;
const BackendWS = (await import('../../utils/net/sync.ts')).default;
const SyncManager = (await import('../managers/combat/SyncManager')).default;

BackendWS.sendBlankFrame = () => {};
SyncManager.Instance.setCurrentOperationResponseSeq = () => {};

function cardPlantOperation(processFrameId, col = 2, row = 0) {
  return {
    processFrameId,
    operationIndex: 1,
    responseClientOpSeq: processFrameId,
    payload: {
      oneofKind: 'cardPlant',
      cardPlant: {
        pid: 2,
        level: 1,
        cost: 50,
        base: { uid: 101, col, row },
      },
    },
  };
}

function trackApplied(queue) {
  const applied = [];
  queue.InGameEventBus.on('onCardPlant', (pid, col, row, level, uid) => {
    applied.push({ pid, col, row, level, uid });
  });
  return applied;
}

test('缺少目标帧回包时不得凭未来帧操作提前推进', () => {
  const queue = new QueueReceive();
  const applied = trackApplied(queue);
  queue.currentFrameId = 3;
  queue.lastAckFrameId = 3;

  // frame 3 的重复回包顺带携带 frame 4 的操作；frame 4 本身尚未下发。
  queue.handleInGameResponse({
    frameId: 3,
    operations: [cardPlantOperation(4)],
  });

  assert.equal(queue.Consume(), false, '缺少 frame 4 权威回包时不得推进');
  assert.equal(queue.currentFrameId, 3);
  assert.equal(applied.length, 0);

  // frame 4 的权威回包到达后，操作只执行一次（同一签名去重）。
  queue.handleInGameResponse({
    frameId: 4,
    operations: [cardPlantOperation(4)],
  });
  assert.equal(queue.Consume(), true);
  assert.equal(queue.currentFrameId, 4);
  assert.equal(applied.length, 1);
});

test('空权威帧也能正常推进并 ACK', () => {
  const queue = new QueueReceive();
  queue.handleInGameResponse({ frameId: 1, operations: [] });
  assert.equal(queue.Consume(), true);
  assert.equal(queue.currentFrameId, 1);
  assert.equal(queue.lastAckFrameId, 1);
});

test('回滚后按已执行操作重放，不跳过也不重复帧', () => {
  const queue = new QueueReceive();
  const applied = trackApplied(queue);

  queue.handleInGameResponse({ frameId: 1, operations: [] });
  queue.handleInGameResponse({ frameId: 2, operations: [cardPlantOperation(2)] });
  queue.handleInGameResponse({ frameId: 3, operations: [] });
  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.currentFrameId, 3);
  assert.equal(applied.length, 1);

  queue.restoreToFrame(1);
  assert.equal(queue.currentFrameId, 1);
  assert.equal(queue.lastAckFrameId, 1);

  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.currentFrameId, 3, '重放必须恢复到回滚前帧号');
  assert.equal(applied.length, 2, '重放必须重新执行 frame 2 的操作');
});

test('恢复 checkpoint 时保留断线前已收到的未来帧', () => {
  const queue = new QueueReceive();
  const applied = trackApplied(queue);

  queue.handleInGameResponse({ frameId: 1, operations: [] });
  queue.handleInGameResponse({ frameId: 2, operations: [] });
  queue.handleInGameResponse({ frameId: 3, operations: [] });
  queue.handleInGameResponse({ frameId: 4, operations: [cardPlantOperation(4)] });
  queue.handleInGameResponse({ frameId: 5, operations: [] });

  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.currentFrameId, 3);

  // 断线重连：服务端要求恢复到 frame 1 后重放。
  queue.restoreToFrame(1);
  assert.equal(queue.currentFrameId, 1);
  assert.equal(queue.lastAckFrameId, 1);

  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.Consume(), true);
  assert.equal(queue.currentFrameId, 5, '恢复后必须继续消费断线前已缓冲的 frame 4/5');
  assert.equal(applied.length, 1, 'frame 4 的操作只能执行一次');
});

test('恢复 checkpoint 时保留尚未 Consume 的队列回包', () => {
  const queue = new QueueReceive();
  const applied = trackApplied(queue);

  for (let frame = 1; frame <= 3; frame += 1) {
    queue.handleInGameResponse({ frameId: frame, operations: [] });
    assert.equal(queue.Consume(), true);
  }
  // 重连补帧已经进了 queues，但逻辑循环还没 Consume 就触发 checkpoint 恢复。
  queue.handleInGameResponse({ frameId: 4, operations: [cardPlantOperation(4)] });
  queue.handleInGameResponse({ frameId: 5, operations: [] });
  assert.equal(queue.currentFrameId, 3);

  queue.restoreToFrame(1);
  assert.equal(queue.currentFrameId, 1);
  for (let frame = 2; frame <= 5; frame += 1) {
    assert.equal(queue.Consume(), true, `恢复后必须仍能消费 frame ${frame}`);
  }
  assert.equal(queue.currentFrameId, 5);
  assert.equal(applied.length, 1, 'queued frame 4 的操作必须执行且只执行一次');
});
