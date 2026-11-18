import assert from 'node:assert/strict';
import test from 'node:test';

// 业务响应处理：roomSync / roomAllSync → EventBus + OnlineStateManager。
const WSClientHandlers = (await import('./handlers.ts')).default;
const { RoomResponse } = await import('../../pb/response.ts');
const { PhaserEventBus, PhaserEvents } = await import('../../game/EventBus.ts');
const { onlineStateManager } = await import('../../store/OnlineStateManager.ts');
const EnumGameStage = (await import('./game_state.ts')).default;

function makeHandlers() {
  const fakeWs = {
    closeConnection() {},
    enterDesyncOfflineMode() {},
    getReceiveQueue: () => null,
    enqueuePendingInGameResponse() {},
  };
  return new WSClientHandlers(fakeWs);
}

test('roomSync 更新共享状态并广播 RoomSync 事件', () => {
  onlineStateManager.resetAllState();
  const handlers = makeHandlers();
  let received = null;
  const listener = (event) => { received = event; };
  PhaserEventBus.on(PhaserEvents.RoomSync, listener);

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
  handlers.handleRoomResponse(bytes);
  PhaserEventBus.off(PhaserEvents.RoomSync, listener);

  assert.equal(received.players.length, 2);
  assert.equal(received.players[1].loaded, true);
  assert.deepEqual(
    onlineStateManager.getRoomSyncPlayers().map((player) => player.progress),
    [45, 100],
  );
});

test('roomAllSync 把阶段推进到 InGame 并触发开局事件', () => {
  onlineStateManager.resetAllState();
  onlineStateManager.updateGameStage(EnumGameStage.Loading);
  const handlers = makeHandlers();
  const seen = [];
  const allSync = () => seen.push('allSync');
  const gameStart = () => seen.push('gameStart');
  PhaserEventBus.on(PhaserEvents.RoomAllSync, allSync);
  PhaserEventBus.on(PhaserEvents.RoomGameStart, gameStart);

  handlers.handleRoomResponse(RoomResponse.toBinary({
    payload: { oneofKind: 'roomAllSync', roomAllSync: {} },
  }));
  PhaserEventBus.off(PhaserEvents.RoomAllSync, allSync);
  PhaserEventBus.off(PhaserEvents.RoomGameStart, gameStart);

  assert.equal(onlineStateManager.getCurrentGameStage(), EnumGameStage.InGame);
  assert.deepEqual(seen, ['allSync', 'gameStart']);
});
