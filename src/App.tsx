import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { IRefPhaserGame, PhaserGame } from './game/PhaserGame';
import DocFrame from './components/DocFrame';
import GlobalOnlineStateListener from './components/GlobalOnlineStateListener';
import NetworkStatusOverlay from './components/NetworkStatusOverlay';
import GlobalDialogHost from './components/GlobalDialogHost';
import { useSettings } from './context/settings_ctx';
import { GameParams } from './game/models/GameParams';
import type { StageResult } from './types/stage';
import GameResultView from './components/menu/result';
import { useDeviceType } from './hooks/useDeviceType';
import BackendWS from './utils/net/sync';
import { onlineStateManager } from './store/OnlineStateManager';
import EnumGameStage from './utils/net/game_state';
import { createRoom, joinRoom, leaveRoomAndDestroy } from './utils/net/lobby';
import { SendReady, SendLoaded, SendChooseMap, SendEndGame, SendReturnToLobby } from './utils/net/room';
import { Request } from './pb/request';
import { PlantCmd } from './game/utils/cmd/PlantCmd';
import MobCmd from './game/utils/cmd/MobCmd';
import { perfSampler } from './utils/debug/perfSampler';
import { ProjectileCmd } from './game/utils/cmd/ProjectileCmd';
import { PlantLibrary } from './game/managers/library/PlantLibrary';
import { MonsterLibrary } from './game/managers/library/MonsterLibrary';
import { BulletModel } from './game/models/projectiles/ProjectileModels';
import PlantsManager from './game/managers/combat/PlantsManager';
import MobManager from './game/managers/combat/MobManager';
import { useSaveManager } from './context/save_ctx';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import SettingsPage from './pages/settings';
import { publicUrl } from './utils/browser';
import { PhaserEventBus, PhaserEvents } from './game/EventBus';
import CursorManager from './game/managers/combat/CursorManager';
import CardpileManager from './game/managers/combat/CardpileManager';
import CombatManager from './game/managers/CombatManager';
import { initializeGameLibraries } from './game/managers/library/initializeGameLibraries';
import {
  GAME_ASPECT_RATIO,
  getGameToolLayoutMetrics,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
  LOGICAL_BATTLE_WORLD_WIDTH,
} from './constants/gameLayout';
import { isNetDebugEnabled, isUnlockAllEnabled, toggleUnlockAll } from './utils/debugFlags';

interface GameMainWindowProps {
  width: number;
  height: number;
  nonGameWidth: number;
  nonGameHeight: number;
  deviceType: string;
  showGameTool: boolean;
  showGameScreen: boolean;
  showGameResult: boolean;
  gameParams: GameParams | null;
  gameResult: StageResult | null;
  phaserRef: MutableRefObject<IRefPhaserGame | null>;
  currentScene: (_scene: Phaser.Scene) => void;
  gameExit: (result: StageResult) => void;
  /** 单机结算回主界面；联机结算回原房间。 */
  exitResultView: () => void;
  returnToRoomView: () => void;
  showRoomView: boolean;
  setGameParams: (gameParams: GameParams) => void;
  gameStart: () => void;
  forceLandscape: boolean;
}

