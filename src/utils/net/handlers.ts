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
import { normalizeSyncPlayers } from "./player_sync";
import { computeLoadoutHash } from "./loadout";
import type { InlineSnapshot } from "../../game/core/snapshot/InlineSnapshot";
import { desyncDiagnostics } from "../debug/desyncDiagnostics";

export default class WSClientHandlers {
  private ws: WebSocketClient;

  constructor(ws: WebSocketClient) {
    this.ws = ws;
  }

  public handleLobbyResponse(response: Uint8Array | LobbyResponse) {
    const lobbyResponse = response instanceof Uint8Array ? LobbyResponse.fromBinary(response) : response;

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
        desyncDiagnostics.record("room", "joinRoomSuccess", {
          roomId: joinRoomSuccess.roomId,
          myId: joinRoomSuccess.myId,
        });
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

  public handleRoomResponse(response: Uint8Array | RoomResponse) {
    const roomResponse = response instanceof Uint8Array ? RoomResponse.fromBinary(response) : response;

    switch (roomResponse.payload.oneofKind) {
      case 'roomInfo': {
        const roomInfo = roomResponse.payload.roomInfo;
        desyncDiagnostics.record("room", "roomInfo", {
          roomId: roomInfo.roomId,
          myId: roomInfo.myId,
          lordId: roomInfo.lordId,
          peers: roomInfo.peers,
          roomName: roomInfo.roomName,
          chapterId: roomInfo.chapterId,
          stageId: roomInfo.stageId,
        });
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
        desyncDiagnostics.record("room", "chooseMap", chooseMap);
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
        desyncDiagnostics.record("room", "allReady", {
          allPlayerCount: allReady.allPlayerCount,
          seed: allReady.seed,
          myId: allReady.myId,
          playerIds: allReady.playerIds,
          loadouts: allReady.loadouts,
        });
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
      case 'roomSync': {
        const players = normalizeSyncPlayers(roomResponse.payload.roomSync.players);
        desyncDiagnostics.record("room", "roomSync", players);
        onlineStateManager.updateRoomSync(players);
        PhaserEventBus.emit(PhaserEvents.RoomSync, { players: onlineStateManager.getRoomSyncPlayers() });
        break;
      }
      case 'roomAllSync': {
        desyncDiagnostics.record("room", "roomAllSync", {
          roomId: onlineStateManager.getRoomInfo().roomId,
          myId: onlineStateManager.getRoomInfo().myId,
          frameId: this.currentFrameId(),
        });
        onlineStateManager.updateGameStage(EnumGameStage.InGame);
        const roomInfo = onlineStateManager.getRoomInfo();
        PhaserEventBus.emit(PhaserEvents.RoomAllSync, {});
        PhaserEventBus.emit(PhaserEvents.RoomGameStart, { myID: roomInfo.myId });
        break;
      }
      case 'allLoaded': {
        desyncDiagnostics.record("room", "allLoaded(compat)", {
          roomId: onlineStateManager.getRoomInfo().roomId,
          myId: onlineStateManager.getRoomInfo().myId,
        });
        // 兼容旧服务端 / mock：语义与 roomAllSync 一致。
        onlineStateManager.updateGameStage(EnumGameStage.InGame);
        const roomInfo = onlineStateManager.getRoomInfo();
        PhaserEventBus.emit(PhaserEvents.RoomAllSync, {});
        PhaserEventBus.emit(PhaserEvents.RoomGameStart, { myID: roomInfo.myId });
        break;
      }
      case 'checkpointAccepted': {
        const accepted = roomResponse.payload.checkpointAccepted;
        desyncDiagnostics.record("room", "checkpointAccepted", {
          frameId: accepted.frameId,
          snapshotKind: accepted.snapshotKind,
        });
        console.log('[checkpoint] accepted', accepted.frameId, accepted.snapshotKind);
        break;
      }
      case 'replayFrames': {
        const replay = roomResponse.payload.replayFrames;
        desyncDiagnostics.record("room", "replayFrames", {
          checkpointFrameId: replay.checkpointFrameId,
          frameCount: replay.frames.length,
          hasInlineSnapshot: Boolean(replay.inlineSnapshotJson),
        });
        // 依赖倒置：把快照恢复交给战斗层处理（监听 ReplaySnapshotReceived）。
        // 页面刷新后 Preload/Game 场景可能尚未创建，这里交给 ws 缓存，
        // 等 SyncManager.setQueue 后再派发，避免快照恢复事件被丢弃。
        if (replay.checkpointFrameId > 0 && replay.inlineSnapshotJson) {
          try {
            const snapshot = JSON.parse(replay.inlineSnapshotJson) as InlineSnapshot;
            this.ws.enqueuePendingReplaySnapshot({
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
        desyncDiagnostics.record("room", "gameEnd", {
          gameResult: gameEnd.gameResult,
          endFrameId: gameEnd.endFrameId,
          frameId: this.currentFrameId(),
          ackFrameId: this.currentAckFrameId(),
        });
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
        desyncDiagnostics.record("room", "returnToLobby", roomResponse.payload.returnToLobby);
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
        desyncDiagnostics.record("room", "roomClosed", { message: roomClosed.message });
        onlineStateManager.resetAllState();
        this.ws.closeConnection();
        PhaserEventBus.emit(PhaserEvents.RoomClosed, { message: roomClosed.message });
        break;
      }
      case 'error': {
        const error = roomResponse.payload.error;
        const isStateDivergence = error.message.includes('状态分叉');
        const isVersionMismatch = error.message.includes('客户端版本不一致');
        if (isStateDivergence || isVersionMismatch) {
          const report = {
            message: error.message,
            roomId: onlineStateManager.getRoomInfo().roomId,
            myId: onlineStateManager.getRoomInfo().myId,
            frameId: this.currentFrameId(),
            ackFrameId: this.currentAckFrameId(),
            serverLogUrl: this.buildServerLogUrl(),
          };
          desyncDiagnostics.record(
            "desync",
            isVersionMismatch ? "server reported client version mismatch" : "server reported state divergence",
            report,
          );
          PhaserEventBus.emit(PhaserEvents.DesyncOfflineMode, { message: error.message });
          // 立即下载：此时 CombatManager 已通过事件进入离线态，状态提供器仍能
          // 捕获当前 Model 全量状态。downloadOnce 保证结算时不会重复下载。
          desyncDiagnostics.downloadOnce(
            isVersionMismatch ? "client-version-mismatch" : "server-desync",
            report,
          );
          this.ws.enterDesyncOfflineMode();
          return;
        }
        desyncDiagnostics.record("room", "error", { message: error.message });
        PhaserEventBus.emit(PhaserEvents.RoomError, { message: error.message });
        break;
      }
      default:
        console.warn('Unknown room response type:', roomResponse.payload.oneofKind);
        break;
    }
  }

  public handleInGameResponse(response: Uint8Array | InGameResponse) {
    const inGameResponse = response instanceof Uint8Array ? InGameResponse.fromBinary(response) : response;
    if (inGameResponse.frameId === 0 && inGameResponse.operations.length === 0) {
      // 房间响应与权威帧共享二进制通道：只有拿到原始字节时才需要再试 RoomResponse。
      if (response instanceof Uint8Array) {
        const roomResponse = RoomResponse.fromBinary(response);
        if (roomResponse.payload.oneofKind === "gameEnd") {
          this.handleRoomResponse(roomResponse);
          return;
        }
      }
    }
    const receiveQueue = this.ws.getReceiveQueue();
    if (receiveQueue) {
      receiveQueue.handleInGameResponse(inGameResponse);
    } else {
      this.ws.enqueuePendingInGameResponse(inGameResponse);
    }
  }

  /** 服务端诊断日志下载地址：与 WS 同源，仅在临时诊断期间使用。 */
  private currentFrameId(): number | null {
    return typeof this.ws.GetFrameID === "function" ? this.ws.GetFrameID() : null;
  }

  private currentAckFrameId(): number | null {
    return typeof this.ws.AckFrameID === "number" ? this.ws.AckFrameID : null;
  }

  private buildServerLogUrl(): string | null {
    const url = this.ws.url;
    const roomId = onlineStateManager.getRoomInfo().roomId;
    if (!url || roomId < 0) return null;
    try {
      const parsed = new URL(url);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      parsed.pathname = "/debug/desync-log";
      parsed.search = `?room=${roomId}`;
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  }
}
