import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStageCodexEntries, type StageCodexEntry } from '../data/stageCodex';

interface Props {
  width: number;
  height: number;
  onBack: () => void;
}

/**
 * 地图图鉴。
 *
 * 只展示关卡地图本身：格子数量、水路行、初始能量与波次，全部来自
 * `public/stages/**` 的关卡配置（rows）+ StageTerrain 推导的水路行。
 */
export default function StageCodexPage({ width, height, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<StageCodexEntry[] | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    loadStageCodexEntries()
      .then((list) => {
        if (!alive) return;
        setEntries(list);
        setSelectedStageId((current) => current ?? list[0]?.stageId ?? null);
      })
      .catch((error) => {
        console.error('[EdxStageCodex] 读取关卡配置失败', error);
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => entries?.find((entry) => entry.stageId === selectedStageId) ?? null,
    [entries, selectedStageId],
  );

  const separator = i18n.language === 'en_US' ? ', ' : '、';

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
      <div style={{
        width: '32%',
        minWidth: '220px',
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
            {t('edx.map')}
          </h2>
        </div>

        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: '#888 #333',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          {entries === null ? (
            <div style={{ color: '#8d979d', fontSize: '13px', padding: '8px 4px' }}>
              {t('edx.map_loading')}
            </div>
          ) : entries.length === 0 ? (
            <div style={{ color: '#8d979d', fontSize: '13px', padding: '8px 4px' }}>
              {t('edx.map_empty')}
            </div>
          ) : entries.map((entry) => {
            const active = entry.stageId === selected?.stageId;
            return (
              <button
                key={entry.stageId}
                onClick={() => setSelectedStageId(entry.stageId)}
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
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <span>{t(`stage.${entry.nameKey}`)}</span>
                <span style={{ color: '#8d979d', fontSize: '12px' }}>
                  {t('edx.map_rows', { rows: entry.rows, cols: entry.cols })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: '#888 #333',
      }}>
        {selected ? (
          <>
            <h2 style={{ margin: 0 }}>{t(`stage.${selected.nameKey}`)}</h2>

            {/* 描述信息放在地形图上方：格子数量与水路永远不用滚动就能看到。 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '8px',
            }}>
              <InfoTile label={t('edx.map_grid')} value={t('edx.map_rows', { rows: selected.rows, cols: selected.cols })} />
              <InfoTile
                label={t('edx.map_water')}
                value={selected.waterWays.length === 0
                  ? t('edx.map_water_none')
                  : t('edx.map_water_rows', {
                    rows: selected.waterWays.map((row) => row + 1).join(separator),
                  })}
              />
              <InfoTile label={t('edx.map_energy')} value={String(selected.energy)} />
              <InfoTile label={t('edx.map_waves')} value={String(selected.totalWaves)} />
              <InfoTile
                label={t('edx.map_time')}
                value={selected.dayOrNight === 2 ? t('edx.map_night') : t('edx.map_day')}
              />
            </div>

            <div style={{ color: '#9aa4aa', fontSize: '12px', letterSpacing: '1px' }}>
              {t('edx.map_preview')}
            </div>
            <TerrainPreview entry={selected} />
          </>
        ) : (
          <div style={{ paddingTop: '20px', textAlign: 'center', color: '#888' }}>
            {t('edx.select_hint')}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: '#333a3f',
      borderRadius: '5px',
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    }}>
      <span style={{ fontSize: '11px', color: '#8d979d' }}>{label}</span>
      <span style={{ fontSize: '15px', fontWeight: 700, color: '#f0f4f6' }}>{value}</span>
    </div>
  );
}

/** 用 CSS 画出关卡地图：行号 + 9 列格子，水路行高亮。 */
function TerrainPreview({ entry }: { entry: StageCodexEntry }) {
  const rows = Math.max(1, entry.rows);
  const cols = Math.max(1, entry.cols);
  const waterRows = new Set(entry.waterWays);

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-around',
        color: '#8d979d',
        fontSize: '11px',
      }}>
        {Array.from({ length: rows }, (_, row) => (
          <span key={row} style={{ lineHeight: `${90 / 11}px` }}>{row + 1}</span>
        ))}
      </div>
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: '2px',
        border: '2px solid #4d6b5c',
        borderRadius: '4px',
        padding: '3px',
        background: '#141a18',
      }}>
        {Array.from({ length: rows }, (_, row) => (
          Array.from({ length: cols }, (_, col) => {
            const isWater = waterRows.has(row);
            return (
              <div
                key={`${row}-${col}`}
                style={{
                  aspectRatio: '8 / 9',
                  borderRadius: '2px',
                  background: isWater
                    ? 'linear-gradient(180deg, #1d4c6b 0%, #163a52 100%)'
                    : 'linear-gradient(180deg, #2f3a2b 0%, #26301f 100%)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              />
            );
          })
        ))}
      </div>
    </div>
  );
}
