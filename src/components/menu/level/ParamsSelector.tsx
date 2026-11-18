// src/components/ParamsSelector.tsx
import React, { useEffect } from 'react';
import { GameParams } from '../../../game/models/GameParams';
import { useSaveManager } from '../../../context/save_ctx';
import { StageDataRecords } from '../../../game/managers/library/ChapterLibrary';
import { publicUrl } from '../../../utils/browser';
import { useSettings } from '../../../context/settings_ctx';
import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import { cardKey, stageKey } from '../../../i18n/keys';
import { useSetState, useLocalStorageState, useMount, useMemoizedFn } from 'ahooks';
import {
  PhaserEventBus,
  PhaserEvents,
} from '../../../game/EventBus';
import { PlantLibrary } from '../../../game/managers/library/PlantLibrary';
import BackendWS from '../../../utils/net/sync';
import { Request, RequestChooseMap, RequestReady } from '../../../pb/request';
import { SendReady } from '../../../utils/net/room';
import type { StageData } from '../../../types/stage';
import { isUnlockAllEnabled } from '../../../utils/debugFlags';
import { MAX_CARD_SLOTS } from '../../../constants/cardSlotLayout';

interface ParamsSelectorProps {
  chapterId: number;
  stageId: number;
  setGameParams: (params: GameParams) => void;
  startGame: () => void;
  onBack: () => void;
  clearLevelSelection: () => void;
  // 联机模式相关属性
  isOnlineMode?: boolean;
  islord?: boolean;
  gameStage?: number;
  isLoading?: boolean;
  canProceed?: boolean;
  buttonText?: string;
  buttonStyle?: React.CSSProperties;
}

interface PlantElem {
  pid: number;
  name: string;
  imgUrl: string;
  level: number;
}

