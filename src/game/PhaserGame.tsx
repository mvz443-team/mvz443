import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import StartGame from './main';
import {
  PhaserEventBus,
  PhaserEvents,
} from './EventBus';
import { GameParams } from './models/GameParams';
import type { StageResult } from '../types/stage';
import { useSettings } from '../context/settings_ctx';

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}

interface IProps {
  currentActiveScene?: (scene_instance: Phaser.Scene) => void,
  isVisibility: boolean,
  gameParams: GameParams | null,
  gameExit: (result: StageResult) => void,
  width: number,
  height: number,
  mainViewportWidth: number,
  mainViewportHeight: number,
  deviceType: string,
}


export const PhaserGame = forwardRef<IRefPhaserGame, IProps>(function PhaserGame({
  currentActiveScene, isVisibility, gameParams, gameExit, width, height, mainViewportWidth, mainViewportHeight, deviceType }, ref) {
  const { fps } = useSettings();
  if (gameParams) {
    gameParams.gameExit = gameExit;
    gameParams.deviceType = deviceType;
    gameParams.gameSettings.fps = fps;
    gameParams.mainViewportHeight = Math.max(1, mainViewportHeight);
    gameParams.mainViewportWidth = Math.max(1, mainViewportWidth);
  }

  const game = useRef<Phaser.Game | null>(null!);

  useLayoutEffect(() => {
    if (!gameParams) {
      return;
    }

    if (game.current === null) {
      game.current = StartGame("game-container", width, gameParams, deviceType, fps);

      if (typeof ref === 'function') {
        ref({ game: game.current, scene: null });
      } else if (ref) {
        ref.current = { game: game.current, scene: null };
      }
    }
  }, [deviceType, fps, gameParams, ref, width]);

  useEffect(() => {
    const currentGame = game.current;
    if (!currentGame || !gameParams) return;
    const currentFps = currentGame.config.fps?.target ?? 60;
    if (currentFps !== fps) {
      currentGame.destroy(true);
      game.current = null;
      const nextFps = Math.max(30, Math.min(120, Math.round(fps)));
      gameParams.gameSettings.fps = nextFps;
      game.current = StartGame('game-container', width, gameParams, deviceType, nextFps);

      if (typeof ref === 'function') {
        ref({ game: game.current, scene: null });
      } else if (ref) {
        ref.current = { game: game.current, scene: null };
      }
    }
  }, [deviceType, fps, gameParams, width]);

  useEffect(() => {
    const currentGame = game.current;

    if (!currentGame) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      currentGame.scale.refresh();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [width, height]);

  useEffect(() => {
    PhaserEventBus.on(PhaserEvents.CurrentSceneReady, (scene_instance: Phaser.Scene) => {
      if (currentActiveScene && typeof currentActiveScene === 'function') {
        currentActiveScene(scene_instance);
      }

      if (typeof ref === 'function') {
        ref({ game: game.current, scene: scene_instance });
      } else if (ref) {
        ref.current = { game: game.current, scene: scene_instance };
      }

    });
    return () => {
      PhaserEventBus.removeListener(PhaserEvents.CurrentSceneReady);
    }
  }, [currentActiveScene, ref]);

  if (!gameParams) {
    return <p>no game params!@!</p>
  }

  return (
    <div id="game-container" style={{
      visibility: isVisibility ? 'visible' : 'hidden',
      width,
      height,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      overflow: 'hidden',
    }}></div>
  );

});
