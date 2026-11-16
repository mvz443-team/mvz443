/**
 * 确定性战局状态收集 / 哈希 / 快照恢复核心。
 *
 * 设计约束：
 * - 本文件不依赖 Phaser、Rapier 或任何管理器，可在 Node 下直接运行测试。
 * - 所有集合在 capture 时按稳定 key 排序，保证同一逻辑状态在任何机器上产出同一字节序列。
 * - 数值一律按 IEEE-754 位模式写入 hash，避免 JSON 序列化对浮点/负零的歧义。
 */

export const SIMULATION_STATE_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface TimerState {
  id: number;
  targetFrame: number;
  repeat: number;
  interval: number;
  group: string;
  /** 可重建模式下的语义类型；未标记的计时器只能在同进程内回滚。 */
  kind?: string;
  /** 重建该计时器所需的纯数据参数。 */
  args?: JsonValue;
}

export interface PrngState {
  name: string;
  seed: string;
  state: JsonValue;
}

export interface EntityLogicState {
  kind: string;
  id: string | number;
  col: number | null;
  row: number | null;
  x: number;
  y: number;
  hp: number | null;
  maxHp: number | null;
  speed: number | null;
  /** 影响模拟的布尔/枚举/计数标志（isDying、attackTimer 剩余帧等） */
  flags: Record<string, JsonValue>;
  /** 该实体的 FrameTimer 逻辑字段 */
  timers: TimerState[];
  extra: Record<string, JsonValue>;
}

export interface SimulationState {
  version: number;
  seed: number;
  frameId: number;
  values: Record<string, JsonValue>;
  timers: Record<string, TimerState[]>;
  prngs: PrngState[];
  entities: EntityLogicState[];
  /** base64 编码的 Rapier world snapshot；无物理世界时为 null */
  physics: string | null;
}

export interface RestoreReport {
  ok: boolean;
  restored: string[];
  missing: string[];
  errors: string[];
}

export type RestoreMode = "in-place" | "rebuild";

export interface RestoreContext {
  /** 恢复到的逻辑帧号。 */
  frameId: number;
  mode: RestoreMode;
  /** 恢复诊断信息。 */
  report: RestoreReport;
  /** 快照中的全局 ticker 下一个 timer id；实体 timer 恢复必须与其一致。 */
  nextTimerId?: number;
  /** 按快照 id 解析仍然存活的实体引用。 */
  resolveEntity?: (snapshotId: string) => unknown;
}

type ValueProvider = () => JsonValue;
type ValueRestorer = (value: JsonValue) => void;
type TimerProvider = () => TimerState[];
type TimerRestorer = (timers: TimerState[], context: RestoreContext) => void;
type EntityProvider = () => EntityLogicState[];
type EntityRestorer = (entities: EntityLogicState[], context: RestoreContext) => void;

interface PrngBinding {
  capture: () => PrngState;
  restore?: (state: PrngState) => void;
}

interface PhysicsBinding {
  capture: () => Uint8Array | null;
  restore?: (bytes: Uint8Array) => void;
}

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把任意值规整为 JSON 安全值，并对对象 key 排序，保证序列化稳定。 */
export function canonicalize(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const out: Record<string, JsonValue> = {};
    for (const key of sortedKeys(value)) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return String(value);
}

/** 按 IEEE-754 位模式写字节的 hash 写入器。 */
export class HashWriter {
  private readonly chunks: number[] = [];
  private readonly encoder = new TextEncoder();
  private readonly scratch = new DataView(new ArrayBuffer(8));

