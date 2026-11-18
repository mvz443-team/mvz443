// src/components/StageSelector.tsx
import React, { useEffect } from 'react';
import { ChapterDataRecords, StageDataRecords } from '../../../game/managers/library/ChapterLibrary';
import { useSaveManager } from '../../../context/save_ctx';
import { publicUrl } from '../../../utils/browser';
import { useSettings } from '../../../context/settings_ctx';

import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import { isUnlockAllEnabled } from '../../../utils/debugFlags';

import { stageKey } from '../../../i18n/keys';
import { useSetState, useLocalStorageState, useMount, useMemoizedFn } from 'ahooks';
import type { StageData } from '../../../types/stage';
import type { LevelIntroItem } from '../../../types/drama';
import RoomSidebar from './RoomSidebar';
import { getRoomsInfo, RoomInfo } from '../../../utils/net/lobby';
import BackendWS from '../../../utils/net/sync';
import EnumGameStage from '../../../utils/net/game_state';
import { onlineStateManager } from '../../../store/OnlineStateManager';
import { PhaserEventBus, PhaserEvents } from '../../../game/EventBus';

const ROOM_LIST_REFRESH_MS = 5000;

type StageSelectorStageData = Pick<StageData, 'levelIntro' | 'rows' | 'stageScript' | 'onWin'>;

const infoPanelThemes = {
  default: {
    border: 'rgba(0, 204, 255, 0.45)',
    background: 'rgba(15, 25, 30, 0.85)',
    accent: '#00ccff',
    glow: 'rgba(0, 204, 255, 0.16)',
  },
  completed: {
    border: 'rgba(34, 197, 94, 0.58)',
    background: 'rgba(13, 44, 28, 0.9)',
    accent: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.2)',
  },
  locked: {
    border: 'rgba(239, 68, 68, 0.58)',
    background: 'rgba(55, 18, 18, 0.9)',
    accent: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.2)',
  },
} as const;

interface StageSelectorProps {
  chapterId: number;
  onSelect: (stageId: number) => void;
  onBack: () => void;
}

