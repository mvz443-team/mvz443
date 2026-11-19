import assert from 'node:assert/strict';
import test from 'node:test';

// 等待房间没有任何业务上行时，客户端必须持续发送心跳，
// 否则服务端 15s 心跳超时会把两名玩家静默断线，房间出现空席/幽灵房。

const { WebSocketClient } = await import('./sync.ts');
const { Request } = await import('../../pb/request.ts');
const EnumGameStage = (await import('./game_state.ts')).default;
const { onlineStateManager } = await import('../../store/OnlineStateManager.ts');

test('等待房间持续发送 blank 心跳，进入对局后停止', () => {
  const client = new WebSocketClient();
  const sent = [];
  const intervals = new Map();
  let nextTimerId = 1;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  globalThis.window ??= globalThis;
  globalThis.window.setInterval = (callback, delay) => {
    const id = nextTimerId++;
    intervals.set(id, { callback, delay });
    return id;
  };
  globalThis.window.clearInterval = (id) => intervals.delete(id);
  client.transport.isOpen = () => true;
  client.send = (data) => sent.push(data);

  try {
    onlineStateManager.resetAllState();
    onlineStateManager.updateGameStage(EnumGameStage.InLobby);
    client.startLobbyHeartbeat();

    assert.equal(intervals.size, 1, '等待房间只应启动一个心跳定时器');
    const heartbeat = [...intervals.values()][0];
    assert.ok(heartbeat.delay < 15000, '心跳间隔必须小于服务端 15s 超时');

    heartbeat.callback();
    assert.equal(sent.length, 1, '心跳必须向上行发送二进制请求');
    const request = Request.fromBinary(sent[0]);
    assert.equal(request.payload.oneofKind, 'blank');
    assert.equal(request.payload.blank.frameId, 0, '大厅心跳不应携带对局帧号');

    onlineStateManager.updateGameStage(EnumGameStage.InGame);
    heartbeat.callback();
    assert.equal(sent.length, 1, '对局阶段由 SyncManager 发送帧心跳，不再重复');
    assert.equal(intervals.size, 0, '进入对局后必须清理大厅心跳定时器');
  } finally {
    client.stopLobbyHeartbeat();
    globalThis.window.setInterval = originalSetInterval;
    globalThis.window.clearInterval = originalClearInterval;
    onlineStateManager.resetAllState();
  }
});
