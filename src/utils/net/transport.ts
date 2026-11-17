// 传输层：只负责 WebSocket 连接生命周期与二进制收发。
// 不含重连策略、不含业务路由、不依赖 OnlineStateManager。

export type BinaryFrame = Uint8Array<ArrayBufferLike>;

export interface TransportCallbacks {
  onOpen: (isReconnect: boolean) => void;
  onMessage: (data: BinaryFrame) => void;
  onClose: (event: CloseEvent) => void;
  onError: (error: Event) => void;
}

/**
 * WebSocketTransport 管理一条 WebSocket 连接。
 * 每次 openSocket 都创建新的 socket 实例，回调随之绑定到该实例，
 * 杜绝旧连接的 onmessage 泄漏到新阶段。
 */
export class WebSocketTransport {
  private socket: WebSocket | null = null;
  private callbacks: TransportCallbacks = {
    onOpen: () => {},
    onMessage: () => {},
    onClose: () => {},
    onError: () => {},
  };

  constructor() {}

  setCallbacks(callbacks: TransportCallbacks): void {
    this.callbacks = callbacks;
  }

  /** 建立连接；url 由重连控制器决定。 */
  open(url: string, isReconnect: boolean): boolean {
    if (!url) {
      return false;
    }
    this.closeSocket();
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => this.callbacks.onOpen(isReconnect);
    socket.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) {
        console.warn("[Transport] 忽略非二进制消息:", event.data);
        return;
      }
      this.callbacks.onMessage(new Uint8Array(event.data));
    };
    socket.onerror = (error: Event) => this.callbacks.onError(error);
    socket.onclose = (event: CloseEvent) => this.callbacks.onClose(event);
    return true;
  }

  send(data: BinaryFrame): boolean {
    if (!this.isOpen()) {
      return false;
    }
    try {
      // slice() 生成只包含当前视图字节的独立 ArrayBuffer
      this.socket!.send(data.slice().buffer as ArrayBuffer);
      return true;
    } catch (error) {
      console.error("[Transport] send failed:", error);
      return false;
    }
  }

  isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  currentSocket(): WebSocket | null {
    return this.socket;
  }

  /** 主动关闭；触发 onClose 回调由调用方决定是否重连。 */
  close(): void {
    this.closeSocket();
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      // 清空回调，避免关闭过程中的 onclose 触发重连逻辑
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  }
}