function GameMainWindow({
  width,
  height,
  nonGameWidth,
  nonGameHeight,
  deviceType,
  showGameTool,
  showGameScreen,
  showGameResult,
  gameParams,
  gameResult,
  phaserRef,
  currentScene,
  gameExit,
  exitResultView,
  returnToRoomView,
  showRoomView,
  setGameParams,
  gameStart,
  forceLandscape,
}: GameMainWindowProps) {
  const toolLayout = getGameToolLayoutMetrics(width, height, deviceType, showGameTool);
  const isGameLayout = showGameScreen || showGameTool;
  const gameSurfaceWidth = showGameTool ? toolLayout.totalWidth : width;
  const gameSurfaceHeight = showGameTool ? toolLayout.totalHeight : height;
  const mainWidth = isGameLayout ? gameSurfaceWidth : nonGameWidth;
  const mainHeight = isGameLayout ? gameSurfaceHeight : nonGameHeight;

  return (<div id="app" onContextMenu={(e) => { e?.preventDefault() }} style={{
    userSelect: "none",
    WebkitUserSelect: "none",
    MozUserSelect: "none",
    msUserSelect: "none",
    KhtmlUserSelect: "none",
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100vw",
    height: "100dvh",
    maxWidth: "100vw",
    maxHeight: "100dvh",
    overflow: "hidden",
    boxSizing: "border-box",
  }}>
    <div id="mainContainer" style={{
      width: mainWidth,
      height: mainHeight,
      display: "flex",
      flexDirection: "column",
      flex: "0 0 auto",
      transform: forceLandscape ? "rotate(90deg)" : undefined,
      transformOrigin: "center center",
      touchAction: isGameLayout ? "none" : undefined,
    }}>
      <div id="controlContainer">
      </div>
      {showGameScreen && (!showGameResult) &&
        <PhaserGame
          ref={phaserRef}
          currentActiveScene={currentScene}
          isVisibility={showGameScreen}
          gameParams={gameParams}
          gameExit={gameExit}
          width={gameSurfaceWidth}
          height={gameSurfaceHeight}
          mainViewportWidth={width}
          mainViewportHeight={height}
          deviceType={deviceType}
        />
      }
      {(!showGameScreen) && (!showGameResult) &&
        <DocFrame
          width={mainWidth}
          height={mainHeight}
          sceneRef={phaserRef}
          setGameParams={setGameParams}
          gameStart={gameStart}
          initialRoomView={showRoomView}
        />
      }
      {showGameResult && (!showGameScreen) && (gameResult) &&
        <GameResultView
          isWin={gameResult?.isWin ? gameResult.isWin : false}
          onWin={gameResult?.onWin}
          chapterId={gameResult?.chapterId}
          stageId={gameResult?.stageId}
          progressRewards={gameResult?.rewards}
          myProgress={gameResult?.progress ? gameResult.progress : 0}
          onBack={exitResultView}
          onReturnToRoom={returnToRoomView}
          width={mainWidth}
          height={mainHeight}
        />
      }
    </div>
  </div>);
}

type ViewportSize = {
  width: number;
  height: number;
};

const getViewportSize = (): ViewportSize => {
  const viewport = window.visualViewport;

  return {
    width: Math.round(viewport?.width ?? window.innerWidth),
    height: Math.round(viewport?.height ?? window.innerHeight),
  };
};

function useViewportSize(): ViewportSize {
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize());

  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize(getViewportSize());
    };

    window.addEventListener('resize', updateViewportSize);
    window.addEventListener('orientationchange', updateViewportSize);
    window.visualViewport?.addEventListener('resize', updateViewportSize);
    window.visualViewport?.addEventListener('scroll', updateViewportSize);

    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.removeEventListener('orientationchange', updateViewportSize);
      window.visualViewport?.removeEventListener('resize', updateViewportSize);
      window.visualViewport?.removeEventListener('scroll', updateViewportSize);
    };
  }, []);

  return viewportSize;
}

function getFittedMainWidth(
  preferredWidth: number,
  viewportSize: ViewportSize,
  deviceType: 'mobile' | 'pc',
  showGameTool: boolean,
) {
  const viewportPadding = deviceType === 'mobile' ? 8 : 16;
  const availableWidth = Math.max(240, viewportSize.width - viewportPadding * 2);
  const availableHeight = Math.max(180, viewportSize.height - viewportPadding * 2);

  const getTotalWidth = (mainWidth: number) => {
    const gameHeight = mainWidth * GAME_ASPECT_RATIO;
    return getGameToolLayoutMetrics(mainWidth, gameHeight, deviceType, showGameTool).totalWidth;
  };

  const getTotalHeight = (mainWidth: number) => {
    const gameHeight = mainWidth * GAME_ASPECT_RATIO;
    return getGameToolLayoutMetrics(mainWidth, gameHeight, deviceType, showGameTool).totalHeight;
  };

  let low = 160;
  let high = Math.max(low, preferredWidth);

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (getTotalWidth(mid) <= availableWidth && getTotalHeight(mid) <= availableHeight) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.max(160, Math.floor(Math.min(preferredWidth, low)));
}

function getLandscapeViewportSize(viewportSize: ViewportSize): ViewportSize {
  return {
    width: Math.max(viewportSize.width, viewportSize.height),
    height: Math.min(viewportSize.width, viewportSize.height),
  };
}

