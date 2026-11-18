// WebSocketClient 门面：保留原有的全部对外 API，内部委托给拆分后的模块。
// 传输（transport.ts）、重连策略（reconnect_controller.ts）、
// 消息路由（message_router.ts）、业务处理（handlers.ts）各司其职。

import QueueReceive from "../../game/sync/queue_receive";
import QueueSend from "../../game/sync/queue_send";
import { Request } from "../../pb/request";
import { InGameResponse } from "../../pb/response";
import { PhaserEventBus, PhaserEvents } from "../../game/EventBus";
import { onlineStateManager } from "../../store/OnlineStateManager";
import EnumGameStage from "./game_state";
import WSClientHandlers from "./handlers";
import mockServer, { MockPacket } from "./mock_server";
import { WebSocketTransport } from "./transport";
import { ReconnectController } from "./reconnect_controller";
import { routeIncoming, ResponseKind } from "./message_router";
import { isNetDebugEnabled } from "../debugFlags";
import { desyncDiagnostics } from "../debug/desyncDiagnostics";
import type { InlineSnapshot } from "../../game/core/snapshot/InlineSnapshot";

class WebSocketClient {
  private transport = new WebSocketTransport();
  private handlers: WSClientHandlers = new WSClientHandlers(this);

  private receiveQueue: QueueReceive | null = null;
  private sendQueue: QueueSend | null = null;
  private mockRoomMode: boolean = false;
  public url: string = "";

  private messageCounter: number = 0;
  private debugLatencyConfig = {
    sendLatencyMs: 0,
    receiveLatencyMs: 0,
  };
  private pendingSendTimers: Set<number> = new Set();
  private pendingReceiveTimers: Set<number> = new Set();
  private pendingInGameResponses: InGameResponse[] = [];
  /**
   * 重连快照可能在 Game 场景/CombatManager 尚未创建时到达（页面刷新后的
   * Preload 阶段）。必须缓存到 SyncManager.setQueue 之后再派发，
   * 否则快照恢复事件会被丢掉，客户端会从空世界重跑开局预设。
   */
  private pendingReplaySnapshot: { snapshot: InlineSnapshot; frameId: number } | null = null;
  /**
   * 战局状态源/Rapier 世界是否已经就绪。
   *
   * 页面刷新后 replay 快照可能在 Manager.Load() 阶段就到达，此时
   * installRuntimeStateSources() 尚未执行，提前 restore 会得到空世界，
   * 随后又从 checkpoint+1 开始补帧，必然立刻分叉。先缓存，等
   * Game.prepareBattle 完成状态源/物理注册后再派发。
   */
  private replaySnapshotReady: boolean = true;

  // 重连状态：由 reconnect controller 管理，这里保留只读访问入口
  private reconnect: ReconnectController;
  private offlineMode: "none" | "desync" = "none";
  private latencySamples: number[] = [];
  private static readonly MAX_LATENCY_SAMPLES = 30;
  private lastSentAt: number = 0;

  // 测试钩子：netDebug 开关开启时暴露
  private static instance: WebSocketClient | null = null;
  private readonly routeTracingEnabled: boolean;
  private readonly netDebugEnabled: boolean;

  constructor() {
    try {
      this.routeTracingEnabled = new URLSearchParams(
        typeof location !== "undefined" ? location.search : "",
      ).get("traceRoutes") === "1";
    } catch {
      this.routeTracingEnabled = false;
    }
    this.reconnect = new ReconnectController({
      baseUrl: () => this.url || null,
      buildReconnectUrl: () => this.buildReconnectUrl(),
      onAttempt: (attempt, delay) => this.onReconnectAttempt(attempt, delay),
      onGiveUp: (reason) => this.giveUpReconnect(reason),
    });
    this.reconnect.setConnectHandler((url) => this.openSocket(url, true));
    // 网络字节诊断只在 netDebug 开关开启时记录；
    // 收包解码/路由不使用这段缓冲，改造不影响同步。
    this.netDebugEnabled = this.routeTracingEnabled || isNetDebugEnabled();
    WebSocketClient.instance = this;
  }

