// 处理连接到服务器大厅：房间列表、建房与加入房间

import BackendWS from "./sync";
import { onlineStateManager } from "../../store/OnlineStateManager";
import { showAlert } from "../uiDialog";

/**
 * 服务端 /list 返回的房间信息
 * RoomID      int             `json:"room_id"`
 * RoomName    string          `json:"room_name"`
 * NeedKey     bool            `json:"need_key"`
 * PlayerCount int             `json:"player_count"`
 * GameState   constants.Stage `json:"game_state"`
 * ChapterID   uint32          `json:"chapter_id"`
 * StageID     uint32          `json:"stage_id"`
 */
export type RoomInfo = {
    room_id: number;
    room_name: string;
    need_key: boolean;
    player_count: number;
    game_state: number;
    chapter_id: number;
    stage_id: number;
};

// 与 service 端 utils/text.go 的限制保持一致
export const ROOM_NAME_MAX_LENGTH = 6;
export const ROOM_KEY_MAX_LENGTH = 8;

/** /user-room 返回的玩家已有房间会话 */
export interface UserRoomMembership {
    roomId: number;
    myId: number;
    key: string;
    roomName: string;
    chapterId: number;
    stageId: number;
    stage: number;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

// game_state to string
export function gameStateToString(state: number): string {
    switch (state) {
        case 0x20:
            return "大厅/等待中";
        case 0x21:
            return "准备中";
        case 0x22:
            return "加载中";
        case 0x23:
            return "游戏中";
        case 0x24:
            return "游戏后结算";
        case 0xEE:
            return "房间已关闭";
        case 0xFF:
            return "发生错误";
        default:
            return "未知状态";
    }
}

/** 去掉协议前缀、路径与首尾空白，得到 host:port 形式 */
export function normalizeServerAddress(input: string): string {
    let value = (input || "").trim();
    value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    value = value.split("/")[0];
    return value.trim();
}

/** 房间名：去掉控制字符，最多 6 个字符 */
export function normalizeRoomName(value: string): string {
    return Array.from((value || "").replace(CONTROL_CHARS, "")).slice(0, ROOM_NAME_MAX_LENGTH).join("");
}

/** 房间密码：去掉空白与控制字符，最多 8 个字符 */
export function normalizeRoomKey(value: string): string {
    return Array.from((value || "").replace(/\s/g, "").replace(CONTROL_CHARS, "")).slice(0, ROOM_KEY_MAX_LENGTH).join("");
}

function normalizeRoomInfo(raw: any): RoomInfo | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const roomId = Number(raw.room_id);
    if (!Number.isFinite(roomId)) {
        return null;
    }
    const playerCount = Number(raw.player_count) || 0;
    if (playerCount <= 0) {
        return null;
    }
    return {
        room_id: roomId,
        room_name: typeof raw.room_name === "string" && raw.room_name ? raw.room_name : `房间${roomId}`,
        need_key: Boolean(raw.need_key),
        player_count: playerCount,
        game_state: Number(raw.game_state) || 0,
        chapter_id: Number(raw.chapter_id) || 0,
        stage_id: Number(raw.stage_id) || 0,
    };
}

/**
 * 拉取房间列表；chapterId / stageId 传 undefined 表示不按关卡筛选。
 * 失败返回 null（调用方据此提示连通性问题）。
 */
export async function getRoomsInfo(baseUrl: string, chapterId?: number, stageId?: number): Promise<RoomInfo[] | null> {
    const address = normalizeServerAddress(baseUrl);
    if (!address) {
        return null;
    }

    const params = new URLSearchParams();
    if (typeof chapterId === "number") {
        params.set("chapter_id", String(chapterId));
    }
    if (typeof stageId === "number") {
        params.set("stage_id", String(stageId));
    }
    const query = params.toString();
    const url = `https://${address}/list${query ? `?${query}` : ""}`;

    try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
            console.error("Error fetching rooms:", response.status, response.statusText);
            return null;
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            return null;
        }
        return data
            .map(normalizeRoomInfo)
            .filter((room): room is RoomInfo => room !== null);
    } catch (error) {
        console.error("Error fetching rooms:", error);
        return null;
    }
}

/**
 * 查询昵称对应的玩家是否仍在某个房间中。
 * 返回 null 表示不在任何房间（或服务器不可达）。
 */
