import assert from 'node:assert/strict';
import test from 'node:test';

// 新增协议包的编解码回归：playerLoaded / roomSync / roomAllSync。
const { Request } = await import('../../pb/request.ts');
const { RoomResponse } = await import('../../pb/response.ts');

test('playerLoaded 请求携带 1..100 进度并可往返解码', () => {
  const bytes = Request.toBinary({
    payload: {
      oneofKind: 'playerLoaded',
      playerLoaded: { progress: 100 },
    },
  });
  const decoded = Request.fromBinary(bytes);
  assert.equal(decoded.payload.oneofKind, 'playerLoaded');
  assert.equal(decoded.payload.playerLoaded.progress, 100);
});

test('roomSync 携带每位玩家 id / 进度 / 昵称 / 就绪标记', () => {
  const bytes = RoomResponse.toBinary({
    payload: {
      oneofKind: 'roomSync',
      roomSync: {
        players: [
          { playerId: 100, progress: 45, name: 'host', loaded: false },
          { playerId: 101, progress: 100, name: 'guest', loaded: true },
        ],
      },
    },
  });
  const decoded = RoomResponse.fromBinary(bytes);
  assert.equal(decoded.payload.oneofKind, 'roomSync');
  assert.equal(decoded.payload.roomSync.players.length, 2);
  assert.deepEqual(decoded.payload.roomSync.players[0], {
    playerId: 100, progress: 45, name: 'host', loaded: false,
  });
});

test('roomAllSync 与 allLoaded 是不同的 oneof 分支', () => {
  const allSync = RoomResponse.fromBinary(RoomResponse.toBinary({
    payload: { oneofKind: 'roomAllSync', roomAllSync: {} },
  }));
  const allLoaded = RoomResponse.fromBinary(RoomResponse.toBinary({
    payload: { oneofKind: 'allLoaded', allLoaded: {} },
  }));
  assert.equal(allSync.payload.oneofKind, 'roomAllSync');
  assert.equal(allLoaded.payload.oneofKind, 'allLoaded');
});
