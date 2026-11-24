import type { PlantModel } from '../../game/models/PlantModel';
import type { LevelScaledValue } from '../../utils/numbervalue';

/** 与 DamageConstants.SECKILL 同量级，表示“秒杀级”数值，界面不展示具体数字。 */
const IMPLAUSIBLE_VALUE = 999999;

export type CardStatKey = 'health' | 'damage' | 'cooldown' | 'cost';

export interface CardStatRow {
  key: CardStatKey;
  labelKey: string;
  /** 当前等级显示文本 */
  current: string;
  /** 下一级显示文本；不比较时为 null */
  next: string | null;
  /** 下一级是否与当前等级不同 */
  changed: boolean;
}

function readValue(source: LevelScaledValue | undefined, level: number): number {
  return source ? source.getValueAt(level) : 0;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= IMPLAUSIBLE_VALUE) return '—';
  if (value <= 0) return '—';
  return String(Math.round(value));
}

function formatCost(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return String(Math.max(0, Math.round(value)));
}

function formatCooldown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = ms / 1000;
  const text = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${text}s`;
}

function formatValue(key: CardStatKey, value: number): string {
  if (key === 'cost') return formatCost(value);
  if (key === 'cooldown') return formatCooldown(value);
  return formatCount(value);
}

/**
 * 生成卡片基础数值行。
 *
 * 数值全部读取 Model 的 `LevelScaledValue`，与战斗中的真实取值同源，
 * 避免界面另写一套公式造成展示与实际不一致。
 */
export function buildCardStatRows(
  model: PlantModel,
  level: number,
  compareNext: boolean,
): CardStatRow[] {
  const nextLevel = level + 1;
  const definitions: Array<{ key: CardStatKey; labelKey: string; source: LevelScaledValue }> = [
    { key: 'health', labelKey: 'shop.card_stat_health', source: model.maxHealth },
    { key: 'damage', labelKey: 'shop.card_stat_damage', source: model.damage },
    { key: 'cooldown', labelKey: 'shop.card_stat_cooldown', source: model.cooldown },
    { key: 'cost', labelKey: 'shop.card_stat_cost', source: model.cost },
  ];

  return definitions.map(({ key, labelKey, source }) => {
    const currentValue = readValue(source, level);
    const nextValue = compareNext ? readValue(source, nextLevel) : currentValue;
    return {
      key,
      labelKey,
      current: formatValue(key, currentValue),
      next: compareNext ? formatValue(key, nextValue) : null,
      changed: compareNext && Math.abs(nextValue - currentValue) > 1e-6,
    };
  });
}

/** 卡片最高等级：与 LevelScaledValue 的缓存上限保持一致。 */
export const CARD_MAX_LEVEL = 9;
