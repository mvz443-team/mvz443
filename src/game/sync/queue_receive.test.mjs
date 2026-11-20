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

test('补帧乱序到达时回滚仍按首次执行集合重放', () => {
  const queue = new QueueReceive();
  const applied = [];
  queue.InGameEventBus.on('onCardPlant', (_pid, col) => applied.push(col));

  queue.handleInGameResponse({ frameId: 1, operations: [] });
  queue.handleInGameResponse({ frameId: 2, operations: [cardPlantOperation(2, 2)] });
  assert.equal(queue.Consume(), true);

  // 服务端补帧到达顺序为 4 → 3；客户端必须先把 frame 4 排进历史。
  queue.handleInGameResponse({ frameId: 4, operations: [cardPlantOperation(4, 4)] });
  queue.handleInGameResponse({ frameId: 3, operations: [cardPlantOperation(3, 3)] });
  for (let step = 2; step <= 4; step += 1) {
    assert.equal(queue.Consume(), true, `首次运行必须消费 frame ${step}`);
  }
  assert.equal(queue.currentFrameId, 4);
  assert.deepEqual(applied, [2, 3, 4], '入队可乱序，但权威帧必须按帧号推进');

  queue.restoreToFrame(1);
  assert.deepEqual(queue.getReplayFrameIds(), [1, 2, 3, 4]);
  for (let step = 2; step <= 4; step += 1) {
    assert.equal(queue.Consume(), true, `重放 frame ${step} 必须成功`);
  }
  assert.equal(queue.currentFrameId, 4);
  assert.deepEqual(applied, [2, 3, 4, 2, 3, 4], '重放必须复用首次执行集合');
});

test('重复补发同一操作不得二次执行', () => {
  const queue = new QueueReceive();
  const applied = trackApplied(queue);

  queue.handleInGameResponse({ frameId: 1, operations: [cardPlantOperation(1)] });
  assert.equal(queue.Consume(), true);
  assert.equal(applied.length, 1);

  queue.handleInGameResponse({ frameId: 1, operations: [cardPlantOperation(1)] });
  assert.equal(queue.Consume(), false);
  assert.equal(applied.length, 1, '同一签名的历史操作必须忽略');
});

test('服务器改写后的迟到操作先回滚再重放', () => {
  const queue = new QueueReceive();
  const applied = [];
  queue.InGameEventBus.on('onCardPlant', (_pid, col) => applied.push(col));
  let rollbackTarget = null;
  let rollbackCount = 0;
  queue.setLateOperationRollback((frameId) => {
    rollbackTarget = frameId;
    rollbackCount += 1;
    queue.restoreToFrame(frameId - 1);
    return true;
  });

  for (let frame = 1; frame <= 5; frame += 1) {
    queue.handleInGameResponse({ frameId: frame, operations: [] });
    assert.equal(queue.Consume(), true);
  }

  queue.stageResponseOperationsForTest({
    frameId: 3,
    operations: [cardPlantOperation(3, 9)],
  });
  assert.equal(rollbackTarget, null, '回滚必须延迟到 Consume 入口统一执行');
  assert.equal(rollbackCount, 0);
  assert.equal(queue.currentFrameId, 5);
  assert.deepEqual(applied, [], '初始空帧没有操作');

  assert.equal(queue.Consume(), true);
  assert.equal(rollbackTarget, 3, '目标帧 3 的操作必须先回滚到该帧');
  assert.equal(rollbackCount, 1);
  assert.equal(queue.currentFrameId, 3);
  assert.deepEqual(applied, [9], '迟到操作必须在恢复后的目标帧执行');
  assert.equal(queue.Consume(), true);
  assert.equal(queue.currentFrameId, 4);
  assert.deepEqual(applied, [9], '历史帧重放不得重复执行操作');
});

test('落后帧数由见过的最大服务端帧号推导', () => {
  const queue = new QueueReceive();
  assert.equal(queue.getLagFrames(), 0);

  // 服务端帧 1..10 已到，客户端尚未消费 → 落后帧数按最大已见帧号计算。
  for (let frame = 1; frame <= 10; frame += 1) {
    queue.handleInGameResponse({ frameId: frame, operations: [] });
  }
  assert.equal(queue.currentFrameId, 0);
  assert.equal(queue.getLagFrames(), 10);

  // 逐帧消费，落后帧数单调下降。
  assert.equal(queue.Consume(), true);
  assert.equal(queue.getLagFrames(), 9);

  // 旧帧重发不得让落后程度倒退。
  queue.handleInGameResponse({ frameId: 8, operations: [] });
  assert.equal(queue.getLagFrames(), 9);

  // 服务端大幅推进到 120，本机落后立刻扩大，足以触发逻辑快进。
  queue.handleInGameResponse({ frameId: 120, operations: [] });
  assert.equal(queue.getLagFrames(), 119);
});

test('回滚重建冷却时取每张卡最后一次权威种植帧', () => {
  const queue = new QueueReceive();
  const plant = (frame, pid, uid = 101) => ({
    ...cardPlantOperation(frame),
    payload: {
      oneofKind: 'cardPlant',
      cardPlant: { pid, level: 1, cost: 50, base: { uid, col: 2, row: 0 } },
    },
  });

  // 本机 uid=101：pid 2 在帧 5 与帧 12 种过，pid 3 在帧 8 种过。
  // 别人的操作（pid 9）必须忽略。
  for (let frame = 1; frame <= 12; frame += 1) {
    let operations = [];
    if (frame === 5) operations = [plant(5, 2)];
    if (frame === 8) operations = [plant(8, 3)];
    if (frame === 12) operations = [plant(12, 2), plant(12, 9, 999)];
    queue.handleInGameResponse({ frameId: frame, operations });
    assert.equal(queue.Consume(), true);
  }

  assert.equal(queue.collectLastPlantFramesBefore(10, 101).get(2), 5);
  assert.equal(queue.collectLastPlantFramesBefore(10, 101).get(3), 8);
  assert.equal(queue.collectLastPlantFramesBefore(20, 101).get(2), 12);
  assert.equal(queue.collectLastPlantFramesBefore(20, 101).has(9), false, '他人操作不参与本机冷却');
});
