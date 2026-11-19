import assert from 'node:assert/strict';
import test from 'node:test';

// user-room 的 JSON null 表示玩家不在任何房间，不能当成"服务器不可达"。
// 只有请求本身失败（fetch 抛错 / HTTP 错误）才允许 UI 提示无法连接。

const { queryMyRoom } = await import('./lobby.ts');

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
