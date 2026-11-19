import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IRefPhaserGame } from './game/PhaserGame';
import GlobalOnlineStateListener from './components/GlobalOnlineStateListener';
import NetworkStatusOverlay from './components/NetworkStatusOverlay';
import GlobalDialogHost from './components/GlobalDialogHost';
import GameMainWindow from './components/GameMainWindow';
import { useSettings } from './context/settings_ctx';
import { GameParams } from './game/models/GameParams';
import type { StageResult } from './types/stage';
import { useDeviceType } from './hooks/useDeviceType';
import { useViewportSize, getFittedMainSize, getNonGameMainSize } from './hooks/useAppLayout';
import { useGameLibraries } from './hooks/useGameLibraries';
import { useGameFunctionKeys } from './hooks/useGameFunctionKeys';
import { useScreenOrientationLock } from './hooks/useScreenOrientationLock';
import { useUnlockAllShortcut } from './hooks/useUnlockAllShortcut';
import { useGlobalErrorGuard } from './hooks/useGlobalErrorGuard';
import { useNetDebugHooks } from './hooks/useNetDebugHooks';
import BackendWS from './utils/net/sync';
import { onlineStateManager } from './store/OnlineStateManager';
import { leaveRoomAndDestroy } from './utils/net/lobby';
import { useSaveManager } from './context/save_ctx';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import SettingsPage from './pages/settings';
import { publicUrl } from './utils/browser';
import { PhaserEventBus, PhaserEvents } from './game/EventBus';
import { LOGICAL_BATTLE_WORLD_WIDTH } from './constants/gameLayout';
import { serverStatus } from './utils/net/server_status';

function App() {
  const { ready: librariesReady, error: librariesError } = useGameLibraries();
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

  const settings = useSettings();
  const { width } = settings;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const gameParamsRef = useRef<GameParams | null>(gameParams);
  gameParamsRef.current = gameParams;
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

  useUnlockAllShortcut();
  useGameFunctionKeys();
  useGlobalErrorGuard();
  useScreenOrientationLock(deviceType === 'mobile' && showGameScreen);

  const gameStart = useCallback(() => {
    // 页面刷新后的重连没有本地 ParamsSelector，需要从服务端 AllReady
    // 下发的 seed / loadout / 章节关卡重建 GameParams，否则 Phaser 只能显示
    // “no game params”。正常开局时 ParamsSelector 已经设置过，保留其设置。
    if (!gameParamsRef.current) {
      const allReady = onlineStateManager.getRoomAllReady();
      const meta = onlineStateManager.getRoomMeta();
      const stageId = allReady?.stageId || meta.stageId;
      const ownLoadout = allReady?.loadouts?.find((entry) => entry.playerId === allReady.myId);
      if (stageId > 0 && ownLoadout?.loadout) {
        const currentSettings = settingsRef.current;
        const params: GameParams = {
          level: stageId,
          plants: ownLoadout.loadout.cards.map((card) => ({ pid: card.pid, level: card.level })),
          gold: saveManager.currentProgress.items.get(1)?.count ?? 0,
          gameExit: () => { console.log('no gameexit Implemented') },
          gameSettings: {
            isBluePrint: currentSettings.isBluePrint,
            basicDebug: currentSettings.basicDebug,
            isBgm: currentSettings.isBgm,
            isSoundAudio: currentSettings.isSoundAudio,
            showCardLevelInGame: currentSettings.showCardLevelInGame,
            bgmVolume: currentSettings.bgmVolume,
            soundAudioVolume: currentSettings.soundAudioVolume,
          },
        };
        gameParamsRef.current = params;
        setGameParams(params);
      } else {
        console.error('[reconnect] 缺少重建 GameParams 所需的关卡或开局配置', allReady, meta);
      }
    }
    setShowRoomView(false);
    setShowGameScreen(true);
    setShowGameTool(true);
    serverStatus.suspend();
  }, [saveManager, setGameParams, setShowGameScreen, setShowGameTool]);

  const exitResultView = useCallback(() => {
    setGameResult(null);
    setShowGameResult(false);
    setShowGameScreen(false);
    setShowGameTool(false);
    serverStatus.resume(saveManager.getOnlineConfig().serverAddr);
  }, [saveManager, setShowGameResult, setShowGameScreen, setShowGameTool]);

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
    serverStatus.resume(saveManager.getOnlineConfig().serverAddr);
    // 单机 mock 房间结算后关闭；联机房间保持连接，等待玩家点“返回房间”后
    // 由服务端广播 ReturnToLobby 事件再回到等待房间。
    BackendWS.closeMockRoom();
    BackendWS.ResetGameData();
  }, [saveManager, setShowGameScreen, setShowGameTool]);

  // 对局中确认退出：直接回主菜单，不进结算页；联机永久离房并取消房间。
  useEffect(() => {
    const handleRequestExit = async ({ online }: { online: boolean }) => {
      if (online) {
        // 先取消自动重连再发退房请求：否则退出方收到服务端 roomClosed 后
        // transport 的 close 事件会立刻重新排入重连，导致房间取消后仍回到房间。
        BackendWS.cancelReconnect();
      }
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
      onlineStateManager.resetAllState();
      BackendWS.closeMockRoom();
      gameParamsRef.current = null;
      setGameParams(null);
      setGameResult(null);
      setShowGameResult(false);
      setShowGameScreen(false);
      setShowGameTool(false);
      setShowRoomView(false);
      serverStatus.resume(saveManager.getOnlineConfig().serverAddr);
    };
    PhaserEventBus.on(PhaserEvents.RequestExitGame, handleRequestExit);
    return () => {
      PhaserEventBus.off(PhaserEvents.RequestExitGame, handleRequestExit);
    };
  }, [saveManager]);

  useNetDebugHooks({
    saveManager,
    phaserRef,
    setGameParams,
    gameExit,
  });

  // Event emitted from the PhaserGame component
  const currentScene = (_scene: Phaser.Scene) => {
    // setCanMoveSprite(scene.scene.key !== 'MainMenu');
  };

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
