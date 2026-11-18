/**
 * 在线状态相关的类型定义
 */

// 玩家信息（与后端 PeerInfo 结构对应）
export interface PeerInfo {
    addr: string; // 连接地址，如 "192.168.1.100:12345"
    id: number;   // 玩家ID
    name?: string;  // 联机昵称
    ready?: boolean; // 是否已准备
}

// 房间绑定信息（等待房间展示用）
export interface RoomMeta {
    roomName: string;
    chapterId: number;
    stageId: number;
}

// 房间信息
export interface RoomInfo {
    roomId: number;
    myId: number;
    lordId: number;
    peers: string;              // 原始JSON字符串
    peersData: PeerInfo[] | null; // 解析后的玩家数据
    playerCount: number;        // 玩家数量
}

// 游戏阶段枚举（与后端保持一致）
export enum GameStage {
    InLobby = 0x20,   // 大厅/等待中
    Preparing = 0x21, // 准备中（选卡阶段）
    Loading = 0x22,   // 加载中
    InGame = 0x23,    // 游戏中
    PostGame = 0x24,  // 游戏后结算
    Closed = 0xEE,    // 房间关闭
    Error = 0xFF      // 错误状态
}

// EventBus 事件数据类型
export interface LobbyJoinSuccessEvent {
    roomId: number;
    myId: number;
    key: string;
    message: string;
}

export interface RoomChooseMapEvent {
    chapterId: number;
    stageId: number;
}

export interface RoomUpdateReadyCountEvent {
    readyCount: number;
    totalPlayers: number;
}

export interface RoomAllReadyEvent {
    allPlayerCount: number;
    seed: number;
    myId: number;
    playerIds: number[];
    /** 服务端规范化后的全员开局配置 */
    loadouts?: import("../pb/common").PlayerLoadout[];
    /** 房间与关卡信息：页面刷新后用于重建 GameParams */
    roomId?: number;
    chapterId?: number;
    stageId?: number;
}

/** Loading 阶段每位玩家的加载进度 */
export interface PlayerSyncInfo {
    playerId: number;
    progress: number;   // 1..100，100=完全加载好
    name: string;
    loaded: boolean;
}

export interface RoomSyncEvent {
    players: PlayerSyncInfo[];
}

export interface RoomGameStartEvent {
    seed: number;
    myID: number;
}

export interface RoomGameEndEvent {
    isWin: boolean;
}

export interface RoomClosedEvent {
    message: string;
}

export interface RoomErrorEvent {
    message: string;
}
