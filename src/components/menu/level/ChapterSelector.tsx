// src/components/ChapterSelector.tsx
import React from 'react';
import { ChapterDataRecords, StageDataRecords } from '../../../game/managers/library/ChapterLibrary';
import { useSaveManager } from '../../../context/save_ctx';
import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import { stageKey } from '../../../i18n/keys';
import { useSetState, useLocalStorageState, useMount, useMemoizedFn } from 'ahooks';

interface ChapterSelectorProps {
  onSelect: (chapterId: number) => void;
  onBack: () => void;
}

const ChapterSelector: React.FC<ChapterSelectorProps> = ({ onSelect, onBack }) => {
  const [state, setState] = useSetState({
    selectedChapter: null as number | null,
    availableChapters: [] as number[],
  });

  // 使用 useLocalStorageState 保存用户选择的章节
  const [chapterSelection, setChapterSelection] = useLocalStorageState('chapterSelection', {
    defaultValue: {
      lastSelectedChapter: null as number | null,
    }
  });

  const saveManager = useSaveManager();
  const { translate } = useLocaleMessages();

  // 计算可用章节
  const calculateAvailableChapters = useMemoizedFn(() => {
    let tmpChapters: number[] = [];
    saveManager.getUnlockedLevels().forEach((level) => {
      const chapterId = level.chapterId;
      if (!tmpChapters.includes(chapterId)) {
        tmpChapters.push(chapterId);
      }
    });
    return tmpChapters.sort((a, b) => a - b);
  });

  // 初始化可用章节
  useMount(() => {
    const chapters = calculateAvailableChapters();
    setState({ availableChapters: chapters });

    // 恢复上次选择的章节
    if (chapterSelection.lastSelectedChapter && chapters.includes(chapterSelection.lastSelectedChapter)) {
      setState({ selectedChapter: chapterSelection.lastSelectedChapter });
    }
  });

  const handleChapterSelect = useMemoizedFn((chapter: number) => {
    setState({ selectedChapter: chapter });
    setChapterSelection({ lastSelectedChapter: chapter });
  });

  const handleNext = useMemoizedFn(() => {
    if (state.selectedChapter !== null) {
      onSelect(state.selectedChapter);
    }
  });

  const selectedChapterData = state.selectedChapter !== null ? ChapterDataRecords[state.selectedChapter] : null;
  const selectedChapterStages = selectedChapterData?.stages ?? [];
  const completedStageCount = selectedChapterData
    ? selectedChapterStages.filter((stageId) => saveManager.isLevelPassed(stageId, selectedChapterData.id)).length
    : 0;
  const totalStageCount = selectedChapterStages.length;
  const selectedChapterName = selectedChapterData ? translate(stageKey(selectedChapterData.nameKey)) : '-';

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
      {/* 左侧 25% - 章节选择 */}
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
          onClick={onBack}
        >
          {translate('menu.back')}
        </button>

        {state.availableChapters.map((chapter) => (
          <button
            key={chapter}
            className='menubutton'
            style={{
              background: state.selectedChapter === chapter ? 'rgba(255, 255, 255, 0.1)' : 'none',
              boxShadow: state.selectedChapter === chapter
                ? 'inset 0 0 0 2px #00ccff'
                : 'inset 0 0 0 2px rgba(100, 100, 100, 0.3)',
            }}
            onMouseOver={(e) => {
              if (state.selectedChapter !== chapter) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.boxShadow = 'inset 0 0 0 2px #00ccff';
              }
            }}
            onMouseOut={(e) => {
              if (state.selectedChapter !== chapter) {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.boxShadow = 'inset 0 0 0 2px rgba(100, 100, 100, 0.3)';
              }
            }}
            onClick={() => handleChapterSelect(chapter)}
          >
            {translate(stageKey(ChapterDataRecords[chapter].nameKey))}
          </button>
        ))}
      </div>

      {/* 右侧 70% - 章节描述 */}
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
        {selectedChapterData && (
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
                fontSize: '18px',
                color: '#fff',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {selectedChapterName}
              </div>
              <div style={{
                fontSize: '14px',
                color: '#b6c9d1',
              }}>
                关卡数量(已完成/总数): {completedStageCount}/{totalStageCount}
              </div>
            </div>
            <button
              style={{
                flex: '0 0 auto',
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
          </div>
        )}
        <div>
          {selectedChapterData ? translate(stageKey(selectedChapterData.descriptionKey)) : translate('menu.level_choose_chapter_tip')}
        </div>
      </div>
    </div>
  );
};

export default ChapterSelector;
