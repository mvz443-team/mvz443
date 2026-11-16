import QueueReceive from "../../game/sync/queue_receive";
import QueueSend from "../../game/sync/queue_send";
import { Request } from "../../pb/request";
import { InGameResponse } from "../../pb/response";
import EnumGameStage from "./game_state";
import WSClientHandlers from "./handlers";
import { onlineStateManager } from "../../store/OnlineStateManager";
import { PhaserEventBus, PhaserEvents } from "../../game/EventBus";
import mockServer, { MockPacket } from "./mock_server";

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: WSClientHandlers = new WSClientHandlers(this);

  private receiveQueue: QueueReceive | null = null;
  private sendQueue: QueueSend | null = null;
  private mockRoomMode: boolean = false;
  public url: string = "";

  private messageCounter: number = 0;
  private debugLatencyConfig = {
    sendLatencyMs: 0,
    receiveLatencyMs: 0
  };
  private pendingSendTimers: Set<number> = new Set();
  private pendingReceiveTimers: Set<number> = new Set();
  private pendingInGameResponses: InGameResponse[] = [];

  // 断线重连状态：InGame 掉线后保留本地战局，按退避重连并请求补帧。
  private reconnectAttempt: number = 0;
  private reconnectTimer: number | null = null;
  private isReconnecting: boolean = false;
  private static readonly MAX_RECONNECT_ATTEMPTS = 12;

  private trace(message: string, details?: unknown) {
    if (details !== undefined) {
      // console.log(`[BackendWS] ${message}`, details);
      return;
    }
    // console.log(`[BackendWS] ${message}`);
  }

  setQueue(receiveQueue: QueueReceive, sendQueue: QueueSend) {
    this.receiveQueue = receiveQueue;
    this.sendQueue = sendQueue;
    this.trace("setQueue bound", {
      pendingInGameResponses: this.pendingInGameResponses.length
    });
    this.flushPendingInGameResponses();
  }

  getReceiveQueue() {
    return this.receiveQueue;
  }

  enqueuePendingInGameResponse(response: InGameResponse) {
    this.pendingInGameResponses.push(response);
    this.trace("buffered ingame response before queue binding", {
      frameId: response.frameId,
      bufferedCount: this.pendingInGameResponses.length
    });
    this.flushPendingInGameResponses();
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
    if (this.receiveQueue) {
      this.receiveQueue.currentFrameId = 0;
      this.receiveQueue.lastAckFrameId = 0;
    }
  }

  private dispatchMockPackets(packets: MockPacket[]) {
    this.trace("dispatchMockPackets", {
      packetCount: packets.length,
      channels: packets.map(packet => packet.channel)
    });
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
        default:
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
    this.trace("schedule incoming packet", { delayMs });
    this.trackTimer(this.pendingReceiveTimers, handler, delayMs);
  }

  private clearPendingTimers() {
    for (const timerId of this.pendingSendTimers) {
      window.clearTimeout(timerId);
    }
    this.pendingSendTimers.clear();

    for (const timerId of this.pendingReceiveTimers) {
      window.clearTimeout(timerId);
    }
    this.pendingReceiveTimers.clear();
  }

  private flushPendingInGameResponses() {
    if (!this.receiveQueue || this.pendingInGameResponses.length === 0) {
      return;
    }
    this.trace("flush pending ingame responses", {
      count: this.pendingInGameResponses.length
    });
    for (const response of this.pendingInGameResponses) {
      this.receiveQueue.handleInGameResponse(response);
    }
    this.pendingInGameResponses = [];
  }

  private dispatchBinaryMessage(message: Uint8Array<ArrayBufferLike>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.trace("send binary via websocket", {
        byteLength: message.byteLength
      });
      // slice() 生成只包含当前视图字节的独立 ArrayBuffer，
      // 避免 message 是更大 buffer 视图时把无关字节一起发送。
      this.ws.send(message.slice().buffer as ArrayBuffer);
      return;
    }

    if (this.mockRoomMode && mockServer.isActive()) {
      this.trace("send binary to mock server", {
        byteLength: message.byteLength
      });
      const packets = mockServer.handleMessage(message);
      this.dispatchMockPackets(packets);
      return;
    }

    // 断线重连期间包会被丢弃；服务端补帧后客户端会重新发送当前 ACK。
    this.trace("drop outgoing message: no active transport");
  }

  public startSinglePlayerRoom() {
    if (this.mockRoomMode) {
      return;
    }
    this.trace("startSinglePlayerRoom");
    this.ResetGameData();
    this.mockRoomMode = true;
    this.dispatchMockPackets(mockServer.startSingleRoom());
  }

  public closeMockRoom() {
    if (!this.mockRoomMode) {
      return;
    }
    this.clearPendingTimers();
    this.mockRoomMode = false;
    mockServer.stop();
    this.ResetGameData();
  }

  setConnectionUrl(url: string) {
    this.url = url;
  }

  startConnection() {
    console.log('try to link');
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

    this.openSocket(false);
  }

  private openSocket(reconnect: boolean) {
    const url = reconnect ? this.buildReconnectUrl() : this.url;
    if (!url) {
      console.error("WebSocket URL not available for", reconnect ? "reconnect" : "connection");
      if (reconnect) this.giveUpReconnect("无法构造重连地址");
      return;
    }

    this.isReconnecting = reconnect;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log(reconnect ? "WebSocket reconnected." : "WebSocket connection established.");
      this.isReconnecting = false;
      if (reconnect) {
        this.reconnectAttempt = 0;
        onlineStateManager.updateOnlineMode(true);
        // 立刻用当前帧/ACK 触发服务端从断点补发
        this.sendQueue?.sendBlankFrame(this.receiveQueue?.currentFrameId ?? 0);
        this.sendQueue?.Consume();
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.messageCounter++;
      if (!(event.data instanceof ArrayBuffer)) {
        console.warn(`Message #${this.messageCounter}: Received non-binary message, ignoring:`, event.data);
        return;
      }

      const data = new Uint8Array(event.data);
      this.scheduleIncomingPacket(() => {
        try {
          if (reconnect) {
            // 重连期间服务端只补发 InGameResponse，不发送 JoinRoomSuccess。
            if (onlineStateManager.getCurrentGameStage() === EnumGameStage.InGame) {
              this.handlers.handleInGameResponse(data);
            } else {
              this.handlers.handleRoomResponse(data);
            }
            return;
          }
          if (!onlineStateManager.getIsOnlineMode()) {
            this.handlers.handleLobbyResponse(data);
          } else {
            switch (onlineStateManager.getCurrentGameStage()) {
              case EnumGameStage.InLobby:
              case EnumGameStage.Preparing:
              case EnumGameStage.Loading:
                this.handlers.handleRoomResponse(data);
                break;
              case EnumGameStage.InGame:
                this.handlers.handleInGameResponse(data);
                break;
              case EnumGameStage.PostGame:
                break;
              default:
                console.error("Unknown game stage:", onlineStateManager.getCurrentGameStage());
                break;
            }
          }
        } catch (e) {
          console.error("Failed to parse Protobuf message:", e);
          alert("发生错误,请检查网络或服务器: " + (e instanceof Error ? e.message : String(e)));
          this.closeConnection();
        }
      });
    };

    this.ws.onerror = (error: Event) => {
      console.error("WebSocket error: ", error);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.clearPendingTimers();
      this.ws = null;
      const stage = onlineStateManager.getCurrentGameStage();
      console.log("WebSocket connection closed:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        timeStamp: new Date().toISOString(),
        onlineMode: onlineStateManager.getIsOnlineMode(),
        gameStage: onlineStateManager.getGameStageName(),
        roomInfo: onlineStateManager.getRoomInfo()
      });

      this.isReconnecting = false;
      // InGame/Loading 掉线时不销毁本地战局，保留状态等待补帧重连。
      if (stage === EnumGameStage.InGame || stage === EnumGameStage.Loading) {
        this.scheduleReconnect();
        return;
      }
      onlineStateManager.updateOnlineMode(false);
    };
  }

  private buildReconnectUrl(): string | null {
    const { roomId, myId } = onlineStateManager.getRoomInfo();
    const key = onlineStateManager.getConnectionKey();
    if (roomId < 0 || myId <= 0 || !this.url) return null;
    const base = this.url.split("?")[0];
    return `${base}?id=${roomId}&key=${encodeURIComponent(key)}&reconnect=1&my_id=${myId}`;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempt >= WebSocketClient.MAX_RECONNECT_ATTEMPTS) {
      this.giveUpReconnect("网络中断，重连超时");
      return;
    }
    const delay = Math.min(5000, 300 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    console.log(`[BackendWS] reconnect attempt ${this.reconnectAttempt} in ${delay}ms`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(true);
    }, delay);
  }

  private cancelReconnect() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.isReconnecting = false;
  }

  private giveUpReconnect(message: string) {
    this.cancelReconnect();
    onlineStateManager.updateOnlineMode(false);
    PhaserEventBus.emit(PhaserEvents.RoomClosed, { message });
  }

  sendMessage(message: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
      console.log("Message sent:", message);
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
    const sendNow = () => this.dispatchBinaryMessage(message);

    const delayMs = this.debugLatencyConfig.sendLatencyMs;
    if (delayMs <= 0) {
      sendNow();
      return;
    }

    this.trace("schedule outgoing message", {
      delayMs,
      byteLength: message.byteLength
    });
    this.trackTimer(this.pendingSendTimers, sendNow, delayMs);
  }

  consumeSendQueue() {
    if (!this.sendQueue) {
      return;
    }

    if ((this.ws && this.ws.readyState === WebSocket.OPEN) || this.mockRoomMode) {
      while (!this.sendQueue.queues.isEmpty()) {
        const message = this.sendQueue.queues.shift();
        if (message) {
          const binary = Request.toBinary(message);
          this.send(binary);
        }
      }
    } else {
      console.error("No active transport. Cannot consume send queue.");
    }
  }

  closeConnection() {
    this.cancelReconnect();
    this.clearPendingTimers();

    if (this.mockRoomMode) {
      this.closeMockRoom();
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
      this.ws = null;
      onlineStateManager.resetAllState();
      this.ResetGameData();
    } else {
      console.error("WebSocket is not open. Cannot close connection.");
    }
  }

  disconnectQueues() {
    this.receiveQueue = null;
    this.sendQueue = null;
    this.pendingInGameResponses = [];
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
    if (this.receiveQueue) {
      this.receiveQueue.currentFrameId = value;
    }
  }

  get AckFrameID(): number {
    return this.receiveQueue?.lastAckFrameId ?? 0;
  }

  set AckFrameID(value: number) {
    if (this.receiveQueue) {
      this.receiveQueue.lastAckFrameId = value;
    }
  }

  isOnlineMode(): boolean {
    return (!this.isMockRoomMode()) && onlineStateManager.getIsOnlineMode();
  }

  isMockRoomMode(): boolean {
    return this.mockRoomMode;
  }

  isRoomSessionMode(): boolean {
    return this.isOnlineMode() || this.isMockRoomMode();
  }
}

const BackendWS = new WebSocketClient();

export function HasConnected() {
  return BackendWS.hasConnected();
}

export { WebSocketClient };

export default BackendWS;
