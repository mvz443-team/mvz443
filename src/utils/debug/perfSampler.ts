/**
 * 仅用于 perfHarness=1 的旁路性能采样器。
 *
 * 约束：
 * - 不读写任何游戏状态，不参与权威帧/ACK/哈希/PRNG；
 * - 非 perfHarness 模式下所有调用都是 no-op；
 * - 统计值只通过测试钩子读取，普通联机为零成本。
 */

export type PerfSample = {
  count: number;
  totalMs: number;
  maxMs: number;
};

export type PerfSamplerSnapshot = Record<string, PerfSample>;

class PerfSampler {
  readonly enabled: boolean;

  private readonly stats = new Map<string, PerfSample>();

  constructor() {
    try {
      this.enabled = new URLSearchParams(
        typeof location !== "undefined" ? location.search : "",
      ).get("perfHarness") === "1";
    } catch {
      this.enabled = false;
    }
  }

  now(): number {
    return this.enabled ? performance.now() : 0;
  }

  record(name: string, elapsedMs: number): void {
    if (!this.enabled) return;
    let sample = this.stats.get(name);
    if (!sample) {
      sample = { count: 0, totalMs: 0, maxMs: 0 };
      this.stats.set(name, sample);
    }
    sample.count += 1;
    sample.totalMs += elapsedMs;
    if (elapsedMs > sample.maxMs) sample.maxMs = elapsedMs;
  }

  around<T>(name: string, callback: () => T): T {
    if (!this.enabled) return callback();
    const started = this.now();
    try {
      return callback();
    } finally {
      this.record(name, this.now() - started);
    }
  }

  reset(): void {
    if (!this.enabled) return;
    this.stats.clear();
  }

  snapshot(): PerfSamplerSnapshot {
    const result: PerfSamplerSnapshot = {};
    for (const [name, sample] of this.stats) {
      result[name] = { ...sample };
    }
    return result;
  }
}

export const perfSampler = new PerfSampler();