  /** 供测试调整重连参数（test hook）。 */
  public configureReconnectForTest(options: { baseDelayMs?: number; maxDelayMs?: number; maxAttempts?: number }): void {
    // ReconnectController 的配置在构造时注入，重建一个实例
    this.reconnect.cancel();
    this.reconnect = new ReconnectController({
      baseUrl: () => this.url || null,
      buildReconnectUrl: () => this.buildReconnectUrl(),
      onAttempt: (attempt, delay) => this.onReconnectAttempt(attempt, delay),
      onGiveUp: (reason) => this.giveUpReconnect(reason),
      ...options,
    });
    this.reconnect.setConnectHandler((url) => this.openSocket(url, true));
    this.publishNetworkStatus();
  }

  private publishNetworkStatus(): void {
    // 发布结构化状态：UI 与测试都通过 PhaserEventBus 订阅
    PhaserEventBus.emit(PhaserEvents.OnlineNetworkStatus, {
      reconnecting: this.reconnect.isReconnecting(),
      reconnectAttempt: this.reconnect.getAttempt(),
      latencyMs: this.getAverageLatencyMs(),
      offlineMode: this.offlineMode,
    });
  }

  private trace(_message: string, _details?: unknown) {
    // 调试日志关闭；需要时在此打开
  }

  /** E2E 诊断：记录最近一次消息路由类型，netDebug=1 时可从 MVZ_NET 读取 */
  private recentRoutes: Array<{ kind: string; firstBytes: number[]; size: number }> = [];
  private traceRoute(kind: string, data: Uint8Array): void {
    if (!this.routeTracingEnabled) return;
    this.recentRoutes.push({ kind, firstBytes: Array.from(data.slice(0, 12)), size: data.byteLength });
    if (this.recentRoutes.length > 20) this.recentRoutes.shift();
  }
  public getRecentRoutesForTest() { return [...this.recentRoutes]; }

  setQueue(receiveQueue: QueueReceive, sendQueue: QueueSend) {
    this.receiveQueue = receiveQueue;
    this.sendQueue = sendQueue;
    desyncDiagnostics.record("net", "setQueue", {
      pendingInGameResponses: this.pendingInGameResponses.length,
      pendingReplaySnapshot: this.pendingReplaySnapshot !== null,
    });
    this.trace("setQueue bound", { pendingInGameResponses: this.pendingInGameResponses.length });
    // 必须先恢复快照，再把缓存帧灌进接收队列。
    // restoreToFrame 会重建/裁剪接收队列；如果先灌帧，随后到达的
    // 快照恢复会把刚刚排队的未来帧清掉，重连后便卡在缺失帧上。
    this.flushPendingReplaySnapshot();
    this.flushPendingInGameResponses();
  }

  getReceiveQueue() {
    return this.receiveQueue;
  }

  enqueuePendingInGameResponse(response: InGameResponse) {
    this.pendingInGameResponses.push(response);
    this.flushPendingInGameResponses();
  }

  enqueuePendingReplaySnapshot(data: { snapshot: InlineSnapshot; frameId: number }) {
    this.pendingReplaySnapshot = data;
    this.flushPendingReplaySnapshot();
  }

  /** 由 Game.prepareBattle 在状态源与物理世界注册完成后调用。 */
  public setReplaySnapshotReady(ready: boolean): void {
    this.replaySnapshotReady = ready;
    if (ready) this.flushPendingReplaySnapshot();
  }

  private flushPendingReplaySnapshot() {
    if (!this.receiveQueue || !this.pendingReplaySnapshot || !this.replaySnapshotReady) return;
    const data = this.pendingReplaySnapshot;
    this.pendingReplaySnapshot = null;
    PhaserEventBus.emit(PhaserEvents.ReplaySnapshotReceived, data);
  }

