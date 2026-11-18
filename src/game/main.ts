import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { AUTO, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';
import { GameParams } from './models/GameParams';
import {
  getGameSceneChromeLayout,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
} from '../constants/gameLayout';

//  Find out more information about the Game Config at:
//  https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: LOGICAL_BATTLE_WIDTH,
  height: LOGICAL_BATTLE_HEIGHT,

  autoRound: true,
  fps: {
    target: 60,
    forceSetTimeOut: false,
    smoothStep: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  parent: 'game-container',
  backgroundColor: 'rgba(0,0,0,0)',
  transparent: true,
  scene: [
    Boot,
    Preloader,
    MainGame,
    GameOver
  ]
};

const StartGame = (parent: string, width: number, GameParams: GameParams, deviceType: string, fps: number = 60) => {
  void width;
  const sceneBounds = getGameSceneChromeLayout(
    GameParams.mainViewportWidth ?? LOGICAL_BATTLE_WIDTH,
    GameParams.mainViewportHeight ?? LOGICAL_BATTLE_HEIGHT,
    deviceType,
    true,
  ).sceneBounds;
  config.width = sceneBounds.width;
  config.height = sceneBounds.height;
  config.fps = {
    target: Math.max(30, Math.min(120, Math.round(fps))),
    forceSetTimeOut: false,
    smoothStep: true,
  };
  const game = new Game({ ...config, parent })
  game.registry.set('gameParams', GameParams);
  return game;

}

export default StartGame;
