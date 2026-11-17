// Request sender for room lifecycle operations.
import {
  Request,
  RequestChooseMap,
  RequestEndGame,
  RequestKickPlayer,
  RequestLeaveChooseMap,
  RequestLoaded,
  RequestReady,
  RequestUpdateRoom
} from "../../pb/request";
import type { LoadoutSnapshot } from "../../pb/common";
import BackendWS from "./sync";
import { canonicalizeLoadout } from "./loadout";

function SendChooseMap(chapterId: number, stageId: number) {
  if (!BackendWS.isRoomSessionMode() || !BackendWS.isLord()) {
    return;
  }

  const request: RequestChooseMap = {
    chapterId,
    stageId
  };
  BackendWS.send(Request.toBinary({ payload: { chooseMap: request, oneofKind: 'chooseMap' } }));
}

function SendLeaveChooseMap() {
  const request: RequestLeaveChooseMap = {};
  BackendWS.send(Request.toBinary({ payload: { leaveChooseMap: request, oneofKind: 'leaveChooseMap' } }));
}

function SendReady(isReady: boolean, loadout?: LoadoutSnapshot) {
  const request: RequestReady = {
    isReady,
    loadout: isReady && loadout ? canonicalizeLoadout(loadout) : undefined
  };
  BackendWS.send(Request.toBinary({ payload: { ready: request, oneofKind: 'ready' } }));
}

function SendLoaded(isLoaded: boolean = true) {
  if (!isLoaded) {
    return;
  }

  if (!BackendWS.isRoomSessionMode()) {
    console.error("SendLoaded requires an active room session. Single-player must use the mock room flow.");
    return;
  }

  const request: RequestLoaded = {
    isLoaded: true
  };
  BackendWS.send(Request.toBinary({ payload: { loaded: request, oneofKind: 'loaded' } }));
}

function SendEndGame(isWin: boolean) {
  const request: RequestEndGame = {
    gameResult: isWin ? 1 : 0
  };
  BackendWS.send(Request.toBinary({ payload: { endGame: request, oneofKind: 'endGame' } }));
}

/** 房主修改房间名与密码；服务端会重新广播 roomInfo */
function SendUpdateRoom(name: string, key: string) {
  if (!BackendWS.isRoomSessionMode() || !BackendWS.isLord()) {
    return;
  }
  const request: RequestUpdateRoom = { name, key };
  BackendWS.send(Request.toBinary({ payload: { updateRoom: request, oneofKind: 'updateRoom' } }));
}

/** 房主把指定玩家移出房间 */
function SendKickPlayer(playerId: number) {
  if (!BackendWS.isRoomSessionMode() || !BackendWS.isLord()) {
    return;
  }
  const request: RequestKickPlayer = { playerId };
  BackendWS.send(Request.toBinary({ payload: { kickPlayer: request, oneofKind: 'kickPlayer' } }));
}

export { SendChooseMap, SendLeaveChooseMap, SendReady, SendLoaded, SendEndGame, SendUpdateRoom, SendKickPlayer };