const ParamsSelector: React.FC<ParamsSelectorProps> = ({
  chapterId,
  stageId,
  setGameParams,
  startGame: _startGame,
  onBack,
  clearLevelSelection,
  // 联机模式相关属性
  isOnlineMode = false,
  islord = false,
  gameStage,
  isLoading = false,
  canProceed = true,
  buttonText,
  buttonStyle
}) => {
  const [state, setState] = useSetState({
    selectedPlants: [] as number[],
    availablePlants: [] as PlantElem[],
    isOverLimit: false,
    selectUpperLimit: 0,
    // 联机模式的准备状态
    readyPlayerCount: 0,
    totalPlayerCount: 0,
    hasUserClicked: false, // 跟踪用户是否已经点击了准备按钮
  });

  // 使用 useLocalStorageState 保存用户选择的植物配置
  const [plantSelection, setPlantSelection] = useLocalStorageState('plantSelection', {
    defaultValue: {
      lastSelectedPlants: [] as number[],
      lastStageId: null as number | null
    }
  });

  const settings = useSettings();
  const saveManager = useSaveManager();
  const { translate } = useLocaleMessages();
  const waitingText = translate('common.waiting_other_players_select') || '等待其他玩家选择';
  const isSelectionLocked = state.hasUserClicked || isLoading;
  const canStart = canProceed && !isSelectionLocked;

  const loadStageRows = useMemoizedFn(async () => {
    try {
      const stageRecord = StageDataRecords[stageId];
      if (!stageRecord) {
        return undefined;
      }
      const response = await fetch(`${publicUrl}/${stageRecord.dataPath}`);
      if (!response.ok) {
        return undefined;
      }
      const stage = await response.json() as Pick<StageData, 'rows'>;
      return Number.isInteger(stage.rows) ? stage.rows : undefined;
    } catch {
      return undefined;
    }
  });

  // 联机模式下监听准备状态更新
  useEffect(() => {
    if (!isOnlineMode) return;

    const handleReadyCountUpdate = (event: { readyCount: number; totalPlayers: number }) => {
      setState({
        readyPlayerCount: event.readyCount,
        totalPlayerCount: event.totalPlayers
      });
    };

    const handleQuitChooseMap = () => {
      // 房主取消了选图，重置用户点击状态
      setState({ hasUserClicked: false });
    };

    PhaserEventBus.on(PhaserEvents.RoomUpdateReadyCount, handleReadyCountUpdate);
    PhaserEventBus.on(PhaserEvents.RoomQuitChooseMap, handleQuitChooseMap);

    return () => {
      PhaserEventBus.off(PhaserEvents.RoomUpdateReadyCount, handleReadyCountUpdate);
      PhaserEventBus.off(PhaserEvents.RoomQuitChooseMap, handleQuitChooseMap);
    };
  }, [isOnlineMode]);

  // 计算可用植物
  const calculateAvailablePlants = useMemoizedFn(() => {
    const plantProgress = saveManager.currentProgress.plants;
    if (isUnlockAllEnabled()) {
      const plantLevelByPid = new Map<number, number>();
      for (const plant of plantProgress ?? []) {
        plantLevelByPid.set(plant.pid, Math.max(plantLevelByPid.get(plant.pid) ?? 0, plant.level));
      }
      return PlantLibrary.GetAllModels()
        .map((plantModel) => ({
          pid: plantModel.pid,
          name: plantModel.nameKey,
          imgUrl: `${publicUrl}/assets/card/${plantModel.texturePath}.png`,
          level: plantLevelByPid.get(plantModel.pid) ?? 1,
        }))
        .sort((left, right) => left.pid - right.pid);
    }
    if (!plantProgress || plantProgress.length < 1) {
      console.log("No plant progress available:", saveManager.currentProgress);
      return [];
    }

    const plantLevelByPid = new Map<number, number>();
    for (const plant of plantProgress) {
      const currentLevel = plantLevelByPid.get(plant.pid) ?? 0;
      if (plant.level > currentLevel) {
        plantLevelByPid.set(plant.pid, plant.level);
      }
    }

    const newAvailablePlants: PlantElem[] = [];
    for (const [pid, level] of plantLevelByPid) {
      const plantModel = PlantLibrary.GetModel(pid);
      if (!plantModel) {
        console.warn(`Plant with pid ${pid} not found in PlantFactoryMap`);
        continue;
      }
      const newPlant: PlantElem = {
        pid: pid,
        name: plantModel.nameKey,
        imgUrl: `${publicUrl}/assets/card/${plantModel.texturePath}.png`,
        level
      };
      newAvailablePlants.push(newPlant);
    }
    return newAvailablePlants.sort((a, b) => a.pid - b.pid);
  });

  // 初始化植物选择（不立即加载 localStorage）
  useMount(() => {
    const plants = calculateAvailablePlants();
    const unlockedSlots = Math.floor(saveManager.currentProgress.slotNum ?? 0);
    setState({
      availablePlants: plants,
      selectUpperLimit: isUnlockAllEnabled()
        ? MAX_CARD_SLOTS
        : Math.max(0, Math.min(MAX_CARD_SLOTS, unlockedSlots)),
    });

    // 不立即恢复上次选择的植物，让用户手动选择
  });

  // 重选上次的植物配置
  const handleReloadLastSelection = useMemoizedFn(() => {
    if (isSelectionLocked) {
      return;
    }

    if (plantSelection.lastStageId === stageId && plantSelection.lastSelectedPlants.length > 0) {
      const plants = state.availablePlants;
      const upperLimit = state.selectUpperLimit;
      const validPlants = plantSelection.lastSelectedPlants.filter(pid =>
        plants.some(p => p.pid === pid)
      );
      if (validPlants.length <= upperLimit) {
        setState({ selectedPlants: validPlants });
      }
    }
  });

  const handlePlantToggle = useMemoizedFn((pid: number) => {
    if (isSelectionLocked) {
      return;
    }

    setState(prevState => {
      if (prevState.selectedPlants.includes(pid)) {
        // 取消选择植物
        const newSelectedPlants = prevState.selectedPlants.filter(p => p !== pid);
        return {
          ...prevState,
          selectedPlants: newSelectedPlants,
          isOverLimit: false
        };
      } else {
        // 选择植物
        if (prevState.selectedPlants.length >= prevState.selectUpperLimit) {
          setState({ isOverLimit: true });
          setTimeout(() => setState({ isOverLimit: false }), 400);
          return prevState;
        }
        const newSelectedPlants = [...prevState.selectedPlants, pid];
        return {
          ...prevState,
          selectedPlants: newSelectedPlants
        };
      }
    });
  });

  const handleStart = useMemoizedFn(async () => {
    if (!canStart) {
      return;
    }

    setState({ hasUserClicked: true });

    const pidToLevel = new Map(state.availablePlants.map(p => [p.pid, p.level]));
    const chosenPlants = state.selectedPlants.map(pid => ({
      pid,
      level: pidToLevel.get(pid) ?? 1,
    }));
    const gold = saveManager.currentProgress.items.get(1)?.count ?? 0;
    const stageRows = await loadStageRows();

    // 联机模式下的特殊处理
    if (isOnlineMode) {
      // 在线模式下，房主和普通玩家都需要设置GameParams
      const params: GameParams = {
        level: stageId,
        plants: chosenPlants,
        gold,
        stageRows,
        gameExit: () => { console.log('no gameexit Implemented') },
        gameSettings: {
          isBluePrint: settings.isBluePrint,
          basicDebug: settings.basicDebug,
          isBgm: settings.isBgm,
          isSoundAudio: settings.isSoundAudio,
          showCardLevelInGame: settings.showCardLevelInGame,
          bgmVolume: settings.bgmVolume,
          soundAudioVolume: settings.soundAudioVolume,
        }
      };

      // 保存植物选择到 localStorage
      setPlantSelection({
        lastSelectedPlants: state.selectedPlants,
        lastStageId: stageId
      });

      // 清除选关相关的 localStorage
      clearLevelSelection();
      setGameParams(params);

      const loadout = {
        cards: chosenPlants,
        level: stageId,
        initialEnergy: 0,
        initialStarShards: 0,
        globalModifiers: []
      };

      if (islord) {
        console.log("房主发送准备信号");
        SendReady(true, loadout); // 房主发送准备请求
      } else {
        console.log("玩家发送准备信号");
        SendReady(true, loadout); // 发送准备请求到服务器
      }

      return;
    }

    // 单机模式的原有逻辑
    const params: GameParams = {
      level: stageId,
      plants: chosenPlants,
      gold,
      stageRows,
      gameExit: () => { console.log('no gameexit Implemented') },
      gameSettings: {
        isBluePrint: settings.isBluePrint,
        basicDebug: settings.basicDebug,
        isBgm: settings.isBgm,
        isSoundAudio: settings.isSoundAudio,
        showCardLevelInGame: settings.showCardLevelInGame,
        bgmVolume: settings.bgmVolume,
        soundAudioVolume: settings.soundAudioVolume,
      }
    };

    // 游戏开始时保存植物选择到 localStorage
    setPlantSelection({
      lastSelectedPlants: state.selectedPlants,
      lastStageId: stageId
    });

    // 清除选关相关的 localStorage
    clearLevelSelection();

    setGameParams(params);
    setTimeout(() => {
      BackendWS.startSinglePlayerRoom();
      const chooseMapRequest: RequestChooseMap = { chapterId, stageId };
      BackendWS.send(Request.toBinary({ payload: { chooseMap: chooseMapRequest, oneofKind: 'chooseMap' } }));
      const readyRequest: RequestReady = { isReady: true };
      BackendWS.send(Request.toBinary({ payload: { ready: readyRequest, oneofKind: 'ready' } }));
    }, 0);
  });

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
      position: 'relative',
      overflow: 'hidden',
      border: '2px solid #444',
      boxShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
      display: 'flex'
    }}>
      {/* Left side - Plant selection */}
      <div style={{
        width: '60%',
        // height: '100%',
        background: 'rgba(20, 20, 20, 0.85)',
        overflowY: 'auto',
        padding: '5px 0px 10px 10px',
        display: 'flex',
        flexFlow: 'column nowrap',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
        }}>
          <button
            style={{
              padding: '8px 16px',
              background: 'none',
              border: '2px solid #666',
              color: isSelectionLocked ? '#888' : '#ddd',
              cursor: isSelectionLocked ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
            }}
            disabled={isSelectionLocked}
            onMouseOver={(e) => {
              if (isSelectionLocked) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = '#00ccff';
            }}
            onMouseOut={(e) => {
              if (isSelectionLocked) return;
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.borderColor = '#666';
            }}
            onClick={isSelectionLocked ? undefined : onBack}
          >
            {translate('menu.back')}
          </button>

          {/* 联机模式状态显示 */}
          {isOnlineMode && (
            <div style={{
              marginLeft: '16px',
              padding: '6px 12px',
              background: 'rgba(0, 200, 255, 0.2)',
              border: '1px solid rgba(0, 200, 255, 0.5)',
              borderRadius: '4px',
              color: '#00ccff',
              fontSize: '12px',
              fontWeight: 'bold'
            }}>
              {islord ? '房主模式' : '玩家模式'} | {
                isSelectionLocked ?
                  `${waitingText} (${state.readyPlayerCount}/${state.totalPlayerCount})` :
                  isLoading ? '等待中...' :
                    !canProceed ? '请等待房主操作' :
                      gameStage === 0x21 ? '准备阶段' : '可以操作'
              }
            </div>
          )}
          <div style={{
            marginLeft: '10px',
            color: '#ddd',
            fontSize: '16px'
          }}>
            {`stage ${stageId} - ${translate(stageKey(StageDataRecords[stageId].nameKey))}`}
          </div>
        </div>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          justifyContent: 'flex-start'
        }}>
          {state.availablePlants.map((plant) => (
            <div
              key={plant.pid}
              style={{
                width: '11.5%',
                aspectRatio: '1 / 1.5',
                border: state.selectedPlants.includes(plant.pid)
                  ? '2px solid #00ccff'
                  : '2px solid rgba(100, 100, 100, 0.5)',
                cursor: isSelectionLocked ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '5px',
                background: 'rgba(255, 255, 255, 0.05)',
                opacity: isSelectionLocked && !state.selectedPlants.includes(plant.pid) ? 0.55 : 1
              }}
              onClick={() => handlePlantToggle(plant.pid)}
              onMouseOver={(e) => {
                if (!isSelectionLocked && !state.selectedPlants.includes(plant.pid))
                  e.currentTarget.style.borderColor = '#00ccff';
              }}
              onMouseOut={(e) => {
                if (!isSelectionLocked && !state.selectedPlants.includes(plant.pid))
                  e.currentTarget.style.borderColor = 'rgba(100, 100, 100, 0.5)';
              }}
            >
              <div style={{ width: "64px", height: "64px", overflow: "hidden" }}>
                <img
                  src={plant.imgUrl}
                  alt={plant.name}
                  style={{ display: "block" }}
                  draggable="false"
                />
              </div>
              <span style={{
                color: '#ddd',
                textAlign: 'center',
                fontSize: '12px',
                marginTop: '5px'
              }}>
                {translate(cardKey(plant.name))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right side - Parameters and selected plants */}
      <div style={{
        width: '40%',
        height: '94%',
        padding: '20px',
        paddingLeft: '5px',
        paddingRight: '5px',
        color: '#ddd',
        background: 'rgba(30, 30, 30, 0.9)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <h3
            style={{
              marginTop: 0,
              marginBottom: '0.2rem'
            }}
          >
            {`${translate('menu.level_chosen_plants')} `}
            <span style={{
              color: state.isOverLimit ? 'red' : '#ddd',
              transition: 'color 0.3s ease'
            }}>
              {`${state.selectedPlants.length}/${state.selectUpperLimit}`}
            </span>
          </h3>
          {plantSelection.lastStageId === stageId && plantSelection.lastSelectedPlants.length > 0 && (
            <button
              style={{
                padding: '4px 8px',
                background: isSelectionLocked ? '#666' : '#4CAF50',
                border: 'none',
                color: isSelectionLocked ? '#ccc' : '#fff',
                cursor: isSelectionLocked ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                borderRadius: '4px',
                transition: 'all 0.3s ease',
              }}
              disabled={isSelectionLocked}
              onMouseOver={(e) => {
                if (isSelectionLocked) return;
                e.currentTarget.style.background = '#45a049';
              }}
              onMouseOut={(e) => {
                if (isSelectionLocked) return;
                e.currentTarget.style.background = '#4CAF50';
              }}
              onClick={isSelectionLocked ? undefined : handleReloadLastSelection}
            >
              重选上次
            </button>
          )}
        </div>
        <div style={{
          flex: 1,
          overflowY: 'scroll',
          minHeight: 0,
          scrollbarColor: '#888 #333',
          scrollbarGutter: 'stable',
          paddingRight: '6px',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '10px',
          }}>
            {state.selectedPlants.map(pid => {
              const plant = state.availablePlants.find(p => p.pid === pid);
              if (!plant) return null;
              return (
                <div
                  key={pid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px 8px',
                    height: '64px',
                    border: '1px solid #666',
                    background: 'rgba(255, 255, 255, 0.05)',
                    transition: 'border 0.3s, background 0.3s',
                    cursor: isSelectionLocked ? 'default' : 'pointer',
                  }}
                  onClick={() => handlePlantToggle(plant.pid)}
                  onMouseEnter={(e) => {
                    if (isSelectionLocked) return;
                    e.currentTarget.style.border = '1px solid red';
                    e.currentTarget.style.background = 'rgba(255, 0, 0, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    if (isSelectionLocked) return;
                    e.currentTarget.style.border = '1px solid #666';
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                >
                  <div style={{
                    width: '52px',
                    height: '52px',
                    overflow: 'hidden',
                    flexShrink: 0
                  }}>
                    <img
                      src={plant.imgUrl}
                      alt={plant.name}
                      style={{
                        display: 'block',
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain'
                      }}
                      draggable="false"
                    />
                  </div>
                  <span style={{
                    marginLeft: '8px',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>{translate(cardKey(plant.name))}</span>
                </div>
              );
            })}
          </div>
        </div>

        <button
          style={isSelectionLocked || !canProceed ? {
            ...(buttonStyle || {}),
            padding: '12px 0',
            width: '100%',
            maxWidth: '320px',
            background: '#666',
            border: 'none',
            color: '#ccc',
            cursor: 'not-allowed',
            transition: 'all 0.3s ease',
            alignSelf: 'center',
            marginTop: '12px',
            flexShrink: 0,
          } : (buttonStyle || {
            padding: '12px 0',
            width: '100%',
            maxWidth: '320px',
            background: '#00ccff',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            alignSelf: 'center',
            marginTop: '12px',
            flexShrink: 0,
          })}
          onClick={canStart ? handleStart : undefined}
          disabled={!canStart}
        >
          {isLoading && (
            <span style={{ marginRight: '8px' }}>⏳</span>
          )}
          {isSelectionLocked ?
            waitingText :
            (buttonText || translate('common.start'))
          }
        </button>
      </div>
    </div>
  );
};

export default ParamsSelector;
