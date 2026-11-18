/**
 * 固定容量的对象环形缓冲区。
 *
 * 旧实现用普通数组 push + shift：每写满一次就要整体前移最多 20 个条目，
 * 且每次都会让 V8 重新整理数组存储。快照本身已经是大对象，缓冲区自身的
 * 搬移/分配虽然不是主瓶颈，但在 20FPS 的固定步里仍然是不必要的成本。
 *
 * 这里使用预分配槽位 + 逻辑起点，写入和读取都是 O(1)，不搬移任何元素。
 * 容量只有 20，接口刻意保持简单；不依赖第三方 typed-array ring buffer，
 * 因为 ringbuf.js 面向 SPSC 字节流，无法保存异构 SimulationState 对象。
 */
export class SnapshotRingBuffer<T> {
  private readonly slots: Array<T | undefined>;
  private start = 0;
  private count = 0;

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`SnapshotRingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.slots = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  /** 追加一个条目；缓冲区满时覆盖最旧条目。 */
  push(value: T): void {
    const writeIndex = (this.start + this.count) % this.capacity;
    this.slots[writeIndex] = value;
    if (this.count < this.capacity) {
      this.count += 1;
      return;
    }
    // 覆盖完成后逻辑起点前移一位，原最旧槽位已成为最新条目。
    this.start = (this.start + 1) % this.capacity;
  }

  /** 按从旧到新的逻辑顺序读取，越界返回 undefined。 */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return this.slots[(this.start + index) % this.capacity];
  }

  last(): T | undefined {
    if (this.count === 0) return undefined;
    return this.slots[(this.start + this.count - 1) % this.capacity];
  }

  /** 只物化诊断用数组，不在热路径调用。 */
  toArray(): T[] {
    const result = new Array<T>(this.count);
    for (let i = 0; i < this.count; i += 1) {
      result[i] = this.get(i) as T;
    }
    return result;
  }
}
