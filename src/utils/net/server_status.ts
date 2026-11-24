// 联机服务器连通性与延时探测
// 每 10 秒请求一次 /ping（老服务端回退 /list），用 RTT 作为延时显示。

import { normalizeServerAddress } from "./lobby";

export type ServerConnectionState = "offline" | "connecting" | "connected";
export type ProbeFailure = "cert" | "timeout" | "network" | "http";

export type ServerPreset = {
  /** i18n key */
  labelKey: string;
  address: string;
};

/** 预设服务器，自定义地址会追加在后面 */
export const PRESET_SERVERS: ServerPreset[] = [
  { labelKey: "menu.settings_server_preset_zaozhuang", address: "103.228.12.180:49870" },
  { labelKey: "menu.settings_server_preset_la", address: "scarletborder.cn" },
  { labelKey: "menu.settings_server_preset_local", address: "127.0.0.1:28080" },
];

const PROBE_INTERVAL_MS = 10000;
export const PROBE_TIMEOUT_MS = 5000;
/** connect 最坏情况：/ping 超时或返回 404 后再请求 /list，共两次请求 */
export const CONNECT_MAX_WAIT_MS = PROBE_TIMEOUT_MS * 2;
const MAX_FAILURES_BEFORE_OFFLINE = 3;

type Listener = () => void;

type ProbeResult = {
  ok: boolean;
  latency?: number;
  status?: number;
  failure?: ProbeFailure;
  message?: string;
};

function classifyError(error: unknown): ProbeFailure {
  if (error instanceof Error && error.name === "AbortError") {
    return "timeout";
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "network";
  }
  // https 下 fetch 抛 TypeError 基本只有两种：证书不被信任、域名/端口不可达
  return "cert";
}

class ServerStatusMonitor {
  private address: string = "";
  private state: ServerConnectionState = "offline";
  private latency: number | null = null;
  private failureCount: number = 0;
  private timer: number | null = null;
  private probing: boolean = false;
  private suspended: boolean = false;
  private listeners: Set<Listener> = new Set();
  /** 断开/挂起后让在途探测结果失效，避免把状态重新点亮成 connected */
  private generation: number = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  getAddress(): string {
    return this.address;
  }

  getState(): ServerConnectionState {
    return this.state;
  }

  getLatency(): number | null {
    return this.latency;
  }

  /** 校验地址并开始每 10 秒一次的探测 */
  async connect(input: string): Promise<ProbeResult> {
    this.suspended = false;
    const address = normalizeServerAddress(input);
    if (!address) {
      return { ok: false, failure: "network", message: "服务器地址为空" };
    }

    this.stopTimer();
    this.address = address;
    this.state = "connecting";
    this.latency = null;
    this.failureCount = 0;
    const generation = ++this.generation;
    this.emit();

    const probe = await this.probe();
    if (generation !== this.generation) {
      return probe;
    }
    if (!probe.ok) {
      this.state = "offline";
      this.latency = null;
      this.emit();
      return probe;
    }

    this.state = "connected";
    this.latency = probe.latency ?? null;
    this.emit();
    this.startTimer();
    return probe;
  }

  /** 恢复存档里的地址：静默探测，失败也不打断使用 */
  async attach(input: string): Promise<void> {
    const address = normalizeServerAddress(input);
    if (!address) {
      this.disconnect();
      return;
    }
    if (this.address === address && this.state === "connected") {
      return;
    }
    await this.connect(address);
  }

  disconnect(): void {
    this.generation += 1;
    this.stopTimer();
    this.address = "";
    this.state = "offline";
    this.latency = null;
    this.failureCount = 0;
    this.emit();
  }

  /** 对局中暂停探测：不再发送 /ping，也不允许在途请求重启定时器。 */
  suspend(): void {
    if (!this.suspended) {
      this.suspended = true;
      this.generation += 1;
      this.stopTimer();
    }
  }

  /** 回到设置页时恢复存档地址的探测。 */
  resume(input: string): void {
    this.suspended = false;
    void this.attach(input);
  }

  /** 手动触发一次探测，用于"连接"按钮之外的刷新场景 */
  async probeNow(): Promise<ProbeResult> {
    if (!this.address) {
      return { ok: false, failure: "network", message: "未配置服务器地址" };
    }
    const generation = this.generation;
    const probe = await this.probe();
    if (generation !== this.generation) {
      return probe;
    }
    if (probe.ok && !this.suspended) {
      this.state = "connected";
      this.latency = probe.latency ?? null;
      this.failureCount = 0;
      this.startTimer();
    } else {
      this.failureCount += 1;
      if (this.failureCount >= MAX_FAILURES_BEFORE_OFFLINE) {
        this.state = "offline";
        this.latency = null;
      }
    }
    this.emit();
    return probe;
  }

  private startTimer(): void {
    if (this.suspended) {
      return;
    }
    this.stopTimer();
    this.timer = window.setInterval(() => {
      void this.tick();
    }, PROBE_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.address || this.probing || this.suspended) {
      return;
    }
    const generation = this.generation;
    const probe = await this.probe();
    if (generation !== this.generation) {
      return;
    }
    if (probe.ok) {
      this.failureCount = 0;
      this.state = "connected";
      this.latency = probe.latency ?? null;
    } else {
      this.failureCount += 1;
      // 偶发抖动不立刻变 offline，连续失败才降级
      if (this.failureCount >= MAX_FAILURES_BEFORE_OFFLINE) {
        this.state = "offline";
        this.latency = null;
      }
    }
    this.emit();
  }

  private async probe(): Promise<ProbeResult> {
    if (this.probing) {
      return { ok: false, failure: "network", message: "上一次探测尚未结束" };
    }
    this.probing = true;
    try {
      const ping = await this.request(`https://${this.address}/ping`);
      if (ping.ok) {
        return ping;
      }
      // 旧版本服务端没有 /ping，退回到 /list
      if (ping.status === 404) {
        return await this.request(`https://${this.address}/list`);
      }
      return ping;
    } finally {
      this.probing = false;
    }
  }

  private request(url: string): Promise<ProbeResult> {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeoutTimer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    return fetch(url, { method: "GET", cache: "no-store", signal: controller.signal })
      .then((response) => ({
        ok: response.ok,
        status: response.status,
        latency: Math.round(performance.now() - startedAt),
        failure: response.ok ? undefined : ("http" as ProbeFailure),
        message: response.ok ? undefined : `HTTP ${response.status}`,
      }))
      .catch((error: unknown) => ({
        ok: false,
        status: 0,
        failure: classifyError(error),
        message: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => window.clearTimeout(timeoutTimer));
  }
}

export const serverStatus = new ServerStatusMonitor();
export { ServerStatusMonitor };
