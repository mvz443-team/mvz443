/**
 * 无感逻辑状态：只有 Model 会被快照，业务写普通字段即可。
 *
 * - 没有 reg、没有 schema、没有 logicFields；Model 上的所有 JSON 安全字段自动进 Undo Log。
 * - 配置型字段（PlantStat、纹理、函数等）不是运行时状态，不进快照，也不允许运行时改写。
 * - 不依赖 Phaser / Rapier，可在 Node 下独立测试。
 */

/** 通过 symbol 取回状态句柄，不污染可枚举字段。 */
export const LOGIC_HANDLE = Symbol("mvz.logicHandle");

export type LogicValue =
  | number
  | boolean
  | string
  | null
  | undefined
  | LogicValue[]
  | { [key: string]: LogicValue };

export interface LogicStateHandle<T extends object> {
  readonly frame: number;
  setFrame(frame: number): void;
  /** 只导出 JSON 安全的运行时状态；配置字段自动跳过。 */
  snapshot(): Partial<T>;
  restore(value: Partial<T>): void;
  rollbackTo(frame: number): void;
  clearHistory(): void;
  forgetFramesBefore(frame: number): void;
  readonly historyFrames: number[];
}

export type Tracked<T extends object> = T & { [LOGIC_HANDLE]: LogicStateHandle<T> };

interface UndoEntry {
  raw: object;
  key: string | symbol;
  hadKey: boolean;
  oldValue: unknown;
}

const rawToProxy = new WeakMap<object, object>();
const proxyToRaw = new WeakMap<object, object>();

/** 判断值能否作为确定性状态（配置对象/函数/类实例一律不是）。 */
export function isLogicValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const type = typeof value;
  if (type === "number" || type === "boolean" || type === "string") return true;
  if (Array.isArray(value)) return value.every(isLogicValue);
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isLogicValue);
  }
  return false;
}

function toPlain(value: unknown, path = "$"): LogicValue {
  if (!isLogicValue(value)) {
    throw new Error(`[LogicState] ${path} 不是确定性数据（只允许 number/boolean/string/null/数组/纯对象）`);
  }
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item, index) => toPlain(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const out: Record<string, LogicValue> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) out[key] = toPlain(obj[key], `${path}.${key}`);
    return out;
  }
  return value as number | boolean | string;
}

const ARRAY_MUTATORS = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin",
]);

interface Tracker {
  frame: number;
  logs: Map<number, UndoEntry[]>;
  handle: LogicStateHandle<Record<string, unknown>>;
  wrap(value: unknown, path: string): unknown;
  record(raw: object, key: string | symbol, value: unknown): void;
  recordArray(raw: unknown[], path: string): void;
}

function makeProxy<T extends object>(raw: T, tracker: Tracker, path: string): T {
  const cached = rawToProxy.get(raw);
  if (cached) return cached as T;

  const arrayMutator = Array.isArray(raw) ? new Map<PropertyKey, Function>() : null;

  const proxy = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === LOGIC_HANDLE || typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }
      if (arrayMutator?.has(prop)) return arrayMutator.get(prop);
      return tracker.wrap(Reflect.get(target, prop, receiver), `${path}.${String(prop)}`);
    },
    set(target, prop, value, receiver) {
      // 配置字段（PlantStat/sprite 等）不允许运行时改写，防止表现层状态混入 Model。
      if (!isLogicValue(value)) {
        throw new Error(`[LogicState] ${path}.${String(prop)} 不是确定性数据，不能写入 Model`);
      }
      const unwrapped = proxyToRaw.get(value as object) ?? value;
      tracker.record(target, prop, unwrapped);
      return Reflect.set(target, prop, unwrapped, receiver);
    },
    deleteProperty(target, prop) {
      tracker.record(target, prop, undefined);
      return Reflect.deleteProperty(target, prop);
    },
  });

  if (arrayMutator) {
    for (const name of ARRAY_MUTATORS) {
      const original = (raw as unknown as Record<string, Function>)[name];
      if (typeof original !== "function") continue;
      arrayMutator.set(name, (...args: unknown[]) => {
        tracker.recordArray(raw as unknown[], path);
        return original.apply(raw, args);
      });
    }
  }

  rawToProxy.set(raw, proxy);
  proxyToRaw.set(proxy, raw);
  return proxy;
}