  getDebugLatencyConfig() {
    return { ...this.debugLatencyConfig };
  }

  setDebugSendLatencyMs(latencyMs: number) {
    this.debugLatencyConfig.sendLatencyMs = Math.max(0, Math.floor(latencyMs));
  }

  setDebugReceiveLatencyMs(latencyMs: number) {
    this.debugLatencyConfig.receiveLatencyMs = Math.max(0, Math.floor(latencyMs));
  }

  isLord() {
    return onlineStateManager.isLord();
  }

  public GetFrameID() {
    return this.receiveQueue?.currentFrameId ?? 0;
  }

  public GetNextFrameID() {
    return (this.receiveQueue?.currentFrameId ?? 0) + 1;
  }

  public GoToFrameID(target: number = this.GetFrameID() + 1) {
    if (this.receiveQueue) {
      this.receiveQueue.currentFrameId = target;
    }
  }

  public ResetGameData() {
    onlineStateManager.resetGameData();
    this.pendingInGameResponses = [];
    this.pendingReplaySnapshot = null;
    if (this.receiveQueue) {
      this.receiveQueue.currentFrameId = 0;
      this.receiveQueue.lastAckFrameId = 0;
    }
  }

  private dispatchMockPackets(packets: MockPacket[]) {
    for (const packet of packets) {
      switch (packet.channel) {
        case 'lobby':
          this.scheduleIncomingPacket(() => this.handlers.handleLobbyResponse(packet.data));
          break;
        case 'room':
          this.scheduleIncomingPacket(() => this.handlers.handleRoomResponse(packet.data));
          break;
        case 'ingame':
          this.scheduleIncomingPacket(() => this.handlers.handleInGameResponse(packet.data));
          break;
      }
    }
  }

  private trackTimer(timerSet: Set<number>, callback: () => void, delayMs: number) {
    const timerId = window.setTimeout(() => {
      timerSet.delete(timerId);
      callback();
    }, delayMs);
    timerSet.add(timerId);
  }

  private scheduleIncomingPacket(handler: () => void) {
    const delayMs = this.debugLatencyConfig.receiveLatencyMs;
    if (delayMs <= 0) {
      handler();
      return;
    }
    this.trackTimer(this.pendingReceiveTimers, handler, delayMs);
  }

  private clearPendingTimers() {
    for (const timerId of this.pendingSendTimers) window.clearTimeout(timerId);
    this.pendingSendTimers.clear();
    for (const timerId of this.pendingReceiveTimers) window.clearTimeout(timerId);
    this.pendingReceiveTimers.clear();
  }

  private flushPendingInGameResponses() {
    if (!this.receiveQueue || this.pendingInGameResponses.length === 0) return;
    for (const response of this.pendingInGameResponses) {
      this.receiveQueue.handleInGameResponse(response);
    }
    this.pendingInGameResponses = [];
  }

  private dispatchBinaryMessage(message: Uint8Array<ArrayBufferLike>) {
    if (this.transport.send(message)) return;
    if (this.mockRoomMode && mockServer.isActive()) {
      const packets = mockServer.handleMessage(message);
      this.dispatchMockPackets(packets);
      return;
    }
    // 断线重连期间包会被丢弃；服务端补帧后客户端会重新发送当前 ACK。
  }

  public startSinglePlayerRoom() {
    if (this.mockRoomMode) return;
    desyncDiagnostics.record("net", "startSinglePlayerRoom");
    this.ResetGameData();
    this.mockRoomMode = true;
    this.dispatchMockPackets(mockServer.startSingleRoom());
  }

