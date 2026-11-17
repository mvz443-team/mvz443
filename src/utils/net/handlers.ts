// 业务响应处理：把解码后的 protobuf 响应翻译成状态更新与 EventBus 事件。
// 不直接操作 Phaser / CombatManager：需要战斗层配合时通过 EventBus 发事件，
// 由战斗层订阅，消除 utils → game 顶层的反向依赖。

import type { WebSocketClient } from "./sync";
import {
  InGameResponse,
  LobbyResponse,
  RoomResponse,
} from "../../pb/response";
import EnumGameStage from "./game_state";
import { PhaserEventBus, PhaserEvents } from "../../game/EventBus";
import { onlineStateManager } from "../../store/OnlineStateManager";
import { PeerInfo, RoomAllReadyEvent } from "../../types/online";
import { computeLoadoutHash } from "./loadout";
import type { InlineSnapshot } from "../../game/core/snapshot/InlineSnapshot";

export default class WSClientHandlers {
  private ws: WebSocketClient;

  constructor(ws: WebSocketClient) {
    this.ws = ws;
  }

  public handleLobbyResponse(response: Uint8Array) {
    const lobbyResponse = LobbyResponse.fromBinary(response);

    switch (lobbyResponse.payload.oneofKind) {
      case 'joinRoomFailed':
        onlineStateManager.updateOnlineMode(false);
        onlineStateManager.resetAllState();
        console.error('Join room failed:', lobbyResponse.payload.joinRoomFailed.message);
        PhaserEventBus.emit(PhaserEvents.RoomError, {
          message: lobbyResponse.payload.joinRoomFailed.message,
        });
        this.ws.closeConnection();
        break;
      case 'joinRoomSuccess': {
        const joinRoomSuccess = lobbyResponse.payload.joinRoomSuccess;
        onlineStateManager.updateOnlineMode(true);
        onlineStateManager.updateGameStage(EnumGameStage.InLobby);
        onlineStateManager.updateRoomInfo(joinRoomSuccess.roomId, joinRoomSuccess.myId, 50);
        onlineStateManager.updateConnectionKey(joinRoomSuccess.key);

        PhaserEventBus.emit(PhaserEvents.LobbyJoinSuccess, {
          roomId: joinRoomSuccess.roomId,
          myId: joinRoomSuccess.myId,
          key: joinRoomSuccess.key,
          message: joinRoomSuccess.message,
        });
        break;
      }
      default:
        console.error("Unknown lobby response type:", lobbyResponse.payload.oneofKind);
        break;
    }
  }

