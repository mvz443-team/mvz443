import type { MutableRefObject } from 'react';
import { IRefPhaserGame, PhaserGame } from '../game/PhaserGame';
import DocFrame from './DocFrame';
import { useSettings } from '../context/settings_ctx';
import { GameParams } from '../game/models/GameParams';
import type { StageResult } from '../types/stage';
import GameResultView from './menu/result';
import { getGameToolLayoutMetrics } from '../constants/gameLayout';

export interface GameMainWindowProps {
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

export default function GameMainWindow({
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