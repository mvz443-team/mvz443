import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { IRefPhaserGame, PhaserGame } from './game/PhaserGame';
import DocFrame from './components/DocFrame';
import GlobalOnlineStateListener from './components/GlobalOnlineStateListener';
import { useSettings } from './context/settings_ctx';
import { GameParams } from './game/models/GameParams';
import type { StageResult } from './types/stage';
import GameResultView from './components/menu/result';
import { useDeviceType } from './hooks/useDeviceType';
import BackendWS from './utils/net/sync';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import SettingsPage from './pages/settings';
import { publicUrl } from './utils/browser';
import { initializeGameLibraries } from './game/managers/library/initializeGameLibraries';
import {
  GAME_ASPECT_RATIO,
  getGameToolLayoutMetrics,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
  LOGICAL_BATTLE_WORLD_WIDTH,
} from './constants/gameLayout';

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
  exitResultView: () => void;
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
  const [gameParams, setGameParams] = useState<GameParams | null>(null);
  const [gameResult, setGameResult] = useState<StageResult | null>(null);
  const deviceType = useDeviceType();
  const viewportSize = useViewportSize();

  //  References to the PhaserGame component (game and scene are exposed)
  const phaserRef = useRef<IRefPhaserGame | null>(null);

  const { width } = useSettings();
  const layoutSize = useMemo(() => (
    getFittedMainSize(width, viewportSize, deviceType, showGameTool, gameParams?.stageRows)
  ), [width, viewportSize, deviceType, showGameTool, gameParams?.stageRows]);
  const layoutWidth = layoutSize.width;
  const layoutHeight = layoutSize.height;
  const nonGameLayout = useMemo(() => (
    getNonGameMainSize(width, viewportSize, deviceType)
  ), [width, viewportSize, deviceType]);
  const forceLandscape = deviceType === 'mobile'
    && showGameScreen
    && viewportSize.height > viewportSize.width;

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
    setShowGameScreen(true);
    setShowGameTool(true);
  }, [setShowGameScreen, setShowGameTool]);

  const exitResultView = useCallback(() => {
    setGameResult(null);
    setShowGameResult(false);
    setShowGameScreen(false);
    setShowGameTool(false);
  }, [setShowGameResult, setShowGameScreen, setShowGameTool]);

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
    BackendWS.closeMockRoom();
    BackendWS.ResetGameData();
  }, [setShowGameScreen, setShowGameTool]);

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
            exitResultView={exitResultView}
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
