import i18n, { translate } from "../../i18n";
import { commonKey, stageKey } from "../../i18n/keys";
import DepthHelper from "../utils/helper/DepthHelper";
import BackendWS from "../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import MobManager, { ProgressMode, ProgressUpdateEvent } from "../managers/combat/MobManager";
import { PositionManager } from "../managers/view/PositionManager";
import type { Game } from "../scenes/Game";
import { StageDataRecords } from "../managers/library/ChapterLibrary";
import { StarShardsPanelView } from "./StarShardsPanelView";

const BAR_BG = 0x333333;
const PROGRESS_BG = 0x555555;
const PROGRESS_FILL = 0x4caf50;
const BOSS_FILL = 0xff4444;

function stopInput(event?: Phaser.Types.Input.EventData) {
  event?.stopPropagation();
}

function fitText(text: Phaser.GameObjects.Text, maxWidth: number, preferred: number, minSize: number) {
  let size = preferred;
  text.setFontSize(size);
  while (text.width > maxWidth && size > minSize) {
    size -= 1;
    text.setFontSize(size);
  }
}

function fillProgressRect(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
) {
  if (width <= 0 || height <= 0) {
    return;
  }

  graphics.fillStyle(color, 1);
  graphics.fillRoundedRect(x, y, width, height, Math.min(height / 2, width / 2));
}

export class BottomBar {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly moneyText: Phaser.GameObjects.Text;
  private readonly starShardsPanel: StarShardsPanelView;
  private readonly progressBg: Phaser.GameObjects.Graphics;
  private readonly progressFill: Phaser.GameObjects.Graphics;
  private readonly flagGraphics: Phaser.GameObjects.Graphics;
  private readonly stageText: Phaser.GameObjects.Text;
  private readonly pauseText: Phaser.GameObjects.Text;
  private readonly unsubs: Array<() => void> = [];
  private readonly bounds: { x: number; y: number; width: number; height: number };
  private progressState: ProgressUpdateEvent = {
    mode: ProgressMode.Normal,
    totalWaves: 99,
    currentWave: 0,
    flagWaves: [],
  };

  constructor(scene: Game) {
    this.scene = scene;
    const layout = PositionManager.Instance.getSceneChromeLayout(this.scene.params.deviceType ?? "pc");
    this.bounds = layout.bottomToolbar;
    this.container = this.scene.add.container(this.bounds.x, this.bounds.y).setDepth(DepthHelper.UI.chromeContainer());
    this.bg = this.scene.add.graphics();
    this.container.add(this.bg);
    this.bg.fillStyle(BAR_BG, 1);
    this.bg.fillRect(0, 0, this.bounds.width, this.bounds.height);

    const fontSize = Math.max(10, Math.round(this.bounds.height * 0.46));
    this.moneyText = this.scene.add.text(
      this.bounds.width * 0.02,
      this.bounds.height / 2,
      `${this.scene.params.gold ?? 0} $`,
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${fontSize}px`,
        color: "#ffd700",
        fontStyle: "bold",
      },
    ).setOrigin(0, 0.5);
    fitText(this.moneyText, this.bounds.width * 0.1, fontSize, 9);
    this.container.add(this.moneyText);

    this.starShardsPanel = new StarShardsPanelView(
      this.scene,
      this.bounds.x + this.bounds.width * 0.13,
      this.bounds.y,
      Math.max(this.bounds.width * 0.1, this.bounds.height * 2.4),
      this.bounds.height,
      "icons",
    );

    this.progressBg = this.scene.add.graphics();
    this.progressFill = this.scene.add.graphics();
    this.flagGraphics = this.scene.add.graphics();
    this.container.add([this.progressBg, this.progressFill, this.flagGraphics]);

    this.stageText = this.scene.add.text(
      this.bounds.width * 0.81,
      this.bounds.height / 2,
      "",
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${fontSize}px`,
        color: "#ffffff",
        fontStyle: "bold",
      },
    ).setOrigin(0.5);
    this.container.add(this.stageText);

