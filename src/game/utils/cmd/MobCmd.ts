import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import { DeferredManager } from "../../managers/DeferredManager";
import MobManager from "../../managers/combat/MobManager";
import { MonsterLibrary } from "../../managers/library/MonsterLibrary";
import PlantsManager from "../../managers/combat/PlantsManager";
import { PositionManager } from "../../managers/view/PositionManager";
import { MonsterEntity } from "../../models/entities/MonsterEntity";
import type { Game } from "../../scenes/Game";
import { translate } from "../../../i18n";
import DepthHelper from "../helper/DepthHelper";

const ANNOUNCE_KEY = "__bossSkillAnnounce";

interface AnnounceState {
  text: Phaser.GameObjects.Text;
  hideTimer: Phaser.Time.TimerEvent | null;
}

namespace MobCmd {
  export function Spawn(mid: number, scene: Game, col: number, row: number, waveID: number,
    callback?: (entity: MonsterEntity) => void) {
    DeferredManager.Instance.defer(() => {
      const model = MonsterLibrary.GetModel(mid);
      if (!model) return;
      const finalRow = Phaser.Math.Clamp(row, 0, PositionManager.Instance.Row_Number - 1);
      const en = model.createEntity(scene, col, finalRow, waveID);
      MobManager.Instance.registerMonster(en);
      en.addDestroyListener((entity) => MobManager.Instance.registerDestroy(entity));
      if (callback) callback(en);
    });
  }

  export function DamagePlantsArea(centerCol: number, centerRow: number, radiusX: number, radiusY: number, damage: number) {
    DeferredManager.Instance.defer(() => {
      for (let dx = -radiusX; dx <= radiusX; dx++) {
        for (let dy = -radiusY; dy <= radiusY; dy++) {
          const plants = scenePlantsAt(centerCol + dx, centerRow + dy);
          for (const plant of plants) {
            plant.takeDamage(damage);
          }
        }
      }
    });
  }

  // 对区域的全部植物造成伤害
  export function DamagePlantsInCells(cells: Array<{ col: number, row: number }>, damage: number) {
    DeferredManager.Instance.defer(() => {
      const visited = new Set<string>();
      for (const cell of cells) {
        const key = `${cell.col}-${cell.row}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const plants = scenePlantsAt(cell.col, cell.row);
        for (const plant of plants) {
          plant.takeDamage(damage);
        }
      }
    });
  }

  export function EmitBossHealth(entity: MonsterEntity) {
    PhaserEventBus.emit(PhaserEvents.BossHealth, {
      health: Math.max(0, Math.round(entity.currentHealth * 100 / entity.maxHealth)),
    });
  }

  export function AnnounceBossSkill(scene: Game, bossKey: string, skillKey: string, durationMs = 2000) {
    const state = getOrCreateAnnounceState(scene);
    const speedText = scene.speedText;

    if (speedText) {
      const x = speedText.x;
      const y = speedText.y + speedText.displayHeight + 6;
      state.text.setPosition(x, y);
    }

    state.text.setText(translate(`game.boss_skill.${bossKey}.skill.${skillKey}`));
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

  export function DeterministicRandom(min: number = 0, max: number = 1): number {
    if (min === max) return min;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return low + MobManager.Instance.SeedRandom() * (high - low);
  }

  function scenePlantsAt(col: number, row: number) {
    return [...(PlantsManager.Instance.PlantsMap.get(`${col}-${row}`) ?? [])];
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

}

export default MobCmd;