  /** 分叉后进入不可恢复的离线单机模式 */
  public enterDesyncOfflineMode(): void {
    desyncDiagnostics.record("net", "enterDesyncOfflineMode", {
      roomId: this.room_id,
      myId: this.my_id,
      frameId: this.GetFrameID(),
      ackFrameId: this.AckFrameID,
    });
    this.offlineMode = "desync";
    this.reconnect.cancel();
    this.clearPendingTimers();
    this.transport.close();
    onlineStateManager.updateGameStage(EnumGameStage.InGame);
    this.mockRoomMode = false;
    this.receiveQueue = null;
    this.sendQueue = null;
    this.publishNetworkStatus();
  }

  public exitDesyncOfflineMode(): void {
    desyncDiagnostics.record("net", "exitDesyncOfflineMode", {
      roomId: this.room_id,
      myId: this.my_id,
    });
    this.offlineMode = "none";
    this.publishNetworkStatus();
  }

  public isDesyncOfflineMode(): boolean {
    return this.offlineMode === "desync";
  }

  public getReconnectAttempt(): number {
    return this.reconnect.getAttempt();
  }

  public isReconnecting(): boolean {
    return this.reconnect.isReconnecting();
  }

  public recordLatencySample(sampleMs: number): void {
    if (!Number.isFinite(sampleMs) || sampleMs < 0) return;
    this.latencySamples.push(Math.round(sampleMs));
    if (this.latencySamples.length > WebSocketClient.MAX_LATENCY_SAMPLES) {
      this.latencySamples.shift();
    }
  }

  public getAverageLatencyMs(): number | null {
    if (this.latencySamples.length === 0) return null;
    const sum = this.latencySamples.reduce((total, value) => total + value, 0);
    return Math.round(sum / this.latencySamples.length);
  }

  public closeMockRoom() {
    if (!this.mockRoomMode) return;
    this.clearPendingTimers();
    this.mockRoomMode = false;
    mockServer.stop();
    this.ResetGameData();
  }

  setConnectionUrl(url: string) {
    this.url = url;
  }

  startConnection() {
    desyncDiagnostics.record("net", "startConnection", { url: this.url });
    this.ResetGameData();
    onlineStateManager.updateRoomInfo(-1, 51, 50);
    if (onlineStateManager.getIsOnlineMode()) {
      console.error("WebSocket connection already established.");
      return;
    }
    if (!this.url) {
      console.error("WebSocket URL not set!");
      return;
    }
    this.reconnect.cancel();
    this.openSocket(this.url, false);
  }