    const pauseFontSize = Math.max(10, Math.round(this.bounds.height * 0.4));
    this.pauseText = this.scene.add.text(
      this.bounds.width * 0.94,
      this.bounds.height / 2,
      translate("game.pause"),
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${pauseFontSize}px`,
        color: "#ffffff",
        fontStyle: "bold",
        backgroundColor: "#3f5164",
        padding: { x: Math.max(8, Math.round(this.bounds.height * 0.22)), y: Math.max(3, Math.round(this.bounds.height * 0.08)) },
      },
    ).setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.pauseText.setShadow(2, 2, "#18212b", 4);
    this.container.add(this.pauseText);
    // 联机：打开只读暂停菜单，模拟继续运行；单机：请求真正暂停。
    const requestPause = () => PhaserEventBus.emit(
      BackendWS.isOnlineMode() ? PhaserEvents.ToggleOnlinePauseMenu : PhaserEvents.TogglePause
    );
    this.pauseText.on("pointerover", () => {
      this.pauseText.setStyle({ backgroundColor: "#52687f" });
      this.pauseText.setScale(1.04);
    });
    this.pauseText.on("pointerout", () => {
      this.pauseText.setStyle({ backgroundColor: "#3f5164" });
      this.pauseText.setScale(1);
    });
    this.pauseText.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      requestPause();
    });
    this.pauseText.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      this.pauseText.setScale(0.96);
    });

    this.refreshStageText();
    this.updateProgress();
    this.bindEvents();
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  public destroy = () => {
    for (const unsub of this.unsubs.splice(0)) {
      unsub();
    }
    PhaserEventBus.off(PhaserEvents.BossHealth, this.handleBossHealth);
    PhaserEventBus.off(PhaserEvents.BossDead, this.handleBossDead);
    i18n.off("languageChanged", this.refreshStageText);
    this.starShardsPanel.destroy();
    this.container.destroy(true);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  };

  private bindEvents() {
    this.unsubs.push(MobManager.Instance.EventBus.on("onProgressUpdate", (progress) => {
      this.progressState = progress;
      this.updateProgress();
    }));

    PhaserEventBus.on(PhaserEvents.BossHealth, this.handleBossHealth);
    PhaserEventBus.on(PhaserEvents.BossDead, this.handleBossDead);
    i18n.on("languageChanged", this.refreshStageText);
  }

  private refreshStageText = () => {
    const stageRecord = this.scene.params.level ? StageDataRecords[this.scene.params.level] : null;
    const label = stageRecord
      ? translate(stageKey(stageRecord.nameKey))
      : translate(commonKey("loading"));
    this.stageText.setText(label);
    fitText(this.stageText, this.bounds.width * 0.18, Math.max(10, Math.round(this.bounds.height * 0.46)), 9);
    this.pauseText.setText(translate("game.pause"));
    fitText(this.pauseText, this.bounds.width * 0.1, Math.max(10, Math.round(this.bounds.height * 0.4)), 9);
  };

  private updateProgress() {
    const x = this.bounds.width * 0.365;
    const y = this.bounds.height * 0.28;
    const width = this.bounds.width * 0.31;
    const height = Math.max(8, this.bounds.height * 0.44);
    this.progressBg.clear();
    this.progressFill.clear();
    this.flagGraphics.clear();

    this.progressBg.fillStyle(PROGRESS_BG, 1);
    this.progressBg.fillRoundedRect(x, y, width, height, height / 2);

    if (this.progressState.mode === ProgressMode.Boss) {
      const percent = Math.max(0, Math.min(1, this.progressState.bossHealthPercent || 0));
      fillProgressRect(this.progressFill, x, y, width * percent, height, BOSS_FILL);
      return;
    }

    const maxWaveIndex = Math.max(0, this.progressState.totalWaves - 1);
    let percent = 0;
    if (maxWaveIndex > 0) {
      if (this.progressState.currentWave <= 0) {
        percent = 0;
      } else if (this.progressState.currentWave >= maxWaveIndex) {
        percent = 1;
      } else {
        percent = this.progressState.currentWave / maxWaveIndex;
      }
    } else {
      percent = this.progressState.currentWave > 0 ? 1 : 0;
    }

    const fillWidth = width * Math.max(0, Math.min(1, percent));
    fillProgressRect(this.progressFill, x + width - fillWidth, y, fillWidth, height, PROGRESS_FILL);

    this.flagGraphics.lineStyle(2, 0xffffff, 1);
    if (maxWaveIndex > 0) {
      for (const flagWave of this.progressState.flagWaves) {
        const flagPercent = Math.max(0, Math.min(1, flagWave / maxWaveIndex));
        const lineX = x + width - width * flagPercent;
        this.flagGraphics.lineBetween(lineX, y, lineX, y + height);
      }
    }
  }

  private handleBossHealth = ({ health }: { health: number }) => {
    if (health < 0) {
      return;
    }
    this.progressState = {
      mode: ProgressMode.Boss,
      bossHealthPercent: Math.max(0, Math.min(1, health / 100)),
    };
    this.updateProgress();
  };

  private handleBossDead = () => {
    if (this.progressState.mode !== ProgressMode.Boss) {
      return;
    }
    this.progressState = {
      mode: ProgressMode.Boss,
      bossHealthPercent: 0,
    };
    this.updateProgress();
  };
}
