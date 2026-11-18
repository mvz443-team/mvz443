import assert from 'node:assert/strict';
import test from 'node:test';

// checkpoint 是重连恢复的唯一锚点：
// - 必须把快照自己的帧号同时写进 frameId / hashFrameId；
// - 必须携带完整 inline 正文，hash-only checkpoint 不能上报；
// - stateHashVersion 必须与当前源码一致。

const QueueSend = (await import('./queue_send.ts')).default;
const BackendWS = (await import('../../utils/net/sync.ts')).default;
const { Request } = await import('../../pb/request.ts');
const { SIMULATION_STATE_VERSION } = await import('../core/SimulationState.ts');

BackendWS.isRoomSessionMode = () => true;
BackendWS.GetFrameID = () => 202;
BackendWS.AckFrameID = 202;

function captureSent(queue) {
  const sent = [];
  BackendWS.send = (binary) => sent.push(Request.fromBinary(binary));
  queue.Consume();
  return sent;
}

const inlineSnapshot = {
  version: 1,
  hash: 'deadbeef',
  payload: {
    seed: 1,
    frameId: 200,
    values: { resources: { 'energy:101': 150 } },
    timers: { ticker: [] },
    prngs: [],
    entities: [],
  },
};

test('checkpoint 使用快照帧号并携带 inline 正文', () => {
  const queue = new QueueSend();
  queue.sendCheckpoint(200, 'deadbeef', inlineSnapshot);
  const sent = captureSent(queue);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.oneofKind, 'blank');
  const blank = sent[0].payload.blank;
  assert.equal(blank.frameId, 200, 'frameId 必须是快照帧而不是发送时的当前帧');
  assert.equal(blank.hashFrameId, 200, 'hashFrameId 必须非 0，否则服务端直接忽略');
  assert.equal(blank.stateHashHex, 'deadbeef');
  assert.equal(blank.stateHashVersion, SIMULATION_STATE_VERSION);
  assert.deepEqual(JSON.parse(blank.inlineSnapshotJson), inlineSnapshot);
});

test('hash-only checkpoint 不得上报', () => {
  const queue = new QueueSend();
  queue.sendCheckpoint(400, 'cafebabe', { hash: 'cafebabe' });
  const sent = captureSent(queue);
  assert.equal(sent.length, 0, '没有正文的 checkpoint 不能推进服务端恢复锚点');
});
