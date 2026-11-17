// 消息路由：根据当前会话阶段把二进制 protobuf 解码并分发到对应 handler。
// 无论首连还是重连，所有消息都走同一条路由；不再按 socket 来源分流。

import { InGameResponse, LobbyResponse, RoomResponse } from "../../pb/response";
import EnumGameStage from "./game_state";
import type { OnlineStageProvider } from "./types";

export type ResponseKind = "lobby" | "room" | "ingame";

export interface MessageHandlers {
  handleLobbyResponse: (data: Uint8Array) => void;
  handleRoomResponse: (data: Uint8Array) => void;
  handleInGameResponse: (data: Uint8Array) => void;
}

// protobuf 首字段 wire tag：InGameResponse.frame_id=1(varint) → 0x08
function looksLikeInGameFrame(data: Uint8Array): boolean {
  return data.length > 0 && data[0] === 0x08;
}

// oneof 是否设置了有效值（解码失败时 oneofKind 为 undefined）
function hasLobbyPayload(msg: LobbyResponse): boolean {
  return Boolean(msg.payload.oneofKind);
}

function hasRoomPayload(msg: RoomResponse): boolean {
  return Boolean(msg.payload.oneofKind);
}

/**
 * routeIncoming 把一条二进制消息分发给 handler。
 * 策略：
 *  1. 首字节 0x08 → 权威帧，直接走 ingame（roomClosed/gameEnd 特例由 handler 兼容处理）。
 *  2. 其余按当前阶段优先尝试 Lobby/Room，解码后校验 oneof 有效；
 *     首次尝试失败则回退到另一种。
 */
export function routeIncoming(
  data: Uint8Array,
  stage: OnlineStageProvider,
  handlers: MessageHandlers,
): ResponseKind {
  if (looksLikeInGameFrame(data)) {
    handlers.handleInGameResponse(data);
    return "ingame";
  }

  const currentStage = stage.getStage();
  // 只有尚未进入房间会话时才优先按 Lobby 解析；
  // 一旦 joinRoomSuccess 处理完（roomSession=true），所有 0x0A 消息都是 RoomResponse.roomInfo，
  // 否则 LobbyResponse.fromBinary 会把 roomInfo 的 my_id/peers 误读成 joinRoomSuccess。
  const tryLobbyFirst = !stage.isRoomSession() && (currentStage === EnumGameStage.InLobby || currentStage === 0);

  if (tryLobbyFirst) {
    try {
      const lobby = LobbyResponse.fromBinary(data);
      if (hasLobbyPayload(lobby)) {
        handlers.handleLobbyResponse(data);
        return "lobby";
      }
    } catch {
      /* 回退到 Room */
    }
    handlers.handleRoomResponse(data);
    return "room";
  }

  try {
    const room = RoomResponse.fromBinary(data);
    if (hasRoomPayload(room)) {
      handlers.handleRoomResponse(data);
      return "room";
    }
  } catch {
    /* 回退到 Lobby */
  }
  handlers.handleLobbyResponse(data);
  return "lobby";
}

// 测试用：直接解析以验证分流策略
export function decodeForTest(data: Uint8Array, roomSession = true): { kind: ResponseKind | "unknown" } {
  if (looksLikeInGameFrame(data)) {
    try {
      const frame = InGameResponse.fromBinary(data);
      return { kind: frame.frameId > 0 ? "ingame" : "unknown" };
    } catch {
      return { kind: "unknown" };
    }
  }
  if (!roomSession) {
    try {
      const lobby = LobbyResponse.fromBinary(data);
      if (hasLobbyPayload(lobby)) return { kind: "lobby" };
    } catch { /* ignore */ }
  }
  try {
    const room = RoomResponse.fromBinary(data);
    if (hasRoomPayload(room)) return { kind: "room" };
  } catch { /* ignore */ }
  if (!roomSession) {
    try {
      const lobby = LobbyResponse.fromBinary(data);
      if (hasLobbyPayload(lobby)) return { kind: "lobby" };
    } catch { /* ignore */ }
  }
  return { kind: "unknown" };
}
