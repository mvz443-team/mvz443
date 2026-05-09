// src/components/StageSelector.tsx
import React, { useEffect } from 'react';
import { ChapterDataRecords, StageDataRecords } from '../../../game/managers/library/ChapterLibrary';
import { useSaveManager } from '../../../context/save_ctx';
import { publicUrl } from '../../../utils/browser';
import { useSettings } from '../../../context/settings_ctx';
import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import { stageKey } from '../../../i18n/keys';
import { useSetState, useLocalStorageState, useMount, useMemoizedFn } from 'ahooks';
import type { StageData } from '../../../types/stage';
import type { LevelIntroItem } from '../../../types/drama';

type StageSelectorStageData = Pick<StageData, 'levelIntro' | 'rows' | 'stageScript' | 'onWin'>;

interface StageSelectorProps {
  chapterId: number;
  onSelect: (stageId: number) => void;
  onBack: () => void;
}

const StageSelector: React.FC<StageSelectorProps> = ({ chapterId, onSelect, onBack }) => {
  const [state, setState] = useSetState({
    selectedStage: null as number | null,
    stagesIds: [] as number[],
    levelIntro: [] as LevelIntroItem[],
    selectedStageData: null as StageSelectorStageData | null,
    isIntroLoading: false,
  });

  // 使用 useLocalStorageState 保存用户选择的关卡
  const [stageSelection, setStageSelection] = useLocalStorageState('stageSelection', {
    defaultValue: {
      lastSelectedStage: null as number | null,
      lastChapterId: null as number | null,
    }
  });

  const saveManager = useSaveManager();
  const settings = useSettings();
  const { translate } = useLocaleMessages();

  // 计算可用关卡
  const calculateAvailableStages = useMemoizedFn(() => {
    const chapterStages = ChapterDataRecords[chapterId]?.stages || [];
    const tmpStagesIds: number[] = [];
    for (const stageId of chapterStages) {
      if (saveManager.isLevelUnlocked(stageId, chapterId)) {
        tmpStagesIds.push(stageId);
      }
    }
    return tmpStagesIds.sort((a, b) => a - b);
  });

  // 初始化可用关卡
  useMount(() => {
    const stages = calculateAvailableStages();
    setState({ stagesIds: stages });

    // 恢复上次选择的关卡（如果是在同一章节）
    if (stageSelection.lastChapterId === chapterId &&
      stageSelection.lastSelectedStage &&
      stages.includes(stageSelection.lastSelectedStage)) {
      setState({ selectedStage: stageSelection.lastSelectedStage });
    }
  });

  const handleStageSelect = useMemoizedFn((stageId: number) => {
    setState({ selectedStage: stageId });
    setStageSelection({
      lastSelectedStage: stageId,
      lastChapterId: chapterId
    });
  });

  useEffect(() => {
    if (state.selectedStage === null) {
      setState({ levelIntro: [], selectedStageData: null, isIntroLoading: false });
      return;
    }

    let isCancelled = false;
    const stageRecord = StageDataRecords[state.selectedStage];
    if (!stageRecord) {
      setState({ levelIntro: [], selectedStageData: null, isIntroLoading: false });
      return;
    }

    const loadIntro = async () => {
      setState({ selectedStageData: null, isIntroLoading: true });
      try {
        const response = await fetch(`${publicUrl}/${stageRecord.dataPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load stage intro: ${stageRecord.dataPath}`);
        }
        const stageData = await response.json() as StageSelectorStageData;
        if (isCancelled) {
          return;
        }
        setState({
          levelIntro: stageData.levelIntro ?? [{ type: 'text', content: stageRecord.descriptionKey }],
          selectedStageData: stageData,
          isIntroLoading: false,
        });
      } catch (error) {
        console.warn(error);
        if (!isCancelled) {
          setState({
            levelIntro: [{ type: 'text', content: stageRecord.descriptionKey }],
            selectedStageData: null,
            isIntroLoading: false,
          });
        }
      }
    };

    void loadIntro();

    return () => {
      isCancelled = true;
    };
  }, [state.selectedStage]);

  const handleNext = useMemoizedFn(() => {
    if (state.selectedStage !== null) {
      onSelect(state.selectedStage);
    }
  });

  const selectedStageRecord = state.selectedStage !== null ? StageDataRecords[state.selectedStage] : null;
  const selectedStageName = selectedStageRecord ? translate(stageKey(selectedStageRecord.nameKey)) : '';
  const selectedStageCompleted = state.selectedStage !== null && saveManager.isLevelPassed(state.selectedStage, chapterId);
  const stageLightText = state.selectedStageData
    ? (state.selectedStageData.stageScript.dayOrNight === 1 ? '光照强烈' : '无光')
    : translate('common.loading');
  const stageRowsText = state.selectedStageData ? `${state.selectedStageData.rows}` : translate('common.loading');
  const stageBossInsertCount = state.selectedStageData?.stageScript.bossInsert.length ?? 0;
  const stageWaveCount = state.selectedStageData
    ? state.selectedStageData.stageScript.total_waves + stageBossInsertCount
    : 0;
  const stageThreatText = stageBossInsertCount > 1 ? '精英+Boss' : stageBossInsertCount === 1 ? 'Boss' : '无 Boss';
  const stageSummaryText = state.selectedStageData
    ? `${stageWaveCount} 波 · ${stageThreatText}`
    : translate('common.loading');
  const stageSummaryPercent = state.selectedStageData
    ? Math.min(100, Math.max(18, (stageWaveCount / 40) * 100))
    : 0;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
      position: 'relative',
      overflow: 'hidden',
      border: '2px solid #444',
      boxShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
    }}>
      {/* 左侧 25% - 关卡选择 */}
      <div style={{
        width: '25%',
        height: '100%',
        position: 'absolute',
        left: 0,
        top: 0,
        background: 'rgba(20, 20, 20, 0.85)',
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: '#666 #333',
      }}>
        <button
          className='backbutton'
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.boxShadow = 'inset 0 0 0 2px #00ccff';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.boxShadow = 'inset 0 0 0 2px rgba(100, 100, 100, 0.3)';
          }}
          onClick={onBack}
        >
          {translate('menu.back')}
        </button>
        {state.stagesIds.map((stageId) => (
          <button
            key={stageId}
            className='menubutton'
            style={{
              background: state.selectedStage === stageId ? 'rgba(255, 255, 255, 0.1)' : 'none',
              boxShadow: state.selectedStage === stageId
                ? 'inset 0 0 0 2px #00ccff'
                : 'inset 0 0 0 2px rgba(100, 100, 100, 0.3)',
            }}
            onMouseOver={(e) => {
              if (state.selectedStage !== stageId) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.boxShadow = 'inset 0 0 0 2px #00ccff';
              }
            }}
            onMouseOut={(e) => {
              if (state.selectedStage !== stageId) {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.boxShadow = 'inset 0 0 0 2px rgba(100, 100, 100, 0.3)';
              }
            }}
            onClick={() => handleStageSelect(stageId)}
          >
            {translate(stageKey(StageDataRecords[stageId].nameKey))}
          </button>
        ))}
      </div>

      {/* 右侧 70% - 关卡描述 */}
      <div style={{
        width: '70%',
        height: '94%',
        position: 'absolute',
        right: 0,
        top: 0,
        padding: '20px',
        color: '#ddd',
        overflowY: 'auto',
        background: 'rgba(30, 30, 30, 0.9)',
        scrollbarColor: '#666 #333',
      }}>
        {selectedStageRecord && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '20px',
            marginBottom: '20px',
            padding: '16px 18px',
            border: '1px solid rgba(0, 204, 255, 0.45)',
            background: 'rgba(15, 25, 30, 0.85)',
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.04)',
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minWidth: 0,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: 0,
                fontSize: '18px',
                color: '#fff',
              }}>
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {selectedStageName}
                </span>
                {selectedStageCompleted && (
                  <span style={{
                    flex: '0 0 auto',
                    color: '#4ade80',
                    fontWeight: 700,
                  }}>
                    ✓
                  </span>
                )}
              </div>
              <div style={{
                fontSize: '14px',
                color: '#b6c9d1',
              }}>
                {stageLightText}
              </div>
              <div style={{
                fontSize: '14px',
                color: '#b6c9d1',
              }}>
                {stageRowsText} rows
              </div>
            </div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '10px',
              flex: '0 0 220px',
            }}>
              <button
                style={{
                  padding: '10px 20px',
                  background: '#00ccff',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                }}
                onClick={handleNext}
              >
                {translate('menu.next')}
              </button>
              <div style={{
                position: 'relative',
                height: '22px',
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                background: 'rgba(0, 0, 0, 0.35)',
              }}>
                <div style={{
                  width: `${stageSummaryPercent}%`,
                  height: '100%',
                  background: stageBossInsertCount > 0 ? '#f97316' : '#22c55e',
                  transition: 'width 0.3s ease',
                }} />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '12px',
                  textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
                }}>
                  {stageSummaryText}
                </div>
              </div>
            </div>
          </div>
        )}
        {state.selectedStage !== null ? (
          state.isIntroLoading ? translate('common.loading') : state.levelIntro.map((item, index) => {
            if (item.type === 'img') {
              if (!settings.showLevelIntroImages) {
                return null;
              }
              return (
                <img
                  key={`${item.src}-${index}`}
                  src={`${publicUrl}/assets/dramas/${item.src}`}
                  style={{
                    width: '100%',
                    height: 'auto',
                    marginBottom: '20px',
                  }}
                  draggable="false"
                />
              );
            }

            return (
              <div key={`${item.content}-${index}`} style={{ marginBottom: '16px' }}>
                {translate(stageKey(item.content))}
              </div>
            );
          })
        ) : translate('menu.level_choose_level_tip')}
      </div>
    </div>
  );
};

export default StageSelector;