function getMobileGameMainSize(
  viewportSize: ViewportSize,
  showGameTool: boolean,
  stageRows?: number,
): ViewportSize {
  void stageRows;
  const landscape = getLandscapeViewportSize(viewportSize);
  const availableWidth = Math.max(240, landscape.width);
  const availableHeight = Math.max(180, landscape.height);
  let low = 120;
  let high = Math.max(low, availableWidth);

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const metrics = getGameToolLayoutMetrics(mid, availableHeight, 'mobile', showGameTool);
    if (metrics.totalWidth <= availableWidth && metrics.totalHeight <= availableHeight) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    width: Math.floor(Math.max(120, low)),
    height: Math.floor(availableHeight),
  };
}

function getPcGameMainSize(
  preferredWorldWidth: number,
  viewportSize: ViewportSize,
  showGameTool: boolean,
): ViewportSize {
  const viewportPadding = 16;
  const availableWidth = Math.max(240, viewportSize.width - viewportPadding * 2);
  const availableHeight = Math.max(180, viewportSize.height - viewportPadding * 2);
  const preferredScale = Math.max(0.1, preferredWorldWidth / LOGICAL_BATTLE_WORLD_WIDTH);
  let low = 0.1;
  let high = preferredScale;

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const mainWidth = LOGICAL_BATTLE_WIDTH * mid;
    const mainHeight = LOGICAL_BATTLE_HEIGHT * mid;
    const metrics = getGameToolLayoutMetrics(mainWidth, mainHeight, 'pc', showGameTool);
    if (metrics.totalWidth <= availableWidth && metrics.totalHeight <= availableHeight) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    width: Math.floor(LOGICAL_BATTLE_WIDTH * low),
    height: Math.floor(LOGICAL_BATTLE_HEIGHT * low),
  };
}

function getFittedMainSize(
  preferredWidth: number,
  viewportSize: ViewportSize,
  deviceType: 'mobile' | 'pc',
  showGameTool: boolean,
  stageRows?: number,
): ViewportSize {
  if (deviceType === 'mobile' && showGameTool) {
    return getMobileGameMainSize(viewportSize, showGameTool, stageRows);
  }

  if (deviceType === 'pc' && showGameTool) {
    return getPcGameMainSize(preferredWidth, viewportSize, showGameTool);
  }

  const fittedWidth = getFittedMainWidth(preferredWidth, viewportSize, deviceType, showGameTool);
  return {
    width: fittedWidth,
    height: Math.floor(fittedWidth * GAME_ASPECT_RATIO),
  };
}

function getNonGameMainSize(
  preferredWidth: number,
  viewportSize: ViewportSize,
  deviceType: 'mobile' | 'pc',
) {
  if (deviceType === 'pc') {
    const fittedWidth = getFittedMainWidth(preferredWidth, viewportSize, deviceType, false);

    return {
      width: fittedWidth,
      height: Math.floor(fittedWidth * GAME_ASPECT_RATIO),
    };
  }

  const viewportPadding = 16;
  const availableWidth = Math.max(240, viewportSize.width - viewportPadding * 2);
  const availableHeight = Math.max(180, viewportSize.height - viewportPadding * 2);

  return {
    width: Math.max(160, Math.floor(Math.min(preferredWidth, availableWidth))),
    height: Math.floor(availableHeight),
  };
}