  public handleRoomResponse(response: Uint8Array) {
    const roomResponse = RoomResponse.fromBinary(response);

    switch (roomResponse.payload.oneofKind) {
      case 'roomInfo': {
        const roomInfo = roomResponse.payload.roomInfo;
        onlineStateManager.updateRoomInfo(roomInfo.roomId, roomInfo.myId, roomInfo.lordId, roomInfo.peers, {
          roomName: roomInfo.roomName,
          chapterId: roomInfo.chapterId,
          stageId: roomInfo.stageId,
        });

        let peersData: PeerInfo[] | null = null;
        try {
          const parsed = JSON.parse(roomInfo.peers) as PeerInfo[];
          if (Array.isArray(parsed)) {
            peersData = parsed;
          }
        } catch (e) {
          console.warn('Failed to parse peers JSON:', roomInfo.peers, e);
        }

        PhaserEventBus.emit(PhaserEvents.RoomInfo, {
          roomId: roomInfo.roomId,
          myId: roomInfo.myId,
          lordId: roomInfo.lordId,
          peers: roomInfo.peers,
          peersData,
          playerCount: peersData ? peersData.length : 0,
          roomName: roomInfo.roomName,
          chapterId: roomInfo.chapterId,
          stageId: roomInfo.stageId,
        });
        break;
      }
      case 'chooseMap': {
        const chooseMap = roomResponse.payload.chooseMap;
        onlineStateManager.updateGameStage(EnumGameStage.Preparing);
        PhaserEventBus.emit(PhaserEvents.RoomChooseMap, chooseMap);
        break;
      }
      case 'quitChooseMap':
        onlineStateManager.updateGameStage(EnumGameStage.InLobby);
        PhaserEventBus.emit(PhaserEvents.RoomQuitChooseMap);
        break;
      case 'updateReadyCount': {
        const updateReadyCount = roomResponse.payload.updateReadyCount;
        PhaserEventBus.emit(PhaserEvents.RoomUpdateReadyCount, {
          readyCount: updateReadyCount.count,
          totalPlayers: updateReadyCount.allPlayerCount,
        });
        break;
      }
      case 'allReady': {
        const allReady = roomResponse.payload.allReady;
        const allReadyEvent: RoomAllReadyEvent = {
          allPlayerCount: allReady.allPlayerCount,
          seed: allReady.seed,
          myId: allReady.myId,
          playerIds: allReady.playerIds,
          loadouts: allReady.loadouts,
        };

        const ownLoadout = allReady.loadouts.find((entry) => entry.playerId === allReady.myId);
        if (ownLoadout?.loadout && ownLoadout.hash !== computeLoadoutHash(ownLoadout.loadout)) {
          const message = "开局配置摘要不匹配，已阻止进入战斗以避免状态分叉";
          console.error(message, ownLoadout);
          PhaserEventBus.emit(PhaserEvents.RoomError, { message });
          return;
        }

        onlineStateManager.updateRoomAllReady(allReadyEvent);
        onlineStateManager.updateGameStage(EnumGameStage.Loading);
        PhaserEventBus.emit(PhaserEvents.RoomAllReady, allReadyEvent);
        break;
      }
      case 'allLoaded': {
        onlineStateManager.updateGameStage(EnumGameStage.InGame);
        const roomInfo = onlineStateManager.getRoomInfo();
        PhaserEventBus.emit(PhaserEvents.RoomGameStart, { myID: roomInfo.myId });
        break;
      }
      case 'checkpointAccepted': {
        const accepted = roomResponse.payload.checkpointAccepted;
        console.log('[checkpoint] accepted', accepted.frameId, accepted.snapshotKind);
        break;
      }
      case 'replayFrames': {
        const replay = roomResponse.payload.replayFrames;
        // 依赖倒置：把快照恢复交给战斗层处理（监听 ReplaySnapshotReceived）
        if (replay.checkpointFrameId > 0 && replay.inlineSnapshotJson) {
          try {
            const snapshot = JSON.parse(replay.inlineSnapshotJson) as InlineSnapshot;
            PhaserEventBus.emit(PhaserEvents.ReplaySnapshotReceived, {
              snapshot,
              frameId: replay.checkpointFrameId,
            });
          } catch (error) {
            console.warn("[checkpoint] replay snapshot restore failed", error);
          }
        }
        const receiveQueue = this.ws.getReceiveQueue();
        for (const frame of replay.frames) {
          if (receiveQueue) receiveQueue.handleInGameResponse(frame);
          else this.ws.enqueuePendingInGameResponse(frame);
        }
        break;
      }
      case 'gameEnd': {
        const gameEnd = roomResponse.payload.gameEnd;
        const receiveQueue = this.ws.getReceiveQueue();
        if (onlineStateManager.getCurrentGameStage() === EnumGameStage.InGame && receiveQueue) {
          receiveQueue.handleGameEndResponse(gameEnd.gameResult === 1, gameEnd.endFrameId);
        } else {
          onlineStateManager.updateGameStage(EnumGameStage.PostGame);
          PhaserEventBus.emit(PhaserEvents.RoomGameEnd, { isWin: gameEnd.gameResult === 1 });
        }
        break;
      }
      case 'returnToLobby': {
        // 服务端确认：房间已重置回等待房间，客户端回到关卡页
        onlineStateManager.updateGameStage(EnumGameStage.InLobby);
        onlineStateManager.resetGameData();
        PhaserEventBus.emit(PhaserEvents.ReturnToLobby, {
          stage: roomResponse.payload.returnToLobby.stage,
        });
        break;
      }
      case 'roomClosed': {
        const roomClosed = roomResponse.payload.roomClosed;
        onlineStateManager.resetAllState();
        this.ws.closeConnection();
        PhaserEventBus.emit(PhaserEvents.RoomClosed, { message: roomClosed.message });
        break;
      }
      case 'error': {
        const error = roomResponse.payload.error;
        if (error.message.includes('状态分叉')) {
          this.ws.enterDesyncOfflineMode();
          PhaserEventBus.emit(PhaserEvents.DesyncOfflineMode, { message: error.message });
          return;
        }
        PhaserEventBus.emit(PhaserEvents.RoomError, { message: error.message });
        break;
      }
      default:
        console.warn('Unknown room response type:', roomResponse.payload.oneofKind);
        break;
    }
  }

  public handleInGameResponse(response: Uint8Array) {
    const inGameResponse = InGameResponse.fromBinary(response);
    if (inGameResponse.frameId === 0 && inGameResponse.operations.length === 0) {
      // 房间响应与权威帧共享二进制通道：首帧 0 时再试 RoomResponse
      const roomResponse = RoomResponse.fromBinary(response);
      if (roomResponse.payload.oneofKind === "gameEnd") {
        this.handleRoomResponse(response);
        return;
      }
    }
    const receiveQueue = this.ws.getReceiveQueue();
    if (receiveQueue) {
      receiveQueue.handleInGameResponse(inGameResponse);
    } else {
      this.ws.enqueuePendingInGameResponse(inGameResponse);
    }
  }
}
