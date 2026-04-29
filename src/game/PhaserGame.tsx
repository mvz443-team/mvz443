import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import StartGame from './main';
import {
  PhaserEventBus,
  PhaserEvents,
} from './EventBus';
import { GameParams } from './models/GameParams';
import { StageResult } from './models/IRecord';

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
}


export const PhaserGame = forwardRef<IRefPhaserGame, IProps>(function PhaserGame({
  currentActiveScene, isVisibility, gameParams, gameExit, width, height }, ref) {
  if (gameParams) {
    gameParams.gameExit = gameExit;
  }

  const game = useRef<Phaser.Game | null>(null!);

  useLayoutEffect(() => {
    if (!gameParams) {
      return;
    }

    if (game.current === null) {

      game.current = StartGame("game-container", width, gameParams);

      if (typeof ref === 'function') {
        ref({ game: game.current, scene: null });
      } else if (ref) {
        ref.current = { game: game.current, scene: null };
      }

    }

    return () => {
      if (game.current) {
        game.current.destroy(true);
        if (game.current !== null) {
          game.current = null;
        }
      }
    }
  }, [gameParams, ref, width]);

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