function App() {
  const [librariesReady, setLibrariesReady] = useState(false);
  const [librariesError, setLibrariesError] = useState<Error | null>(null);
  // State to control the visibility of the game tool
  const [showGameTool, setShowGameTool] = useState(false);
  const [showGameScreen, setShowGameScreen] = useState(false);
  const [showGameResult, setShowGameResult] = useState(false);
  const [showRoomView, setShowRoomView] = useState(false);
  const showGameResultRef = useRef(showGameResult);
  showGameResultRef.current = showGameResult;
  const [gameParams, setGameParams] = useState<GameParams | null>(null);
  const [gameResult, setGameResult] = useState<StageResult | null>(null);
  const deviceType = useDeviceType();
  const viewportSize = useViewportSize();
  const saveManager = useSaveManager();

  //  References to the PhaserGame component (game and scene are exposed)
  const phaserRef = useRef<IRefPhaserGame | null>(null);

  const { width } = useSettings();
  const gamePreferredWidth = LOGICAL_BATTLE_WORLD_WIDTH;
  const layoutSize = useMemo(() => (
    getFittedMainSize(
      showGameTool ? gamePreferredWidth : width,
      viewportSize,
      deviceType,
      showGameTool,
      gameParams?.stageRows,
    )
  ), [gamePreferredWidth, width, viewportSize, deviceType, showGameTool, gameParams?.stageRows]);
  const layoutWidth = layoutSize.width;
  const layoutHeight = layoutSize.height;
  const nonGameLayout = useMemo(() => (
    getNonGameMainSize(width, viewportSize, deviceType)
  ), [width, viewportSize, deviceType]);
  const forceLandscape = deviceType === 'mobile'
    && showGameScreen
    && viewportSize.height > viewportSize.width;

  useEffect(() => {
    isUnlockAllEnabled();
    // 测试钩子：netDebug=1 或 perfHarness=1 时暴露网络状态与测试配置接口。
    // 性能基线用 perfHarness=1，只开测试 API，不开网络字节/console 诊断记录。
    const isHarness = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('perfHarness') === '1';
    if (typeof window !== 'undefined' && (isNetDebugEnabled() || isHarness)) {
      // 记录最近一次确定性状态采样，供双窗口联机 E2E 比对两端模拟是否分叉。
      // 只在 netDebug/perfHarness 时订阅，普通游戏零开销。
      let lastHash: { frameId: number; hash: string } | null = null;
      const onHashSampled = (sample: { frameId: number; hash: string }) => {
        lastHash = { frameId: sample.frameId, hash: sample.hash };
      };
      PhaserEventBus.on(PhaserEvents.SimulationHashSampled, onHashSampled);
      (window as any).MVZ_NET = {
        getSimulationHash: () => lastHash,
        getDesyncState: () => ({
          offline: CombatManager.Instance.isDesyncOffline(),
          reason: CombatManager.Instance.getDesyncReason(),
        }),
        getPerfSampler: () => perfSampler.snapshot(),
        resetPerfSampler: () => perfSampler.reset(),
        getState: () => ({
          reconnecting: BackendWS.isReconnecting(),
          reconnectAttempt: BackendWS.getReconnectAttempt(),
          latencyMs: BackendWS.getAverageLatencyMs(),
          online: BackendWS.isOnlineMode(),
          roomSession: BackendWS.isRoomSessionMode(),
          inGame: BackendWS.GetFrameID() > 0,
          frameId: BackendWS.GetFrameID(),
          stage: onlineStateManager.getCurrentGameStage(),
          roomId: onlineStateManager.getRoomInfo().roomId,
          myId: onlineStateManager.getRoomInfo().myId,
          lordId: onlineStateManager.getRoomInfo().lordId,
          peers: onlineStateManager.getRoomPeersData(),
        }),
        configureReconnect: (options: { baseDelayMs?: number; maxDelayMs?: number; maxAttempts?: number }) =>
          BackendWS.configureReconnectForTest(options),
        openRoom: (options: { roomName?: string; roomId?: number; chapterId?: number; stageId?: number; username?: string }) => {
          // E2E 专用：直接走与房间列表 UI 相同的 lobby 入口，避免依赖 DOM 流程。
          const serverAddress = new URLSearchParams(window.location.search).get('serverAddr')
            || saveManager.getOnlineConfig().serverAddr
            || '';
          const params = { baseUrl: serverAddress, ...options };
          if (typeof options.roomId === 'number') return joinRoom(params);
          return createRoom(params);
        },
        closeRoom: () => BackendWS.closeConnection(),
        dropSocketForTest: () => BackendWS.dropSocketForTest(),
        forceGiveUpForTest: (reason: string) => BackendWS.giveUpReconnectForTest(reason),
        getRecentRoutes: () => BackendWS.getRecentRoutesForTest(),
        sendReady: (isReady: boolean) => SendReady(isReady),
        sendLoaded: (isLoaded?: boolean) => SendLoaded(isLoaded ?? true),
        chooseStage: (chapterId: number, stageId: number) => SendChooseMap(chapterId, stageId),
        sendEndGame: (isWin: boolean) => SendEndGame(isWin),
        sendReturnToLobby: () => SendReturnToLobby(),
        // E2E：对局中确认退出（永久离房 + 取消房间 + 回主菜单）。
        requestExitGame: () => PhaserEventBus.emit(PhaserEvents.RequestExitGame, { online: BackendWS.isOnlineMode() }),
        // E2E：暂停菜单体验——联机打开菜单不暂停、倍速锁定、二次确认退出。
        toggleOnlinePauseMenu: () => {
          const scene = (window as unknown as { __MVZ443_GAME__?: import('./game/scenes/Game').Game }).__MVZ443_GAME__;
          scene?.toggleOnlinePauseMenu();
          return Boolean(scene);
        },
        requestPauseMenuExit: () => {
          const scene = (window as unknown as { __MVZ443_GAME__?: import('./game/scenes/Game').Game }).__MVZ443_GAME__;
          scene?.requestPauseMenuExit();
          return Boolean(scene);
        },
        toggleTimeSpeedForTest: () => CombatManager.Instance.handleTimespeedToggle(),
        getGameRuntime: () => {
          const scene = (window as unknown as { __MVZ443_GAME__?: import('./game/scenes/Game').Game }).__MVZ443_GAME__;
          return {
            paused: CombatManager.Instance.isPaused,
            timeScale: scene?.time?.timeScale ?? null,
            pauseMenu: scene?.getPauseMenuState() ?? { visible: false },
          };
        },
        // 走与真实“确认/准备”按钮完全相同的选卡确认路径：设置 GameParams +
        // 发送带 loadout 的 ready。仅 sendReady 无法挂载 Phaser，权威帧永远不被消费。
        confirmLoadout: (plants: Array<{ pid: number; level: number }>, stageId: number, chapterId: number) => {
          const params: GameParams = {
            level: stageId,
            plants,
            gold: 0,
            gameExit: (result: StageResult) => gameExit(result),
            gameSettings: {
              isBluePrint: false,
              basicDebug: false,
              isBgm: false,
              isSoundAudio: false,
              showCardLevelInGame: false,
            },
          };
          setGameParams(params);
          const loadout = {
            cards: plants,
            level: stageId,
            initialEnergy: 0,
            initialStarShards: 0,
            globalModifiers: [],
          };
          SendReady(true, loadout);
          return true;
        },
        // 走与真实鼠标点击完全相同的种植路径（选卡 → onAttemptPlant → QueueSend），
        // 供双窗口联机 E2E 驱动权威操作。
        plantAt: (pid: number, level: number, col: number, row: number) => {
          CardpileManager.Instance.ClickCard(pid, level);
          CursorManager.Instance.EventBus.emit('onAttemptPlant', col, row);
        },
        // 性能测试专用：单机 mock 房间启动。设置 GameParams 后启动 mockServer，
        // 再复用与真实 UI 相同的 chooseMap + ready 进入 Preloader/Game。
        startSinglePlayerForPerf: (plants: Array<{ pid: number; level: number }>, stageId: number, chapterId: number) => {
          const params: GameParams = {
            level: stageId,
            plants,
            gold: 0,
            gameExit: (result: StageResult) => gameExit(result),
            gameSettings: {
              isBluePrint: false,
              basicDebug: false,
              isBgm: false,
              isSoundAudio: false,
              showCardLevelInGame: false,
            },
          };
          setGameParams(params);
          BackendWS.startSinglePlayerRoom();
          BackendWS.send(Request.toBinary({
            payload: { chooseMap: { chapterId, stageId }, oneofKind: 'chooseMap' },
          }));
          BackendWS.send(Request.toBinary({
            payload: {
              ready: {
                isReady: true,
                loadout: {
                  cards: plants,
                  level: stageId,
                  initialEnergy: 0,
                  initialStarShards: 0,
                  globalModifiers: [],
                },
              },
              oneofKind: 'ready',
            },
          }));
          window.setTimeout(() => {
            BackendWS.send(Request.toBinary({
              payload: { playerLoaded: { progress: 100 }, oneofKind: 'playerLoaded' },
            }));
            // UI 的 gameStart 由 RoomAllReady 触发；单机 mock 已完成 ready，这里补发一次。
            PhaserEventBus.emit(PhaserEvents.RoomAllReady, { allPlayerCount: 1 });
          }, 50);
          return true;
        },
        // 性能测试专用：只通过 Cmd 层注入确定性的实体/投射物批次。
        // 不直接改 Model 字段，保证 DeferredManager 与帧边界语义一致。
        injectPerfScene: (config: {
          plants: Array<{ pid: number; level: number; col: number; row: number }>;
          zombies: Array<{ mid: number; col: number; row: number; wave?: number }>;
          projectiles: Array<{ x: number; row: number; damage?: number; maxDistance?: number }>;
        }) => {
          const scene = (window as unknown as { __MVZ443_GAME__?: import('./game/scenes/Game').Game }).__MVZ443_GAME__;
          const activeScene = scene ?? (phaserRef.current?.game?.scene?.getScene('Game') as import('./game/scenes/Game').Game | null | undefined) ?? undefined;
          if (!activeScene) return false;
          for (const item of config.plants ?? []) {
            const model = PlantLibrary.GetModel(item.pid);
            if (model) PlantCmd.Create(model, activeScene, item.col, item.row, item.level);
          }
          for (const item of config.zombies ?? []) {
            MobCmd.Spawn(item.mid, activeScene, item.col, item.row, item.wave ?? 0);
          }
          for (const item of config.projectiles ?? []) {
            ProjectileCmd.Create(BulletModel, activeScene, item.x, item.row, {
              damage: item.damage ?? 1,
              faction: 1,
              maxDistance: item.maxDistance ?? 5000,
              penetratePower: 1,
              skipTiny: false,
            });
          }
          return true;
        },
        getPerfCounts: () => {
          let zombies = 0;
          MobManager.Instance.MobsByLane.forEach((list) => { zombies += list.length; });
          let plants = 0;
          PlantsManager.Instance.PlantsMap.forEach((list) => { plants += list.length; });
          const game = (window as unknown as { __MVZ443_GAME__?: import('./game/scenes/Game').Game }).__MVZ443_GAME__
            ?? (phaserRef.current?.game?.scene?.getScene('Game') as import('./game/scenes/Game').Game | null | undefined)
            ?? undefined;
          return {
            plants,
            zombies,
            projectiles: ProjectileCmd.getActiveProjectiles().length,
            phaserFps: game?.game?.loop?.actualFps ?? null,
            phaserDelta: game?.game?.loop?.delta ?? null,
          };
        },
        showResultForTest: () => gameExit({
          isWin: true,
          chapterId: 1,
          stageId: 1,
          onWin: { unLock: [], unLockPlant: [] },
          rewards: [],
          progress: 100,
        }),
      };
      return () => {
        PhaserEventBus.off(PhaserEvents.SimulationHashSampled, onHashSampled);
      };
    }
  }, [saveManager]);

  useEffect(() => {
    const handleUnlockShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.code !== 'KeyU') {
        return;
      }
      event.preventDefault();
      toggleUnlockAll();
      const url = new URL(window.location.href);
      url.searchParams.delete('unlockall');
      window.location.replace(url.toString());
    };
    window.addEventListener('keydown', handleUnlockShortcut);
    return () => window.removeEventListener('keydown', handleUnlockShortcut);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    initializeGameLibraries()
      .then(() => {
        if (!isCancelled) {
          setLibrariesReady(true);
        }
      })
      .catch((error) => {
        console.error('Failed to initialize game libraries:', error);
        if (!isCancelled) {
          setLibrariesError(error instanceof Error ? error : new Error(String(error)));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const gameStart = useCallback(() => {
    setShowRoomView(false);
    setShowGameScreen(true);
    setShowGameTool(true);
  }, [setShowGameScreen, setShowGameTool]);

  const exitResultView = useCallback(() => {
    setGameResult(null);
    setShowGameResult(false);
    setShowGameScreen(false);
    setShowGameTool(false);
  }, [setShowGameResult, setShowGameScreen, setShowGameTool]);

  /** 联机结算后回到原房间等待（关卡页的联机侧边栏/等待房间）。 */
  const returnToRoomView = useCallback(() => {
    exitResultView();
    setShowRoomView(true);
  }, [exitResultView]);

  /** 单机结算返回：直接回到主界面。 */
  const exitResultToMenu = useCallback(() => {
    setShowRoomView(false);
    exitResultView();
  }, [exitResultView]);

  // 服务端在 PostGame 超时或玩家请求后确认回到等待房间；此时 DocFrame 可能未挂载
  // （结算页正在显示），所以在 App 顶层监听，保证两端都能回到房间界面。
  useEffect(() => {
    const handleReturnToLobby = () => {
      if (showGameResultRef.current) {
        setShowRoomView(true);
      }
    };
    PhaserEventBus.on(PhaserEvents.ReturnToLobby, handleReturnToLobby);
    return () => {
      PhaserEventBus.off(PhaserEvents.ReturnToLobby, handleReturnToLobby);
    };
  }, []);

  const gameExit = useCallback((result: StageResult) => {
    if (phaserRef.current) {
      phaserRef.current.game?.destroy(true);
      phaserRef.current = null;
    }
    setShowGameScreen(false);
    setShowGameTool(false);

    // 结算
    setGameResult(result);
    setShowGameResult(true);
    // 单机 mock 房间结算后关闭；联机房间保持连接，等待玩家点“返回房间”后
    // 由服务端广播 ReturnToLobby 事件再回到等待房间。
    BackendWS.closeMockRoom();
    BackendWS.ResetGameData();
  }, [setShowGameScreen, setShowGameTool]);

  // 对局中确认退出：直接回主菜单，不进结算页；联机永久离房并取消房间。
  useEffect(() => {
    const handleRequestExit = async ({ online }: { online: boolean }) => {
      if (phaserRef.current) {
        phaserRef.current.game?.destroy(true);
        phaserRef.current = null;
      }
      if (online) {
        const config = saveManager.getOnlineConfig();
        try {
          await leaveRoomAndDestroy(config.username, config.serverAddr);
        } catch (error) {
          console.error('退出并取消房间失败:', error);
        }
      }
      BackendWS.closeConnection();
      BackendWS.closeMockRoom();
      setGameResult(null);
      setShowGameResult(false);
      setShowGameScreen(false);
      setShowGameTool(false);
      setShowRoomView(false);
    };
    PhaserEventBus.on(PhaserEvents.RequestExitGame, handleRequestExit);
    return () => {
      PhaserEventBus.off(PhaserEvents.RequestExitGame, handleRequestExit);
    };
  }, [saveManager]);

  // Event emitted from the PhaserGame component
  const currentScene = (_scene: Phaser.Scene) => {
    // setCanMoveSprite(scene.scene.key !== 'MainMenu');
  }

  // 监听键盘事件
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F1" || event.key === "F2" || event.key === "F3" || event.key === "F4"
        || event.key === "F5" || event.key === "F6" || event.key === "F7" || event.key === "F8"
        || event.key === "F9" || event.key === "F10" || event.key === 'ESC') {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    // 在游戏启动时添加全局错误处理
    window.addEventListener('error', function (event) {
      console.warn('捕获到全局错误:', event.error);
      // 你可以根据需要在这里做一些清理工作，避免游戏崩溃
    }, true);
  }, []);

  useEffect(() => {
    if (!(deviceType === 'mobile' && showGameScreen)) {
      return;
    }

    const orientation = screen.orientation as (ScreenOrientation & {
      lock?: (orientation: OrientationLockType) => Promise<void>;
      unlock?: () => void;
    }) | undefined;
    void orientation?.lock?.('landscape').catch(() => undefined);

    return () => {
      orientation?.unlock?.();
    };
  }, [deviceType, showGameScreen]);

  if (!librariesReady) {
    return (
      <div id="app" style={{
        width: "100vw",
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1a1a1a",
        color: "#ddd",
        fontFamily: "Arial, sans-serif",
      }}>
        {librariesError ? "Failed to load stage library" : "Loading..."}
      </div>
    );
  }

  return (
    <Router>
      {/* 全局在线状态变化监听器 */}
      <GlobalOnlineStateListener />
      {/* 全局网络重连徽标与错误 Toast */}
      <NetworkStatusOverlay />
      {/* 全局前端级对话框（替代系统 alert/confirm） */}
      <GlobalDialogHost />

      <Routes>
        <Route path={`${publicUrl}/`} element={
          <GameMainWindow
            width={layoutWidth}
            height={layoutHeight}
            nonGameWidth={nonGameLayout.width}
            nonGameHeight={nonGameLayout.height}
            deviceType={deviceType}
            showGameTool={showGameTool}
            showGameScreen={showGameScreen}
            showGameResult={showGameResult}
            gameParams={gameParams}
            gameResult={gameResult}
            phaserRef={phaserRef}
            currentScene={currentScene}
            gameExit={gameExit}
            exitResultView={exitResultToMenu}
            returnToRoomView={returnToRoomView}
            showRoomView={showRoomView}
            setGameParams={setGameParams}
            gameStart={gameStart}
            forceLandscape={forceLandscape}
          />
        } />
        <Route path={`${publicUrl}/settings`} element={<SettingsPage width={layoutWidth} height={layoutHeight} />} />
      </Routes>
    </Router>
  )
}

export default App
