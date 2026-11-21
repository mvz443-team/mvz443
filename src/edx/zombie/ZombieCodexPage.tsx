import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EdxPreviewHost from '../preview/EdxPreviewHost';
import type { EdxPreviewSelection } from '../preview/edxPreviewConfig';
import {
  MONSTER_GROUP_LABELS,
  getMonsterCodexEntries,
  getMonsterCodexEntry,
  normalizeLocale,
  pickLocalized,
  readMonsterStatRows,
  readMonsterTraits,
  type MonsterCodexEntry,
  type MonsterCodexGroup,
} from '../data/monsterCodex';

interface Props {
  width: number;
  height: number;
  onBack: () => void;
}

const GROUP_ORDER: MonsterCodexGroup[] = [
  'zombie',
  'armored',
  'ranged',
  'special',
  'water',
  'flying',
  'summon',
  'elite',
  'boss',
];

/**
 * 僵尸图鉴。
 *
 * 左栏按类型分组列出所有怪物（数据来自 MonsterLibrary 的 preset 表），
 * 右栏展示 Phaser 行动预览、数值与机制描述；预览里怪物会自己走向前排队友并开打。
 */
export default function ZombieCodexPage({ width, height, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const entries = useMemo(() => getMonsterCodexEntries(), []);
  const [selectedMid, setSelectedMid] = useState<number>(entries[0]?.mid ?? 1);
  const selected = getMonsterCodexEntry(selectedMid) ?? entries[0];

  const grouped = useMemo(() => {
    const buckets = new Map<MonsterCodexGroup, MonsterCodexEntry[]>();
    for (const entry of entries) {
      const list = buckets.get(entry.group) ?? [];
      list.push(entry);
      buckets.set(entry.group, list);
    }
    return GROUP_ORDER
      .map((group) => ({ group, items: buckets.get(group) ?? [] }))
      .filter((bucket) => bucket.items.length > 0);
  }, [entries]);

  const selection = useMemo<EdxPreviewSelection | null>(
    () => (selected ? { mode: 'monster', mid: selected.mid } : null),
    [selected?.mid],
  );

  return (
    <div style={{
      width: `${width}px`,
      height: `${height}px`,
      background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
      border: '2px solid #444',
      boxShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
      display: 'flex',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      {/* 左栏：分组列表 */}
      <div style={{
        width: '36%',
        minWidth: '260px',
        height: '100%',
        boxSizing: 'border-box',
        borderRight: '1px solid #444',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        <div style={{
          height: '52px',
          minHeight: '52px',
          borderBottom: '1px solid #444',
          padding: '6px 4px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <button
            style={{
              padding: '6px 10px',
              background: '#444',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              borderRadius: '4px',
              fontSize: '14px',
            }}
            onClick={onBack}
          >
            {t('edx.back')}
          </button>
          <h2 style={{ margin: 0, color: '#ddd', fontSize: '18px', fontWeight: 700 }}>
            {t('edx.zombie')}
          </h2>
        </div>

        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: '#888 #333',
          paddingRight: '2px',
        }}>
          {grouped.map((bucket) => (
            <div key={bucket.group} style={{ marginBottom: '10px' }}>
              <div style={{
                color: '#7f8b93',
                fontSize: '12px',
                letterSpacing: '1px',
                padding: '4px 2px',
              }}>
                {pickLocalized(MONSTER_GROUP_LABELS[bucket.group], locale)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {bucket.items.map((item) => {
                  const active = item.mid === selected?.mid;
                  return (
                    <button
                      key={item.mid}
                      onClick={() => setSelectedMid(item.mid)}
                      style={{
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: '5px',
                        border: active ? '1px solid #f4f4f4' : '1px solid #4a4a4a',
                        background: active ? '#3f5360' : '#2f2f2f',
                        color: '#e2e2e2',
                        fontSize: '14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {pickLocalized(item.name, locale)}
                      </span>
                      <span style={{ color: '#8d979d', fontSize: '12px' }}>#{item.mid}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右栏：预览 + 数值 + 描述 */}
      <div style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        boxSizing: 'border-box',
        padding: '16px 20px',
        color: '#ddd',
        background: 'rgba(30, 30, 30, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        overflow: 'hidden',
      }}>
        <div style={{
          flex: '0 0 50%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            color: '#9aa4aa',
            fontSize: '12px',
            marginBottom: '4px',
            letterSpacing: '1px',
            flex: '0 0 auto',
          }}>
            {t('edx.monster_preview')}
          </div>
          <EdxPreviewHost selection={selection} style={{ flex: '1 1 auto', minHeight: 0 }} />
        </div>

        {selected ? (
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: '#888 #333',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: '0 0 6px 0' }}>{pickLocalized(selected.name, locale)}</h2>
              <span style={{
                fontSize: '12px',
                color: '#9fd7ff',
                border: '1px solid #3a5f78',
                borderRadius: '4px',
                padding: '1px 6px',
              }}>
                {pickLocalized(MONSTER_GROUP_LABELS[selected.group], locale)}
              </span>
            </div>

            <div style={{ whiteSpace: 'pre-wrap', color: '#c8ced2', marginBottom: '12px', lineHeight: 1.6 }}>
              {pickLocalized(selected.description, locale)}
            </div>

            {readMonsterTraits(selected.mid, locale).length > 0 ? (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ color: '#8d979d', fontSize: '12px', marginBottom: '4px' }}>
                  {t('edx.traits')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {readMonsterTraits(selected.mid, locale).map((trait) => (
                    <span key={trait} style={{
                      fontSize: '12px',
                      color: '#e6d8a8',
                      background: '#3a3524',
                      border: '1px solid #5a5133',
                      borderRadius: '4px',
                      padding: '2px 8px',
                    }}>
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: '8px',
            }}>
              {readMonsterStatRows(selected.mid, locale).map((row) => (
                <div key={row.labelKey} style={{
                  background: '#333a3f',
                  borderRadius: '5px',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}>
                  <span style={{ fontSize: '11px', color: '#8d979d' }}>
                    {t(`edx.stat_${row.labelKey}`)}
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#f0f4f6' }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ paddingTop: '20px', textAlign: 'center', color: '#888' }}>
            {t('edx.select_hint')}
          </div>
        )}
      </div>
    </div>
  );
}
