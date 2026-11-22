import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonsterEquipmentSlots } from '../data/monsterCodex';

interface Props {
  slots: MonsterEquipmentSlots;
}

/**
 * 装备格预览（2 列 × 4 行）。
 *
 * ```
 * XH
 * 1B
 * 2B
 * RR
 * ```
 * X 空、H 头部装备、1 主手、2 副手、B 本体、R 坐骑。
 * 未装备的槽位仍显示槽位图标（暗色），只有 X 是真正的空位。
 */
export default function EquipmentSlotGrid({ slots }: Props) {
  const { t } = useTranslation();

  const cells: CellSpec[] = [
    { key: 'empty', column: 1, row: 1, state: 'empty' },
    {
      key: 'head',
      column: 2,
      row: 1,
      state: slots.head ? 'filled' : 'empty-slot',
      icon: <HelmetIcon />,
      title: t('edx.section_head'),
    },
    {
      key: 'main-hand',
      column: 1,
      row: 2,
      state: slots.mainHand ? 'filled' : 'empty-slot',
      icon: <SwordIcon />,
      title: t('edx.section_main_hand'),
    },
    {
      key: 'body',
      column: 2,
      row: 2,
      rowSpan: 2,
      state: 'filled',
      icon: <BodyIcon />,
      title: t('edx.section_body'),
    },
    {
      key: 'off-hand',
      column: 1,
      row: 3,
      state: slots.offHand ? 'filled' : 'empty-slot',
      icon: <ShieldIcon />,
      title: t('edx.section_off_hand'),
    },
    {
      key: 'mount',
      column: 1,
      row: 4,
      columnSpan: 2,
      state: slots.mount ? 'filled' : 'empty-slot',
      icon: <MountIcon />,
      title: t('edx.section_mount'),
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: 'repeat(4, 1fr)',
      gap: '4px',
      width: '100%',
      aspectRatio: '1 / 2',
    }}>
      {cells.map((cell) => (
        <div key={cell.key} title={cell.title} style={cellStyle(cell)}>
          {cell.icon ? (
            <span style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
            }}>
              {cell.icon}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

type CellState = 'filled' | 'empty-slot' | 'empty';

interface CellSpec {
  key: string;
  column: number;
  row: number;
  columnSpan?: number;
  rowSpan?: number;
  state: CellState;
  icon?: ReactNode;
  title?: string;
}

function cellStyle(cell: CellSpec): CSSProperties {
  const empty = cell.state === 'empty';
  const filled = cell.state === 'filled';
  return {
    gridColumn: `${cell.column} / span ${cell.columnSpan ?? 1}`,
    gridRow: `${cell.row} / span ${cell.rowSpan ?? 1}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
    borderRadius: '4px',
    background: empty ? 'transparent' : filled ? '#3a3524' : '#2a2a2a',
    border: empty
      ? '1px dashed #4a4a4a'
      : filled ? '1px solid #5a5133' : '1px solid #3f3f3f',
    color: filled ? '#e6d8a8' : '#5f5f5f',
  };
}

const ICON_STYLE: CSSProperties = {
  width: '78%',
  height: '78%',
  maxWidth: '26px',
  maxHeight: '26px',
  display: 'block',
};

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function HelmetIcon() {
  return (
    <svg {...ICON_PROPS} style={ICON_STYLE}>
      <path d="M5 13a7 7 0 0 1 14 0v2H5z" />
      <path d="M3.5 15h17" />
    </svg>
  );
}

function SwordIcon() {
  return (
    <svg {...ICON_PROPS} style={ICON_STYLE}>
      <path d="M19.5 4.5 9.5 14.5" />
      <path d="M6 13.5 10.5 18" />
      <path d="M8 16 4.5 19.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...ICON_PROPS} style={ICON_STYLE}>
      <path d="M12 3.5 19 6.2v5.6c0 4.5-3 7.6-7 8.7-4-1.1-7-4.2-7-8.7V6.2z" />
    </svg>
  );
}

function BodyIcon() {
  return (
    <svg {...ICON_PROPS} style={ICON_STYLE}>
      <circle cx="12" cy="7" r="3.4" />
      <path d="M5.5 20.5c0-4 2.9-6.5 6.5-6.5s6.5 2.5 6.5 6.5" />
    </svg>
  );
}

/** 坐骑用马蹄铁，避免和头部/手持件混淆。 */
function MountIcon() {
  return (
    <svg {...ICON_PROPS} style={ICON_STYLE}>
      <path d="M7 3.5h3v8a2 2 0 0 0 4 0v-8h3v8a5 5 0 0 1-10 0z" />
    </svg>
  );
}