  /** 打开一条连接；所有回调都在 transport 内绑定到该 socket 实例。 */
  private openSocket(url: string, isReconnect: boolean) {
    if (!url) {
      console.error("WebSocket URL not available for", isReconnect ? "reconnect" : "connection");
      if (isReconnect) this.giveUpReconnect("无法构造重连地址");
      return;
    }

    this.transport.setCallbacks({
      onOpen: () => {
        desyncDiagnostics.record("net", "socket open", {
          isReconnect,
          url,
          frameId: this.GetFrameID(),
          ackFrameId: this.AckFrameID,
        });
        if (this.netDebugEnabled) {
          console.log(isReconnect ? "WebSocket reconnected." : "WebSocket connection established.");
        }
        if (isReconnect) {
          this.reconnect.markConnected();
          onlineStateManager.updateOnlineMode(true);
          // 立刻用当前帧/ACK 触发服务端从断点补发
          this.sendQueue?.sendBlankFrame(this.receiveQueue?.currentFrameId ?? 0);
          this.sendQueue?.Consume();
        }
        this.publishNetworkStatus();
      },
      onMessage: (data) => {
        if (this.netDebugEnabled) desyncDiagnostics.recordNetwork("recv", data, "websocket");
        this.messageCounter++;
        if (this.lastSentAt > 0) this.recordLatencySample(performance.now() - this.lastSentAt);
        this.scheduleIncomingPacket(() => {
          try {
            // 统一路由：不再按“是否重连 socket”或首字节散落分流
            const kind = routeIncoming(
              data,
              {
                getStage: () => onlineStateManager.getCurrentGameStage(),
                isOnline: () => onlineStateManager.getIsOnlineMode(),
                isRoomSession: () => this.isRoomSessionMode(),
              },
              {
                handleLobbyResponse: (msg) => { this.traceRoute('lobby', data); this.handlers.handleLobbyResponse(msg); },
                handleRoomResponse: (msg) => { this.traceRoute('room', data); this.handlers.handleRoomResponse(msg); },
                handleInGameResponse: (msg) => { this.traceRoute('ingame', data); this.handlers.handleInGameResponse(msg); },
              },
            );
            this.trace("routed", { kind, size: data.byteLength } as { kind: ResponseKind; size: number });
          } catch (e) {
            console.error("Failed to parse Protobuf message:", e);
            // net 层不再直接弹 alert：统一发事件，由 UI 层呈现
            PhaserEventBus.emit(PhaserEvents.RoomError, {
              message: "发生错误，请检查网络或服务器: " + (e instanceof Error ? e.message : String(e)),
            });
            this.closeConnection();
          }
        });
      },
      onError: (error) => {
        desyncDiagnostics.record("net", "socket error", { error });
        console.error("WebSocket error: ", error);
      },
      onClose: (event) => {
        desyncDiagnostics.record("net", "socket close", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          onlineMode: onlineStateManager.getIsOnlineMode(),
          gameStage: onlineStateManager.getGameStageName(),
        });
        this.clearPendingTimers();
        if (this.offlineMode === "desync") return;
        const stage = onlineStateManager.getCurrentGameStage();
        if (this.netDebugEnabled) {
          console.log("WebSocket connection closed:", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            onlineMode: onlineStateManager.getIsOnlineMode(),
            gameStage: onlineStateManager.getGameStageName(),
          });
        }

        // 正在主动关闭/放弃时不应重连
        if (stage === EnumGameStage.InGame || stage === EnumGameStage.Loading) {
          if (this.reconnect.schedule()) {
            this.publishNetworkStatus();
            return;
          }
        }
        onlineStateManager.updateOnlineMode(false);
        this.publishNetworkStatus();
      },
    });

    this.transport.open(url, isReconnect);
  }

  private buildReconnectUrl(): string | null {
    const { roomId, myId } = onlineStateManager.getRoomInfo();
    const key = onlineStateManager.getConnectionKey();
    if (roomId < 0 || myId <= 0 || !this.url) return null;
    const base = this.url.split("?")[0];
    return `${base}?id=${roomId}&key=${encodeURIComponent(key)}&reconnect=1&my_id=${myId}`;
  }

  private onReconnectAttempt(attempt: number, delayMs: number): void {
    desyncDiagnostics.record("net", "reconnect attempt", { attempt, delayMs });
    if (this.netDebugEnabled) {
      console.log(`[BackendWS] reconnect attempt ${attempt} in ${delayMs}ms`);
    }
    this.publishNetworkStatus();
  }

  private giveUpReconnect(message: string): void {
    desyncDiagnostics.record("net", "giveUpReconnect", { message });
    this.reconnect.cancel();
    onlineStateManager.updateOnlineMode(false);
    this.publishNetworkStatus();
    PhaserEventBus.emit(PhaserEvents.RoomClosed, { message });
  }

  sendMessage(message: string) {
    desyncDiagnostics.record("net", "sendMessage(text)", { message });
    if (this.transport.isOpen()) {
      this.transport.currentSocket()!.send(message);
    } else {
      console.error("WebSocket is not open. Cannot send message.");
    }
  }

  sendBlankFrame(frameId: number) {
    if (this.sendQueue) {
      this.sendQueue.sendBlankFrame(frameId);
    } else {
      console.error("sendQueue not available. Cannot send blank frame.");
    }
  }

  send(message: Uint8Array<ArrayBufferLike>) {
    if (this.netDebugEnabled) desyncDiagnostics.recordNetwork("send", message, "websocket");
    const sendNow = () => this.dispatchBinaryMessage(message);
    this.lastSentAt = performance.now();

    const delayMs = this.debugLatencyConfig.sendLatencyMs;
    if (delayMs <= 0) {
      sendNow();
      return;
    }
    this.trackTimer(this.pendingSendTimers, sendNow, delayMs);
  }

  consumeSendQueue() {
    if (!this.sendQueue) return;
    if (this.transport.isOpen() || this.mockRoomMode) {
      while (!this.sendQueue.queues.isEmpty()) {
        const message = this.sendQueue.queues.shift();
        if (message) {
          this.send(Request.toBinary(message));
        }
      }
    } else {
      console.error("No active transport. Cannot consume send queue.");
    }
  }

  closeConnection() {
    desyncDiagnostics.record("net", "closeConnection", {
      roomId: this.room_id,
      myId: this.my_id,
      frameId: this.GetFrameID(),
      ackFrameId: this.AckFrameID,
      offlineMode: this.offlineMode,
    });
    this.reconnect.cancel();
    this.clearPendingTimers();
    if (this.mockRoomMode) {
      this.closeMockRoom();
      return;
    }
    if (this.offlineMode === "desync") {
      this.exitDesyncOfflineMode();
    }
    if (this.transport.currentSocket()) {
      this.transport.close();
    }
    // 无论是否还有底层 socket，都必须清空会话状态；
    // 否则 desync/掉线后回主页会出现“无法建房也无法回房”的幽灵会话。
    onlineStateManager.resetAllState();
    this.ResetGameData();
    this.publishNetworkStatus();
  }

  disconnectQueues() {
    this.receiveQueue = null;
    this.sendQueue = null;
    this.pendingInGameResponses = [];
    this.pendingReplaySnapshot = null;
  }

  hasConnected() {
    return onlineStateManager.getIsOnlineMode();
  }

  get key(): string {
    return onlineStateManager.getConnectionKey();
  }

  set key(value: string) {
    onlineStateManager.updateConnectionKey(value);
  }

  get room_id(): number {
    return onlineStateManager.getRoomInfo().roomId;
  }

  get my_id(): number {
    return onlineStateManager.getRoomInfo().myId;
  }

  get lord_id(): number {
    return onlineStateManager.getRoomInfo().lordId;
  }

  get FrameID(): number {
    return this.GetFrameID();
  }

  set FrameID(value: number) {
    if (this.receiveQueue) this.receiveQueue.currentFrameId = value;
  }

  get AckFrameID(): number {
    return this.receiveQueue?.lastAckFrameId ?? 0;
  }

  set AckFrameID(value: number) {
    if (this.receiveQueue) this.receiveQueue.lastAckFrameId = value;
  }

  isOnlineMode(): boolean {
    return !this.isMockRoomMode() && onlineStateManager.getIsOnlineMode() && !this.isDesyncOfflineMode();
  }

  isMockRoomMode(): boolean {
    return this.mockRoomMode;
  }

  isRoomSessionMode(): boolean {
    return this.isOnlineMode() || this.isMockRoomMode();
  }

  /** 测试钩子：只断开底层 socket，不取消重连策略，也不重置业务状态。 */
  public dropSocketForTest(): void {
    const socket = this.transport.currentSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(4000, 'e2e-drop');
    }
  }

  /** 测试钩子：走与真实重连放弃相同的 UI 提示链路。 */
  public giveUpReconnectForTest(reason: string): void {
    this.giveUpReconnect(reason);
  }

  /** 测试钩子：返回单例（仅在 netDebug 模式由 index 注入到 window） */
  static getInstance(): WebSocketClient | null {
    return WebSocketClient.instance;
  }
}

const BackendWS = new WebSocketClient();

export function HasConnected() {
  return BackendWS.hasConnected();
}

export { WebSocketClient };
export default BackendWS;