const StageSelector: React.FC<StageSelectorProps> = ({ chapterId, onSelect, onBack }) => {
  const settings = useSettings();
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
  const { translate } = useLocaleMessages();

  // 联机：房间列表与侧边栏
  const [roomList, setRoomList] = React.useState<RoomInfo[] | null>(null);
  const [roomPanelOpen, setRoomPanelOpen] = React.useState(false);
  const [inRoom, setInRoom] = React.useState(false);
  const serverAddress = saveManager.getOnlineConfig().serverAddr;

  const refreshRooms = useMemoizedFn(async () => {
    const targetStage = state.selectedStage;
    if (!targetStage || !serverAddress) {
      setRoomList([]);
      return;
    }
    const rooms = await getRoomsInfo(serverAddress, chapterId, targetStage);
    setRoomList(rooms);
  });

  const syncRoomSession = useMemoizedFn(() => {
    const isInRoom = BackendWS.isRoomSessionMode()
      && onlineStateManager.getCurrentGameStage() === EnumGameStage.InLobby;
    setInRoom(isInRoom);
    if (isInRoom) {
      setRoomPanelOpen(true);
    }
  });

  useEffect(() => {
    syncRoomSession();
    PhaserEventBus.on(PhaserEvents.RoomInfo, syncRoomSession);
    onlineStateManager.onGameStageUpdate(syncRoomSession);
    onlineStateManager.onOnlineModeUpdate(syncRoomSession);
    return () => {
      PhaserEventBus.off(PhaserEvents.RoomInfo, syncRoomSession);
      onlineStateManager.removeGameStageUpdateListener(syncRoomSession);
      onlineStateManager.removeOnlineModeUpdateListener(syncRoomSession);
    };
  }, [syncRoomSession]);

  // 选中关卡后定时刷新该关的房间数量
  useEffect(() => {
    if (!state.selectedStage || inRoom) {
      return;
    }
    void refreshRooms();
    const timer = setInterval(() => {
      void refreshRooms();
    }, ROOM_LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [state.selectedStage, inRoom, serverAddress, refreshRooms]);

  // 计算可用关卡
  const calculateAvailableStages = useMemoizedFn(() => {
    const chapterStages = ChapterDataRecords[chapterId]?.stages || [];
    const tmpStagesIds: number[] = [];
    const unlockAll = isUnlockAllEnabled();
    for (const stageId of chapterStages) {
      if (unlockAll || saveManager.isLevelUnlocked(stageId, chapterId)) {
        tmpStagesIds.push(stageId);
      }
    }
    return tmpStagesIds.sort((a, b) => a - b);
  });

  // 初始化可用关卡
  useMount(() => {
    const stages = calculateAvailableStages();
    setState({ stagesIds: stages });

    // 房间会话中：以房间绑定的关卡为准
    const roomStage = onlineStateManager.getRoomMeta().stageId;
    if (BackendWS.isRoomSessionMode() && roomStage > 0) {
      setState({ selectedStage: roomStage });
      return;
    }

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

  const handleMultiplayer = useMemoizedFn(() => {
    setRoomPanelOpen(true);
    void refreshRooms();
  });

  const selectedStageRecord = state.selectedStage !== null ? StageDataRecords[state.selectedStage] : null;
  const selectedStageName = selectedStageRecord ? translate(stageKey(selectedStageRecord.nameKey)) : '';
  const selectedStageUnlocked = state.selectedStage !== null
    && (isUnlockAllEnabled() || saveManager.isLevelUnlocked(state.selectedStage, chapterId));
  const selectedStageCompleted = state.selectedStage !== null && saveManager.isLevelPassed(state.selectedStage, chapterId);
  const infoPanelTheme = selectedStageCompleted
    ? infoPanelThemes.completed
    : selectedStageRecord && !selectedStageUnlocked
      ? infoPanelThemes.locked
      : infoPanelThemes.default;
  const stageLightText = state.selectedStageData
    ? translate(state.selectedStageData.stageScript.dayOrNight === 1 ? 'menu.level_light_strong' : 'menu.level_light_none')
    : translate('common.loading');
  const stageRowsText = state.selectedStageData
    ? translate('menu.level_rows', { count: state.selectedStageData.rows })
    : translate('common.loading');
  const stageBossInsertCount = state.selectedStageData?.stageScript.bossInsert.length ?? 0;
  const stageWaveCount = state.selectedStageData
    ? state.selectedStageData.stageScript.total_waves + stageBossInsertCount
    : 0;
  const stageThreatText = translate(
    stageBossInsertCount > 1
      ? 'menu.level_threat_elite_boss'
      : stageBossInsertCount === 1
        ? 'menu.level_threat_boss'
        : 'menu.level_threat_no_boss'
  );
  const stageSummaryText = state.selectedStageData
    ? translate('menu.level_wave_summary', {
      count: stageWaveCount,
      threat: stageThreatText,
    })
    : translate('common.loading');
  const stageSummaryPercent = state.selectedStageData
    ? Math.min(100, Math.max(18, (stageWaveCount / 40) * 100))
    : 0;

  // 房间会话中即使没有手动选中关卡，也要能展示等待房间
  const roomStageId = onlineStateManager.getRoomMeta().stageId;
  const sidebarStageId = state.selectedStage ?? (roomStageId > 0 ? roomStageId : null);
  const sidebarStageRecord = sidebarStageId !== null ? StageDataRecords[sidebarStageId] : null;
  const sidebarStageName = selectedStageName
    || (sidebarStageRecord ? translate(stageKey(sidebarStageRecord.nameKey)) : '');

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
            border: `1px solid ${infoPanelTheme.border}`,
            background: infoPanelTheme.background,
            boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 18px ${infoPanelTheme.glow}`,
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
                {stageRowsText}
              </div>
            </div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '10px',
              flex: '0 0 300px',
            }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: infoPanelTheme.accent,
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={handleNext}
                >
                  {translate('menu.online_single_player')}
                </button>
                <button
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: 'linear-gradient(45deg, #4CAF50, #45a049)',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={handleMultiplayer}
                >
                  {roomList && roomList.length > 0
                    ? translate('menu.online_multiplayer_count', { count: roomList.length })
                    : translate('menu.online_multiplayer')}
                </button>
              </div>
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
                  background: selectedStageCompleted || !selectedStageUnlocked
                    ? infoPanelTheme.accent
                    : stageBossInsertCount > 0 ? '#f97316' : '#22c55e',
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

      {roomPanelOpen && sidebarStageId !== null && (
        <RoomSidebar
          chapterId={chapterId}
          stageId={sidebarStageId}
          stageName={sidebarStageName}
          stageSummary={state.selectedStageData ? {
            light: stageLightText,
            rows: state.selectedStageData.rows,
            waves: stageWaveCount,
            threat: stageThreatText,
          } : null}
          rooms={roomList}
          serverAddress={serverAddress}
          onRefresh={refreshRooms}
          onClose={() => setRoomPanelOpen(false)}
        />
      )}
    </div>
  );
};

export default StageSelector;
