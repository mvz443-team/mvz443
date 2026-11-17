import assert from 'node:assert/strict';
import test from 'node:test';

// message_router 分流测试：覆盖 roomInfo 在 InLobby 阶段曾被视为 joinRoomSuccess 的回归。
const { routeIncoming, decodeForTest } = await import('./message_router.ts');
const { LobbyResponse, RoomResponse, InGameResponse } = await import('../../pb/response.ts');
const EnumGameStage = (await import('./game_state.ts')).default;

function makeStage(stage, roomSession = false) {
  return { getStage: () => stage, isOnline: () => true, isRoomSession: () => roomSession };
}

function makeHandlers(log) {
  return {
    handleLobbyResponse: () => log.push('lobby'),
    handleRoomResponse: () => log.push('room'),
    handleInGameResponse: () => log.push('ingame'),
  };
}

test('joinRoomSuccess 在大厅阶段路由到 lobby', () => {
  const bytes = LobbyResponse.toBinary({
    payload: {
      oneofKind: 'joinRoomSuccess',
      joinRoomSuccess: { roomId: 7, myId: 101, key: 'abc', message: 'ok' },
    },
  });
  const log = [];
  assert.equal(routeIncoming(bytes, makeStage(EnumGameStage.InLobby, false), makeHandlers(log)), 'lobby');
  assert.deepEqual(log, ['lobby']);
  assert.equal(decodeForTest(bytes, false).kind, 'lobby');
});

test('roomInfo 与 joinRoomSuccess 共享首字段时仍路由到 room', () => {
  // 这是真实回归用例：roomInfo 首字节 0x0A，与 joinRoomSuccess 相同。
  const roomInfo = RoomResponse.toBinary({
    payload: {
      oneofKind: 'roomInfo',
      roomInfo: {
        roomId: 0,
        myId: 101,
        lordId: 101,
        peers: JSON.stringify([{ id: 101, name: 'player', ready: false, state: 16 }]),
        roomName: 'e2e',
        chapterId: 1,
        stageId: 1,
      },
    },
  });
  const stage = makeStage(EnumGameStage.InLobby, true);
  const log = [];
  assert.equal(routeIncoming(roomInfo, stage, makeHandlers(log)), 'room');
  assert.deepEqual(log, ['room']);

  // 重连后 stage 仍是大厅但 roomSession=true，也不能误判为 lobby
  assert.equal(decodeForTest(roomInfo).kind, 'room');
});

test('权威帧首字节 0x08 始终路由到 ingame', () => {
  const frame = InGameResponse.toBinary({ frameId: 12, operations: [] });
  const log = [];
  assert.equal(routeIncoming(frame, makeStage(EnumGameStage.InGame, true), makeHandlers(log)), 'ingame');
  assert.deepEqual(log, ['ingame']);
});

test('非大厅阶段优先按 Room 解析', () => {
  const roomInfo = RoomResponse.toBinary({
    payload: {
      oneofKind: 'roomInfo',
      roomInfo: { roomId: 3, myId: 9, lordId: 9, peers: '[]', roomName: 'r', chapterId: 1, stageId: 2 },
    },
  });
  const log = [];
  assert.equal(routeIncoming(roomInfo, makeStage(EnumGameStage.InGame, true), makeHandlers(log)), 'room');
  assert.deepEqual(log, ['room']);
});
