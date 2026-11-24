import assert from 'node:assert/strict';
import test from 'node:test';

// 单机开局不依赖服务器：点击开始游戏时即使服务器不可达、或上一局残留了
// 在线 socket / 重连计划，也必须能进入单机。
// 残留 socket 有两个危害：
//   1. 它关闭时会按 InLobby/Preparing 弹“无法连接到服务器，已退出房间”；
//   2. dispatchBinaryMessage 会优先走仍打开的 socket，把 mock 房间的
//      chooseMap/ready 请求发给真实服务器。

const { WebSocketClient } = await import('./sync.ts');
const { PhaserEventBus, PhaserEvents } = await import('../../game/EventBus.ts');

function installFakeTransport(client) {
  const state = { closed: false, hasSocket: true };
  client.transport = {
    setCallbacks() {},
    open() { return true; },
    send() { return false; },
    isOpen() { return false; },
    currentSocket() { return state.hasSocket ? {} : null; },
    close() {
      state.closed = true;
      state.hasSocket = false;
    },
  };
  return state;
}

test('startSinglePlayerRoom 关闭残留在线连接且不触发断线提示', () => {
  const client = new WebSocketClient();
  const transport = installFakeTransport(client);

  const closedMessages = [];
  const onClosed = (event) => closedMessages.push(event.message);
  PhaserEventBus.on(PhaserEvents.RoomClosed, onClosed);
  try {
    client.startSinglePlayerRoom();
  } finally {
    PhaserEventBus.off(PhaserEvents.RoomClosed, onClosed);
  }

  assert.equal(transport.closed, true, '残留 socket 必须被主动关闭');
  assert.equal(client.isMockRoomMode(), true, '单机必须走 mock 房间');
  assert.equal(client.isReconnecting(), false, '单机不得保留重连计划');
  assert.deepEqual(closedMessages, [], '关闭残留连接不能弹“无法连接到服务器”');
});

test('startSinglePlayerRoom 不因缺少在线会话而报错', () => {
  const client = new WebSocketClient();
  const transport = installFakeTransport(client);
  transport.hasSocket = false;

  assert.doesNotThrow(() => client.startSinglePlayerRoom());
  assert.equal(transport.closed, false, '没有 socket 时无需调用 close');
  assert.equal(client.isMockRoomMode(), true);
});
