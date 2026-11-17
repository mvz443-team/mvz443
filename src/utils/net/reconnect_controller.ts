// 重连控制器：退避策略、次数上限、重连 URL 构造、放弃回调。
// 与传输层完全解耦：只输出“该不该重连 / 用什么 URL”。

export type ReconnectConfig = {
  baseUrl: () => string | null;
  /** 从当前状态构造重连 URL；返回 null 表示无法重连（缺少房间信息） */
  buildReconnectUrl: () => string | null;
  onAttempt: (attempt: number, delayMs: number) => void;
  onGiveUp: (reason: string) => void;
  /** 测试可覆盖：退避基数、上限与最大次数 */
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
};

const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 12;

export class ReconnectController {
  private attempt = 0;
  private timer: number | null = null;
  private reconnecting = false;

  constructor(private readonly config: ReconnectConfig) {}

  getAttempt(): number {
    return this.attempt;
  }

  isReconnecting(): boolean {
    return this.reconnecting || this.timer !== null;
  }

  /** 开始一次重连尝试（由连接关闭触发）。 */
  schedule(): boolean {
    if (this.timer !== null) {
      return false;
    }
    const maxAttempts = this.config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (this.attempt >= maxAttempts) {
      this.giveUp("网络中断，重连超时");
      return false;
    }

    const base = this.config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    const cap = this.config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    const delay = Math.min(cap, base * 2 ** this.attempt);
    this.attempt += 1;
    this.config.onAttempt(this.attempt, delay);

    this.timer = window.setTimeout(() => {
      this.timer = null;
      const url = this.config.buildReconnectUrl();
      if (!url) {
        this.giveUp("无法构造重连地址");
        return;
      }
      this.reconnecting = true;
      this.onConnect(url);
    }, delay);
    return true;
  }

  /** 由上层注入真正的连接动作。 */
  private onConnect: (url: string) => void = () => {};

  setConnectHandler(handler: (url: string) => void): void {
    this.onConnect = handler;
  }

  /** 重连 socket 打开后调用：清零退避。 */
  markConnected(): void {
    this.attempt = 0;
    this.reconnecting = false;
  }

  cancel(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.attempt = 0;
    this.reconnecting = false;
  }

  giveUp(reason: string): void {
    this.cancel();
    this.config.onGiveUp(reason);
  }
}