export async function queryMyRoom(baseUrl: string, username: string): Promise<UserRoomMembership | null> {
    const address = normalizeServerAddress(baseUrl);
    if (!address || !username) {
        return null;
    }
    const params = new URLSearchParams({ user: username });
    try {
        const response = await fetch(`https://${address}/user-room?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        if (!data || typeof data !== "object" || typeof data.room_id !== "number") {
            return null;
        }
        return {
            roomId: data.room_id,
            myId: Number(data.my_id) || 0,
            key: typeof data.key === "string" ? data.key : "",
            roomName: typeof data.room_name === "string" ? data.room_name : "",
            chapterId: Number(data.chapter_id) || 0,
            stageId: Number(data.stage_id) || 0,
            stage: Number(data.stage) || 0,
        };
    } catch (error) {
        console.error("Error querying user room:", error);
        return null;
    }
}

/** 玩家选择“不重连”时，请服务端把自己从房间里彻底移除。 */
export async function leaveRoomRemotely(
    baseUrl: string,
    username: string,
    destroyRoom = false,
    identity?: { roomId: number },
): Promise<boolean> {
    const address = normalizeServerAddress(baseUrl);
    if (!address || (!username && !identity)) {
        return false;
    }
    // destroy=1：对局中主动退出，服务端取消整个房间，对方看到离线且无法重连。
    const params = new URLSearchParams({ user: username });
    if (destroyRoom) {
        params.set('destroy', '1');
    }
    if (identity && identity.roomId >= 0) {
        params.set('room_id', String(identity.roomId));
    }
    try {
        const response = await fetch(`https://${address}/user-room/leave?${params.toString()}`, {
            method: "POST",
            cache: "no-store",
        });
        if (!response.ok) {
            return false;
        }
        const data = await response.json();
        return Boolean(data?.ok);
    } catch (error) {
        console.error("Error leaving user room:", error);
        return false;
    }
}

/**
 * 对局中确认退出：优先用当前 WebSocket 连接地址（可能来自 URL 参数，未写入存档），
 * 以昵称请服务端永久离房并取消整个房间。
 */
export async function leaveRoomAndDestroy(username: string, fallbackBaseUrl = ''): Promise<boolean> {
    if (!username) return false;
    // 当前连接的 wss://host/ws?... 是权威来源：可能带 URL 参数或与存档不同步。
    const url = BackendWS.url ? new URL(BackendWS.url) : null;
    const fromSocket = url?.host ?? '';
    const connectedUser = url?.searchParams.get('user') || username;
    const baseUrl = fromSocket || normalizeServerAddress(fallbackBaseUrl);
    return leaveRoomRemotely(baseUrl, connectedUser, true, {
        roomId: onlineStateManager.getRoomInfo().roomId,
    });
}

export type RoomSessionOptions = {
    baseUrl: string;
    /** 加入已有房间时必填；建房留空 */
    roomId?: number;
    /** 建房时的房间名 */
    roomName?: string;
    /** 房间密码，空表示公开房间 */
    key?: string;
    chapterId?: number;
    stageId?: number;
    /** 联机昵称，仅用于房间内展示 */
    username?: string;
    /** 从主页会话检查发起的重连：复用原玩家席位 */
    reconnect?: boolean;
    /** 重连时的原玩家 ID */
    myId?: number;
};

function buildRoomUrl(options: RoomSessionOptions): string {
    const address = normalizeServerAddress(options.baseUrl);
    const key = encodeURIComponent(normalizeRoomKey(options.key || ""));
    const user = encodeURIComponent(options.username || "");
    if (typeof options.roomId === "number" && options.roomId >= 0) {
        const base = `wss://${address}/ws?id=${options.roomId}&key=${key}&user=${user}`;
        if (options.reconnect && typeof options.myId === "number" && options.myId > 0) {
            return `${base}&reconnect=1&my_id=${options.myId}`;
        }
        return base;
    }
    const name = encodeURIComponent(normalizeRoomName(options.roomName || ""));
    const chapterId = options.chapterId ?? 0;
    const stageId = options.stageId ?? 0;
    return `wss://${address}/ws?create=1&name=${name}&key=${key}&chapter_id=${chapterId}&stage_id=${stageId}&user=${user}`;
}

function ensureNotConnected(): boolean {
    if (BackendWS.isRoomSessionMode()) {
        void showAlert("请先离开当前房间");
        return false;
    }
    return true;
}

/** 创建房间并连接：房间名、密码与绑定关卡会随连接参数提交 */
export function createRoom(options: RoomSessionOptions): boolean {
    if (!ensureNotConnected()) {
        return false;
    }
    const address = normalizeServerAddress(options.baseUrl);
    if (!address) {
        void showAlert("请先在设置 → 联机中连接服务器");
        return false;
    }
    BackendWS.key = normalizeRoomKey(options.key || "");
    BackendWS.setConnectionUrl(buildRoomUrl(options));
    BackendWS.startConnection();
    return true;
}

/** 加入已有房间 */
export function joinRoom(options: RoomSessionOptions): boolean {
    if (!ensureNotConnected()) {
        return false;
    }
    const address = normalizeServerAddress(options.baseUrl);
    if (!address) {
        void showAlert("请先在设置 → 联机中连接服务器");
        return false;
    }
    BackendWS.key = normalizeRoomKey(options.key || "");
    BackendWS.setConnectionUrl(buildRoomUrl(options));
    BackendWS.startConnection();
    return true;
}
