/**
 * TEMP-DESYNC-LOG: 联机分叉诊断日志。
 *
 * 目标：
 * - 记录控制台、网络原始字节、每帧操作、确定性状态采样；
 * - 收到服务端“状态分叉”时立即下载完整 JSON 日志；
 * - 提供手动下载入口：window.__MVZ443_DOWNLOAD_LOGS__() 或 DBG.downloadLogs()。
 *
 * 该文件是临时诊断设施，定位问题后可以整体删除。
 */

type LogEntry = {
  seq: number;
  ts: number;
  iso: string;
  category: string;
  message: string;
  data?: unknown;
};

type NetworkEntry = {
  seq: number;
  ts: number;
  iso: string;
  direction: "send" | "recv";
  size: number;
  // 惰性编码：热路径只保存原始字节，导出日志时才转 hex/base64。
  raw?: Uint8Array;
  hex?: string;
  base64?: string;
  retired?: boolean;
  truncated: boolean;
  note?: string;
};

function materializeNetworkEntry(entry: NetworkEntry): NetworkEntry {
  if (entry.hex !== undefined && entry.base64 !== undefined) return entry;
  const bytes = entry.raw ?? new Uint8Array(0);
  // 导出时若 Worker 尚未回填编码，使用同步兜底保证日志完整。
  const slice = entry.truncated ? bytes.subarray(0, MAX_MESSAGE_BYTES) : bytes;
  entry.hex = bytesToHex(bytes);
  entry.base64 = bytesToBase64(slice);
  entry.raw = undefined;
  return entry;
}

type FrameEntry = {
  seq: number;
  ts: number;
  iso: string;
  data: unknown;
};

type DesyncLogSnapshot = {
  generatedAt: string;
  entries: LogEntry[];
  network: NetworkEntry[];
  frames: FrameEntry[];
};

const MAX_LOG_ENTRIES = 20_000;
const MAX_NETWORK_ENTRIES = 40_000;
const MAX_NETWORK_BYTES = 48 * 1024 * 1024;
const MAX_FRAME_ENTRIES = 12_000;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_STRING_LENGTH = 4_000;

