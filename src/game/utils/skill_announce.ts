import { translate } from "../../i18n";
import DepthHelper from "./helper/DepthHelper";
import type { Game } from "../scenes/Game";

const ANNOUNCE_KEY = "__bossSkillAnnounce";

interface AnnounceState {
  text: Phaser.GameObjects.Text;
  hideTimer: Phaser.Time.TimerEvent | null;
}

function getOrCreateAnnounceState(scene: Game): AnnounceState {
  const existing = (scene as any)[ANNOUNCE_KEY] as AnnounceState | undefined;
  if (existing) return existing;

  const fontSize = Math.min(scene.scale.displaySize.width / 28, 22);
  const text = scene.add.text(
    scene.cameras.main.width - 10,
    60,
    "",
    {
      fontSize: `${fontSize}px`,
      color: "#fff5d6",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
      backgroundColor: "#7a1f4a",
      stroke: "#3a0e22",
      strokeThickness: 2,
      padding: { x: 12, y: 6 },
    }
  ).setOrigin(1, 0).setDepth(DepthHelper.UI.bossSkillAnnounce()).setVisible(false).setAlpha(0);
  text.setShadow(2, 2, "#1a0a14", 6);

  const state: AnnounceState = { text, hideTimer: null };
  (scene as any)[ANNOUNCE_KEY] = state;

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    state.hideTimer?.remove(false);
    state.text.destroy();
    delete (scene as any)[ANNOUNCE_KEY];
  });

  return state;
}

export function announceBossSkill(scene: Game, skillKey: string, durationMs = 2000) {
  const state = getOrCreateAnnounceState(scene);
  const speedText = scene.speedText;

  if (speedText) {
    const x = speedText.x;
    const y = speedText.y + speedText.displayHeight + 6;
    state.text.setPosition(x, y);
  }

  state.text.setText(translate(`game.boss_skill.${skillKey}`));
  state.text.setVisible(true);
  state.text.setAlpha(0);

  scene.tweens.add({
    targets: state.text,
    alpha: 1,
    duration: 150,
    ease: "Sine.easeOut",
  });

  state.hideTimer?.remove(false);
  state.hideTimer = scene.time.delayedCall(durationMs, () => {
    scene.tweens.add({
      targets: state.text,
      alpha: 0,
      duration: 200,
      ease: "Sine.easeIn",
      onComplete: () => state.text.setVisible(false),
    });
    state.hideTimer = null;
  });
}