  private pushBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) this.chunks.push(bytes[i]);
  }

  u8(value: number): this {
    this.chunks.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    this.u8(value);
    this.u8(value >>> 8);
    return this;
  }

  u32(value: number): this {
    this.u8(value);
    this.u8(value >>> 8);
    this.u8(value >>> 16);
    this.u8(value >>> 24);
    return this;
  }

  /** 写入 double 的原始 8 字节（小端），避免 JSON 文本对 0.1 / -0 的歧义。 */
  f64(value: number): this {
    this.scratch.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) this.chunks.push(this.scratch.getUint8(i));
    return this;
  }

  str(value: string): this {
    const bytes = this.encoder.encode(value);
    this.u32(bytes.length);
    this.pushBytes(bytes);
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  /** 递归写入任意 JSON 值；对象键按字典序，浮点按位模式。 */
  value(value: unknown): this {
    if (value === null || value === undefined) {
      this.u8(0);
    } else if (typeof value === "boolean") {
      this.u8(1).bool(value);
    } else if (typeof value === "number") {
      this.u8(2).f64(value);
    } else if (typeof value === "string") {
      this.u8(3).str(value);
    } else if (Array.isArray(value)) {
      this.u8(4).u32(value.length);
      for (const item of value) this.value(item);
    } else if (isObject(value)) {
      const keys = sortedKeys(value);
      this.u8(5).u32(keys.length);
      for (const key of keys) {
        this.str(key);
        this.value(value[key]);
      }
    } else {
      this.u8(3).str(String(value));
    }
    return this;
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

/** FNV-1a 32 位，返回 8 位小写十六进制。 */
export function fnv1a32(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** FNV-1a 64 位，返回 16 位小写十六进制，用于降低碰撞概率。 */
export function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash ^ BigInt(bytes[i])) * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface StateHash {
  h32: string;
  h64: string;
}

export function hashSimulationState(state: SimulationState): StateHash {
  const writer = new HashWriter();
  writer.u32(SIMULATION_STATE_VERSION);
  writer.f64(state.seed);
  writer.f64(state.frameId);
  writer.value(state.values);
  writer.value(state.timers);
  writer.value(state.prngs);
  writer.value(state.entities);
  writer.value(state.physics);
  const bytes = writer.toBytes();
  return { h32: fnv1a32(bytes), h64: fnv1a64(bytes) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  if (typeof btoa === "function") return btoa(binary);
  const nodeBuffer = (globalThis as { Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (!nodeBuffer) throw new Error("当前环境不支持 base64 编码");
  return nodeBuffer.from(binary, "binary").toString("base64");
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  if (typeof atob === "function") {
    binary = atob(value);
  } else {
    const nodeBuffer = (globalThis as { Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
    if (!nodeBuffer) throw new Error("当前环境不支持 base64 解码");
    binary = nodeBuffer.from(value, "base64").toString("binary");
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function serializeSimulationState(state: SimulationState): string {
  return JSON.stringify(canonicalize(state));
}

export function deserializeSimulationState(json: string): SimulationState {
  const parsed = JSON.parse(json) as SimulationState;
  if (parsed.version !== SIMULATION_STATE_VERSION) {
    throw new Error(`不支持的战局快照版本: ${parsed.version}`);
  }
  return parsed;
}

/**
 * 状态注册中心。业务模块通过 register* 暴露确定性状态；
 * capture / hash 完全由本类负责，业务侧不需要关心排序和编码。
 */
export class StateRegistry {
  private readonly values = new Map<string, { provide: ValueProvider; restore?: ValueRestorer }>();
  private readonly timers = new Map<string, { provide: TimerProvider; restore?: TimerRestorer }>();
  private readonly entities = new Map<string, { provide: EntityProvider; restore?: EntityRestorer }>();
  private readonly prngs = new Map<string, PrngBinding>();
  private physics: PhysicsBinding | null = null;
  private seedProvider: (() => number) | null = null;
  private seedRestorer: ((seed: number) => void) | null = null;
  private frameProvider: (() => number) | null = null;
  private frameRestorer: ((frameId: number) => void) | null = null;

  registerValue(key: string, provide: ValueProvider, restore?: ValueRestorer): this {
    this.values.set(key, { provide, restore });
    return this;
  }

  registerTimers(key: string, provide: TimerProvider, restore?: TimerRestorer): this {
    this.timers.set(key, { provide, restore });
    return this;
  }

  registerEntities(key: string, provide: EntityProvider, restore?: EntityRestorer): this {
    this.entities.set(key, { provide, restore });
    return this;
  }

  registerPrng(binding: PrngBinding): this {
    this.prngs.set(binding.capture().name, binding);
    return this;
  }

  registerPhysics(binding: PhysicsBinding): this {
    this.physics = binding;
    return this;
  }

  registerSeed(provide: () => number, restore?: (seed: number) => void): this {
    this.seedProvider = provide;
    this.seedRestorer = restore ?? null;
    return this;
  }

  registerFrame(provide: () => number, restore?: (frameId: number) => void): this {
    this.frameProvider = provide;
    this.frameRestorer = restore ?? null;
    return this;
  }

  reset(): void {
    this.values.clear();
    this.timers.clear();
    this.entities.clear();
    this.prngs.clear();
    this.physics = null;
    this.seedProvider = null;
    this.seedRestorer = null;
    this.frameProvider = null;
    this.frameRestorer = null;
  }

  capture(): SimulationState {
    const values: Record<string, JsonValue> = {};
    for (const key of [...this.values.keys()].sort()) {
      values[key] = canonicalize(this.values.get(key)!.provide());
    }

    const timers: Record<string, TimerState[]> = {};
    for (const key of [...this.timers.keys()].sort()) {
      timers[key] = this.timers.get(key)!.provide()
        .map(sortTimerFields)
        .sort((a, b) => a.id - b.id);
    }

    const entities: EntityLogicState[] = [];
    for (const key of [...this.entities.keys()].sort()) {
      for (const entity of this.entities.get(key)!.provide()) {
        entities.push(normalizeEntity(key, entity));
      }
    }
    entities.sort((a, b) => {
      const ka = `${a.kind}:${a.id}`;
      const kb = `${b.kind}:${b.id}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    const prngs = [...this.prngs.values()]
      .map((binding) => binding.capture())
      .map((prng) => ({ ...prng, state: canonicalize(prng.state) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const physicsBytes = this.physics?.capture() ?? null;
    return {
      version: SIMULATION_STATE_VERSION,
      seed: this.seedProvider?.() ?? 0,
      frameId: this.frameProvider?.() ?? 0,
      values,
      timers,
      prngs,
      entities,
      physics: physicsBytes ? bytesToBase64(physicsBytes) : null,
    };
  }

  hash(state: SimulationState = this.capture()): StateHash {
    return hashSimulationState(state);
  }

  restore(
    state: SimulationState,
    options?: { mode?: RestoreMode; resolveEntity?: RestoreContext["resolveEntity"] },
  ): RestoreReport {
    const report: RestoreReport = { ok: true, restored: [], missing: [], errors: [] };
    const context: RestoreContext = {
      frameId: state.frameId,
      mode: options?.mode ?? "in-place",
      report,
      resolveEntity: options?.resolveEntity,
    };

    if (state.version !== SIMULATION_STATE_VERSION) {
      report.ok = false;
      report.errors.push(`快照版本不匹配: ${state.version}`);
      return report;
    }

    if (this.seedRestorer) {
      this.seedRestorer(state.seed);
      report.restored.push("seed");
    } else {
      report.missing.push("seed");
    }

    const nextTimerIdValue = state.values["ticker.nextTimerId"];
    if (typeof nextTimerIdValue === "number") {
      context.nextTimerId = nextTimerIdValue;
    }

    for (const [key, binding] of this.values) {
      const value = state.values[key];
      if (value === undefined) {
        report.missing.push(`value:${key}`);
        continue;
      }
      if (binding.restore) {
        try {
          binding.restore(value);
          report.restored.push(`value:${key}`);
        } catch (error) {
          report.ok = false;
          report.errors.push(`value:${key}: ${String(error)}`);
        }
      } else {
        report.missing.push(`value:${key}(只读)`);
      }
    }

    for (const [key, binding] of this.prngs) {
      const snapshot = state.prngs.find((p) => p.name === key);
      if (!snapshot) {
        report.missing.push(`prng:${key}`);
        continue;
      }
      if (!binding.restore) {
        report.missing.push(`prng:${key}(只读)`);
        continue;
      }
      try {
        binding.restore(snapshot);
        report.restored.push(`prng:${key}`);
      } catch (error) {
        report.ok = false;
        report.errors.push(`prng:${key}: ${String(error)}`);
      }
    }

    for (const [key, binding] of this.entities) {
      const entities = state.entities.filter((entity) => entity.kind === key);
      if (entities.length === 0 && this.entities.size > 0 && state.entities.length > 0) {
        report.missing.push(`entities:${key}`);
      }
      if (!binding.restore) {
        report.missing.push(`entities:${key}(只读)`);
        continue;
      }
      try {
        binding.restore(entities, context);
        report.restored.push(`entities:${key}`);
      } catch (error) {
        report.ok = false;
        report.errors.push(`entities:${key}: ${String(error)}`);
      }
    }

    // 计时器最后恢复：实体重建可能注册默认计时器，这里用快照完整覆盖。
    for (const [key, binding] of this.timers) {
      const timers = state.timers[key];
      if (!timers) {
        report.missing.push(`timers:${key}`);
        continue;
      }
      if (!binding.restore) {
        report.missing.push(`timers:${key}(只读)`);
        continue;
      }
      try {
        binding.restore(timers, context);
        report.restored.push(`timers:${key}`);
      } catch (error) {
        report.ok = false;
        report.errors.push(`timers:${key}: ${String(error)}`);
      }
    }

    if (state.physics && this.physics?.restore) {
      try {
        this.physics.restore(base64ToBytes(state.physics));
        report.restored.push("physics");
      } catch (error) {
        report.ok = false;
        report.errors.push(`physics: ${String(error)}`);
      }
    } else {
      report.missing.push("physics(未注册恢复)");
    }

    if (this.frameRestorer) {
      this.frameRestorer(state.frameId);
      report.restored.push("frameId");
    } else {
      report.missing.push("frameId");
    }

    return report;
  }
}

function sortTimerFields(timer: TimerState): TimerState {
  return {
    id: timer.id,
    targetFrame: timer.targetFrame,
    repeat: timer.repeat,
    interval: timer.interval,
    group: timer.group,
    ...(timer.kind !== undefined ? { kind: timer.kind } : {}),
    ...(timer.args !== undefined ? { args: canonicalize(timer.args) } : {}),
  };
}

function normalizeEntity(source: string, entity: EntityLogicState): EntityLogicState {
  return {
    kind: entity.kind || source,
    id: entity.id,
    col: entity.col ?? null,
    row: entity.row ?? null,
    x: entity.x ?? 0,
    y: entity.y ?? 0,
    hp: entity.hp ?? null,
    maxHp: entity.maxHp ?? null,
    speed: entity.speed ?? null,
    flags: canonicalize(entity.flags ?? {}) as Record<string, JsonValue>,
    timers: (entity.timers ?? []).map(sortTimerFields).sort((a, b) => a.id - b.id),
    extra: canonicalize(entity.extra ?? {}) as Record<string, JsonValue>,
  };
}

/** 全局注册中心；业务侧统一向它登记状态源。 */
export const simulationState = new StateRegistry();
