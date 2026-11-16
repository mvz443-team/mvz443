const MAX_LEVEL = 9;
const LOG_MAX_LEVEL = Math.log(MAX_LEVEL);

export function GetIncValue(origin: number, ratio: number, level: number): number {
  // 计算常数c，公式：c = (ratio - 1) / log(9)
  const c = (ratio - 1) / Math.log(MAX_LEVEL);

  // 使用公式计算当前等级的伤害
  const damage = origin * (1 + c * Math.log(level));

  // 保留三位小数并返回
  return parseFloat(damage.toFixed(3));
}

export function GetDecValue(origin: number, ratio: number, level: number): number {
  // 计算常数c，公式：c = (1 - ratio) / log(maxLevel)
  const c = (1 - ratio) / Math.log(MAX_LEVEL);

  // 使用公式计算当前等级的冷却时间
  const cooldown = origin * (1 - c * Math.log(level));

  // 保留三位小数并返回
  return parseFloat(cooldown.toFixed(3));
}

// 初始等级为0

export class LevelScaledValue {
  private base: number;
  private incRatio: number | null = null;
  private decRatio: number | null = null;
  private levelThresholds: Record<number, number> = {};

  private _cache: Float64Array | null = null;

  constructor(base: number) {
    this.base = base;
  }

  private _invalidateCache(): void {
    this._cache = null;
  }

  public setIncRatio(ratio: number): this {
    this.incRatio = ratio;
    this._invalidateCache();
    return this;
  }

  public setDecValue(ratio: number): this {
    this.decRatio = ratio;
    this._invalidateCache();
    return this;
  }

  public setThreshold(level: number, value: number): this {
    this.levelThresholds[level] = value;
    this._invalidateCache();
    return this;
  }

  /**
   * ✅ O(1) 访问，无 Math.log，无 toFixed，无对象遍历
   */
  public getValueAt(level: number): number {
    if (!this._cache) this._buildCache();
    // 边界保护：clamp 到 [0, MAX_LEVEL]
    const idx = level < 0 ? 0 : level > MAX_LEVEL ? MAX_LEVEL : level;
    return this._cache![idx];
  }

  private _buildCache(): void {
    const cache = new Float64Array(MAX_LEVEL + 1);

    // 预处理阈值：按等级排序，便于线性扫描
    const thresholdLevels = Object.keys(this.levelThresholds)
      .map(Number)
      .sort((a, b) => a - b);

    let currentBase = this.base;
    let nextThresholdIdx = 0;
    let effectiveLevelOffset = 0;

    for (let lvl = 0; lvl <= MAX_LEVEL; lvl++) {
      // 检查是否命中阈值点
      while (
        nextThresholdIdx < thresholdLevels.length &&
        thresholdLevels[nextThresholdIdx] === lvl
      ) {
        currentBase = this.levelThresholds[lvl];
        effectiveLevelOffset = lvl - 1; // effectiveLevel = lvl - maxAppliedLevel + 1
        nextThresholdIdx++;
      }

      const effectiveLevel = lvl - effectiveLevelOffset;

      if (this.incRatio !== null) {
        const c = (this.incRatio - 1) / LOG_MAX_LEVEL;
        cache[lvl] = parseFloat((currentBase * (1 + c * Math.log(effectiveLevel || 1))).toFixed(3));
      } else if (this.decRatio !== null) {
        const c = (1 - this.decRatio) / LOG_MAX_LEVEL;
        cache[lvl] = parseFloat((currentBase * (1 - c * Math.log(effectiveLevel || 1))).toFixed(3));
      } else {
        cache[lvl] = currentBase;
      }
    }

    this._cache = cache;
  }
}

/**
 * 
// 基础 100，每级伤害增加，5级突变为 300
const stat = new LevelScaledValue(100)
  .setIncRatio(1.5) 
  .setThreshold(5, 300);

// Level 1: 基础值
console.log("L1:", stat.getValueAt(1)); // 100

// Level 4: 正常的对数增长 (基于 100)
console.log("L4:", stat.getValueAt(4)); // 100 * (1 + c * log(4)) ≈ 128.847

// Level 5: 发生突变 (直接返回 300)
console.log("L5:", stat.getValueAt(5)); // 300

// Level 6: 基于 300 的第二次增长
// effectiveLevel = 6 - 5 + 1 = 2
console.log("L6:", stat.getValueAt(6)); // 300 * (1 + c * log(2)) ≈ 315.659
 */