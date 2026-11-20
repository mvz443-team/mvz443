import assert from 'node:assert/strict';
import test from 'node:test';

// user-room 的 JSON null 表示玩家不在任何房间，不能当成"服务器不可达"。
// 只有请求本身失败（fetch 抛错 / HTTP 错误）才允许 UI 提示无法连接。

const { queryMyRoom, leaveRoomRemotely } = await import('./lobby.ts');

test('user-room 返回 JSON null 表示没有房间', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => null,
  });
  try {
    const membership = await queryMyRoom('127.0.0.1:28080', 'player1');
    assert.equal(membership, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('user-room 请求失败时抛出错误', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ERR_CONNECTION_REFUSED'); };
  try {
    await assert.rejects(
      queryMyRoom('127.0.0.1:28080', 'player1'),
      /ERR_CONNECTION_REFUSED/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 退房信号是"玩家离开房间"的唯一显式信号：未送达（fetch 抛错）必须重试，
// 否则客户端清了本地状态但服务端席位残留，下次开始游戏又读到幽灵房间。
test('leaveRoomRemotely 在请求未送达时重试直到成功', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts < 3) throw new Error('ERR_CONNECTION_RESET');
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    const ok = await leaveRoomRemotely('127.0.0.1:28080', 'player1', false, { roomId: 5 });
    assert.equal(ok, true);
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 拿到 HTTP 响应（哪怕 ok:false）就不重试：退房请求幂等，重复发送无意义，
// 且 ok:false 可能是席位已被移除后的重复确认。
test('leaveRoomRemotely 拿到响应后不再重试', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return { ok: true, json: async () => ({ ok: false }) };
  };
  try {
    const ok = await leaveRoomRemotely('127.0.0.1:28080', 'player1', true, { roomId: 5 });
    assert.equal(ok, false);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