function nowIso(): string {
  return new Date().toISOString();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  if (typeof btoa === "function") return btoa(binary);
  const nodeBuffer = (globalThis as {
    Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  return nodeBuffer ? nodeBuffer.from(binary, "binary").toString("base64") : "";
}

function bytesToHex(bytes: Uint8Array, limit = 64): string {
  const length = Math.min(bytes.length, limit);
  const parts: string[] = [];
  for (let index = 0; index < length; index += 1) {
    parts.push(bytes[index].toString(16).padStart(2, "0"));
  }
  return parts.join("");
}

function truncateString(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`
    : value;
}

/**
 * 把任意日志参数转成可序列化对象，避免循环引用、函数、DOM 节点导致
 * JSON.stringify 失败。只用于诊断，不参与业务逻辑。
 */
function safeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null) return null;
  if (value === undefined) return "[undefined]";
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? truncateString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return {
      type: "Uint8Array",
      length: value.length,
      hex: bytesToHex(value),
      base64: value.length <= 8_192 ? bytesToBase64(value) : "[base64 omitted]",
    };
  }
  if (value instanceof ArrayBuffer) {
    return { type: "ArrayBuffer", byteLength: value.byteLength };
  }
  if (depth >= 8) return "[max-depth]";
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, 300).map((item) => safeValue(item, depth + 1, seen));
      if (value.length > 300) items.push(`[truncated ${value.length - 300} items]`);
      return items;
    }
    if (value instanceof Map) {
      const entries = [...value.entries()].slice(0, 300).map(([key, item]) => [
        safeValue(key, depth + 1, seen),
        safeValue(item, depth + 1, seen),
      ]);
      return { type: "Map", size: value.size, entries };
    }
    if (value instanceof Set) {
      const values = [...value.values()].slice(0, 300).map((item) => safeValue(item, depth + 1, seen));
      return { type: "Set", size: value.size, values };
    }

    const result: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>);
    for (const key of keys.slice(0, 300)) {
      result[key] = safeValue((value as Record<string, unknown>)[key], depth + 1, seen);
    }
    if (keys.length > 300) result.__truncatedKeys = keys.length - 300;
    return result;
  }
  return String(value);
}

class DesyncDiagnostics {
  private readonly entries: LogEntry[] = [];
  private readonly networkEntries: NetworkEntry[] = [];
  private readonly frameEntries: FrameEntry[] = [];
  private networkBytes = 0;
  private sequence = 0;
  private installed = false;
  private downloadStarted = false;
  private stateProvider: (() => Record<string, unknown>) | null = null;
  private encodeWorker: Worker | null = null;
  private encodeWorkerNextId = 1;
  private readonly encodeCallbacks = new Map<number, (result: { hex: string; base64: string }) => void>();

  constructor() {
    // 浏览器里尽早安装；Node 测试环境不劫持 console。
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      this.install();
      this.installEncodeWorker();
    }
  }

  /** 惰性创建编码 Worker；构造失败时所有调用自动回退到同步编码。 */
  private installEncodeWorker(): void {
    try {
      const worker = new Worker(new URL("./networkEncode.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ id: number; hex: string; base64: string }>) => {
        const callback = this.encodeCallbacks.get(event.data.id);
        if (!callback) return;
        this.encodeCallbacks.delete(event.data.id);
        callback({ hex: event.data.hex, base64: event.data.base64 });
      };
      worker.onerror = () => {
        for (const callback of this.encodeCallbacks.values()) {
          callback({ hex: "", base64: "" });
        }
        this.encodeCallbacks.clear();
        this.encodeWorker?.terminate();
        this.encodeWorker = null;
      };
      this.encodeWorker = worker;
    } catch {
      // Worker 不可用时保持同步降级，绝不影响联机主流程。
      this.encodeWorker = null;
    }
  }

  private encodeNetworkBytes(bytes: Uint8Array, callback: (result: { hex: string; base64: string }) => void): void {
    if (!this.encodeWorker) {
      const slice = bytes.subarray(0, Math.min(bytes.length, MAX_MESSAGE_BYTES));
      callback({ hex: bytesToHex(bytes), base64: bytesToBase64(slice) });
      return;
    }
    const id = this.encodeWorkerNextId++;
    this.encodeCallbacks.set(id, callback);
    const copy = new Uint8Array(bytes);
    this.encodeWorker.postMessage({ id, bytes: copy.buffer, limit: MAX_MESSAGE_BYTES }, [copy.buffer]);
  }

  public install(): void {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;

    const levels: Array<keyof Pick<Console, "log" | "info" | "warn" | "error" | "debug">> = [
      "log",
      "info",
      "warn",
      "error",
      "debug",
    ];
    for (const level of levels) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        try {
          this.record("console", level, args.length === 1 ? args[0] : args);
        } catch {
          // 诊断日志不能影响原始 console 行为。
        }
        original(...args);
      };
    }

    window.addEventListener("error", (event) => {
      this.record("window-error", "uncaught error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
    });
    window.addEventListener("unhandledrejection", (event) => {
      this.record("window-error", "unhandled rejection", { reason: event.reason });
    });

    const api = {
      download: (reason = "manual") => this.download(reason),
      snapshot: () => this.snapshot(),
      entries: () => [...this.entries],
      network: () => [...this.networkEntries],
      frames: () => [...this.frameEntries],
      clear: () => this.clear(),
    };
    (window as unknown as Record<string, unknown>).__MVZ443_DESYNC_LOGS__ = api;
    (window as unknown as Record<string, unknown>).__MVZ443_DOWNLOAD_LOGS__ = api.download;
  }

  public setStateProvider(provider: (() => Record<string, unknown>) | null): void {
    this.stateProvider = provider;
  }

  public record(category: string, message: string, data?: unknown): void {
    this.entries.push({
      seq: ++this.sequence,
      ts: Date.now(),
      iso: nowIso(),
      category,
      message,
      data: data === undefined ? undefined : safeValue(data),
    });
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES);
    }
  }

  public recordNetwork(direction: "send" | "recv", bytes: Uint8Array, note?: string): void {
    const truncated = bytes.length > MAX_MESSAGE_BYTES;
    // 复制一次是为了避免底层 WebSocket buffer 被复用/回收；不在热路径做编码。
    const raw = new Uint8Array(bytes);
    const entry: NetworkEntry = {
      seq: ++this.sequence,
      ts: Date.now(),
      iso: nowIso(),
      direction,
      size: bytes.length,
      raw,
      truncated,
      note,
    };
    this.networkEntries.push(entry);
    this.networkBytes += Math.min(bytes.length, MAX_MESSAGE_BYTES);
    this.encodeNetworkBytes(raw, (encoded) => {
      // 条目可能已被环形淘汰；只有仍在缓冲中的条目才回填。
      if (entry.retired) return;
      entry.hex = encoded.hex;
      entry.base64 = encoded.base64;
      entry.raw = undefined;
    });

    while (
      this.networkEntries.length > MAX_NETWORK_ENTRIES
      || this.networkBytes > MAX_NETWORK_BYTES
    ) {
      const removed = this.networkEntries.shift();
      if (!removed) break;
      removed.retired = true;
      removed.raw = undefined;
      this.networkBytes -= Math.min(removed.size, MAX_MESSAGE_BYTES);
    }
  }

  public recordFrame(data: unknown): void {
    this.frameEntries.push({
      seq: ++this.sequence,
      ts: Date.now(),
      iso: nowIso(),
      data: safeValue(data),
    });
    if (this.frameEntries.length > MAX_FRAME_ENTRIES) {
      this.frameEntries.splice(0, this.frameEntries.length - MAX_FRAME_ENTRIES);
    }
  }

  public snapshot(): DesyncLogSnapshot {
    return {
      generatedAt: nowIso(),
      entries: [...this.entries],
      network: this.networkEntries.map(materializeNetworkEntry),
      frames: [...this.frameEntries],
    };
  }

  /** 手动下载；不会清空缓冲，也不会被一次性标记拦截。 */
  public download(reason: string, extra?: unknown): void {
    if (typeof document === "undefined" || typeof Blob === "undefined") {
      this.record("diagnostics", "download skipped: no document/Blob", { reason });
      return;
    }

    let meta: unknown = null;
    if (this.stateProvider) {
      try {
        meta = this.stateProvider();
      } catch (error) {
        meta = { error: String(error) };
      }
    }

    const report = {
      type: "mvz443-desync-full-log",
      version: 1,
      reason,
      generatedAt: nowIso(),
      generatedAtMs: Date.now(),
      page: {
        href: typeof location !== "undefined" ? location.href : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        platform: typeof navigator !== "undefined" ? navigator.platform : null,
        language: typeof navigator !== "undefined" ? navigator.language : null,
        visibility: typeof document !== "undefined" ? document.visibilityState : null,
      },
      meta,
      extra: extra === undefined ? null : safeValue(extra),
      entries: [...this.entries],
      network: this.networkEntries.map(materializeNetworkEntry),
      frames: [...this.frameEntries],
      counts: {
        entries: this.entries.length,
        network: this.networkEntries.length,
        frames: this.frameEntries.length,
      },
    };

    let json = "";
    try {
      json = JSON.stringify(report, null, 2);
    } catch (error) {
      json = JSON.stringify({
        type: report.type,
        version: report.version,
        reason,
        generatedAt: report.generatedAt,
        stringifyError: String(error),
        entries: this.entries,
      }, null, 2);
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.download = `mvz443-desync-${reason}-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  /** 分叉告警只下载一次，避免结算时重复弹下载。 */
  public downloadOnce(reason: string, extra?: unknown): void {
    if (this.downloadStarted) return;
    this.downloadStarted = true;
    this.download(reason, extra);
  }

  public hasDownloaded(): boolean {
    return this.downloadStarted;
  }

  public resetDownloadFlag(): void {
    this.downloadStarted = false;
  }

  public clear(): void {
    this.entries.length = 0;
    this.networkEntries.length = 0;
    this.frameEntries.length = 0;
    this.networkBytes = 0;
  }
}

export const desyncDiagnostics = new DesyncDiagnostics();
