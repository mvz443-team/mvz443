import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import { cardTextKey } from '../../i18n/cardText';
import { CARD_MAX_LEVEL } from './cardStats';

interface Props {
  /** 卡片文案基名，例如 dispenser */
  base: string;
  /** 已解锁判定基准等级 */
  unlockedLevel: number;
  /** 是否让“升级后即将解锁”的那一条在灰色/蓝色之间闪烁 */
  blinkNextUnlock?: boolean;
}

interface AdvanceEntry {
  level: number;
  text: string;
}

/**
 * 进阶解锁列表。
 *
 * 进阶文案来自 `card.<base>_advance-<level>`，等级本身就是解锁条件；
 * 已解锁用蓝色条目，未解锁用灰色条目，可选的“下一条”做灰蓝交替闪烁。
 */
export default function CardAdvanceList({ base, unlockedLevel, blinkNextUnlock = false }: Props) {
  const { translate } = useLocaleMessages();

  const entries: AdvanceEntry[] = [];
  if (base) {
    for (let level = 1; level <= CARD_MAX_LEVEL; level += 1) {
      const text = translate(cardTextKey.advance(base, level), { defaultValue: '' });
      if (text) entries.push({ level, text });
    }
  }

  if (entries.length === 0) return null;

  // 只有“再升一级就解锁”的那条才闪烁；更远的进阶保持灰色。
  const blinkLevel = blinkNextUnlock ? unlockedLevel + 1 : null;

  return (
    <div className="card-advances">
      {entries.map(entry => {
        const unlocked = entry.level <= unlockedLevel;
        const blinking = entry.level === blinkLevel;
        return (
          <div
            key={entry.level}
            className={`card-advance-item ${unlocked ? 'is-unlocked' : 'is-locked'} ${blinking ? 'is-blinking' : ''}`}
          >
            {translate('shop.card_advance_item', { level: entry.level, text: entry.text })}
          </div>
        );
      })}
      <style>
        {`
          .card-advances { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
          .card-advance-item {
            padding: 6px 10px; border-radius: 4px; font-size: 13px; line-height: 1.5;
            border-left: 3px solid transparent;
          }
          .card-advance-item.is-unlocked {
            color: #63b3ff; background: rgba(61,139,214,.12); border-left-color: #3d8bd6;
          }
          .card-advance-item.is-locked {
            color: #8a9099; background: rgba(255,255,255,.04); border-left-color: #5a6068;
          }
          .card-advance-item.is-blinking { animation: cardAdvanceBlink 1s steps(1, end) infinite; }
          @keyframes cardAdvanceBlink {
            0%, 49% {
              color: #63b3ff; background: rgba(61,139,214,.20); border-left-color: #3d8bd6;
            }
            50%, 100% {
              color: #8a9099; background: rgba(255,255,255,.04); border-left-color: #5a6068;
            }
          }
        `}
      </style>
    </div>
  );
}
