import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import EdxPreviewHost from '../preview/EdxPreviewHost';
import type { EdxPreviewSelection } from '../preview/edxPreviewConfig';
import {
  MONSTER_GROUP_LABELS,
  getMonsterCodexEntries,
  getMonsterCodexEntry,
  normalizeLocale,
  pickLocalized,
  readMonsterDetailSections,
  readMonsterEquipmentSlots,
  type MonsterCodexEntry,
  type MonsterCodexGroup,
} from '../data/monsterCodex';
import EquipmentSlotGrid from './EquipmentSlotGrid';

interface Props {
  width: number;
  height: number;
  onBack: () => void;
}

const GROUP_ORDER: MonsterCodexGroup[] = ['medium', 'mutant', 'golem', 'boss', 'special'];

const SECTION_TITLE_STYLE: CSSProperties = {
  color: '#8d979d',
  fontSize: '12px',
  letterSpacing: '1px',
  marginBottom: '4px',
};

const STAT_CARD_STYLE: CSSProperties = {
  background: '#333a3f',
  borderRadius: '5px',
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

/**
 * 僵尸图鉴。
 *
 * 左栏按类型分组列出怪物（中型僵尸 / 突变僵尸 / 傀儡 / BOSS / 特殊），
 * 右栏展示 Phaser 行动预览、标题与描述、装备格与数值，最后逐行列出技能。
 * 数值全部从 preset Model 与装备定义读取，不在图鉴里写死。
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

  const sections = useMemo(
    () => (selected ? readMonsterDetailSections(selected.mid, selected.group, locale) : []),
    [selected?.mid, locale],
  );
  const slots = useMemo(
    () => (selected ? readMonsterEquipmentSlots(selected.mid) : null),
    [selected?.mid],
  );
  const showSlotGrid = selected?.group === 'medium' && slots !== null;
  const skills = selected?.skills ?? [];

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

      {/* 右栏：预览 + 标题/描述 + 装备格与数值 + 技能 */}
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
          flex: '0 0 42%',
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

            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              {showSlotGrid ? (
                <div style={{ flex: '0 0 5%', minWidth: '64px', maxWidth: '110px' }}>
                  <EquipmentSlotGrid slots={slots!} />
                </div>
              ) : null}

              <div style={{
                flex: '1 1 auto',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}>
                {sections.map((section) => (
                  <div key={section.key}>
                    {sections.length > 1 ? (
                      <div style={SECTION_TITLE_STYLE}>
                        {t(`edx.section_${section.key}`)}
                      </div>
                    ) : null}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                      gap: '8px',
                    }}>
                      {section.rows.map((row) => (
                        <div
                          key={`${section.key}-${row.labelKey}`}
                          style={row.labelKey === 'mount_rule'
                            ? { ...STAT_CARD_STYLE, gridColumn: '1 / -1' }
                            : STAT_CARD_STYLE}
                        >
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
                ))}
              </div>
            </div>

            {skills.length > 0 ? (
              <div style={{ marginTop: '12px' }}>
                <div style={SECTION_TITLE_STYLE}>{t('edx.skills')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {skills.map((skill) => (
                    <div
                      key={skill.name.zh_CN}
                      style={{ display: 'flex', gap: '8px', alignItems: 'baseline', lineHeight: 1.5 }}
                    >
                      <span style={{ flex: '0 0 auto', color: '#e6d8a8', fontWeight: 700 }}>
                        {pickLocalized(skill.name, locale)}
                      </span>
                      <span style={{ color: '#c8ced2' }}>
                        {pickLocalized(skill.description, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