/** 把已存在的对象（例如 Model 实例）变成自动追踪状态；不复制、不丢配置字段。 */
export function trackLogicObject<T extends object>(raw: T, frame = 0): Tracked<T> {
  const logs = new Map<number, UndoEntry[]>();

  const tracker: Tracker = {
    frame,
    logs,
    handle: undefined as unknown as LogicStateHandle<Record<string, unknown>>,
    wrap(value, valuePath) {
      if (value !== null && typeof value === "object" && isLogicValue(value)) {
        return makeProxy(value as object, tracker, valuePath);
      }
      return value;
    },
    record(target, key, value) {
      if (key === LOGIC_HANDLE) return;
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const oldValue = hadKey ? (target as Record<string | symbol, unknown>)[key] : undefined;
      if (hadKey && oldValue === value) return;
      let frameLog = logs.get(tracker.frame);
      if (!frameLog) {
        frameLog = [];
        logs.set(tracker.frame, frameLog);
      }
      frameLog.push({
        raw: target,
        key,
        hadKey,
        oldValue: hadKey && isLogicValue(oldValue) ? toPlain(oldValue) : oldValue,
      });
    },
    recordArray(target, valuePath) {
      let frameLog = logs.get(tracker.frame);
      if (!frameLog) {
        frameLog = [];
        logs.set(tracker.frame, frameLog);
      }
      frameLog.push({
        raw: target,
        key: "__array__",
        hadKey: true,
        oldValue: toPlain([...target], valuePath) as LogicValue[],
      });
    },
  };

  tracker.handle = {
    get frame() { return tracker.frame; },
    setFrame(nextFrame: number) { tracker.frame = Math.trunc(nextFrame); },
    snapshot() {
      const out: Record<string, LogicValue> = {};
      for (const key of Object.keys(raw)) {
        const value = (raw as Record<string, unknown>)[key];
        if (isLogicValue(value)) out[key] = toPlain(value, key);
      }
      return out as Partial<Record<string, unknown>>;
    },
    restore(value: Partial<Record<string, unknown>>) {
      for (const key of Object.keys(value)) {
        (raw as Record<string, unknown>)[key] = toPlain(value[key], key);
      }
      logs.clear();
    },
    rollbackTo(targetFrame: number) {
      const frames = [...logs.keys()].filter((f) => f > targetFrame).sort((a, b) => b - a);
      for (const frame of frames) {
        const entries = logs.get(frame)!;
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.key === "__array__") {
            const arr = entry.raw as unknown[];
            const before = entry.oldValue as LogicValue[];
            arr.length = 0;
            for (let j = 0; j < before.length; j++) arr[j] = before[j];
          } else if (entry.hadKey) {
            (entry.raw as Record<string | symbol, unknown>)[entry.key] = entry.oldValue;
          } else {
            delete (entry.raw as Record<string | symbol, unknown>)[entry.key];
          }
        }
        logs.delete(frame);
      }
      tracker.frame = Math.trunc(targetFrame);
    },
    clearHistory() { logs.clear(); },
    forgetFramesBefore(frame: number) {
      for (const f of [...logs.keys()]) if (f < frame) logs.delete(f);
    },
    get historyFrames() { return [...logs.keys()].sort((a, b) => a - b); },
  } as LogicStateHandle<Record<string, unknown>>;

  const proxy = makeProxy(raw, tracker, "$");
  Object.defineProperty(proxy, LOGIC_HANDLE, {
    value: tracker.handle,
    enumerable: false,
    configurable: false,
  });
  return proxy as Tracked<T>;
}

/** 从普通数据创建一个追踪对象（用于 LogicWorld 的实体状态）。 */
export function createLogicState<T extends object>(initial: T, frame = 0): Tracked<T> {
  return trackLogicObject(toPlain(initial) as unknown as T, frame);
}

/** 取出状态句柄；不是追踪对象时返回 null。 */
export function getLogicHandle<T extends object>(state: Tracked<T>): LogicStateHandle<T> | null;
export function getLogicHandle<T extends object>(state: T): LogicStateHandle<T> | null;
export function getLogicHandle(state: object): LogicStateHandle<object> | null {
  return (state as Record<symbol, unknown>)[LOGIC_HANDLE] as LogicStateHandle<object> ?? null;
}
