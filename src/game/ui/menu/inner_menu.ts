import { Game } from "../../scenes/Game";
import { PauseMenu } from "./PauseMenu";

export default function CreateInnerMenu(game: Game) {
  const pauseMenu = new PauseMenu(game);
  (game as any).pauseMenu = pauseMenu;
  (game as any).refreshInnerMenuButtons = () => undefined;
}
