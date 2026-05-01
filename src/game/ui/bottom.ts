import i18n, { translate } from "../../i18n";
import { commonKey, stageKey } from "../../i18n/keys";
import DepthUtils from "../../utils/depth";
import BackendWS from "../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import CardpileManager from "../managers/combat/CardpileManager";
import MobManager, { ProgressMode, ProgressUpdateEvent } from "../managers/combat/MobManager";
import PlantsManager from "../managers/combat/PlantsManager";
import ResourceManager from "../managers/combat/ResourceManager";
import { PositionManager } from "../managers/view/PositionManager";
import type { Game } from "../scenes/Game";
import { StageDataRecords } from "../managers/library/ChapterLibrary";
import { UI_CHROME_DEPTH } from "./cardslots";

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

export class BottomBar {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly moneyText: Phaser.GameObjects.Text;
  private readonly starsContainer: Phaser.GameObjects.Container;
  private readonly starsBg: Phaser.GameObjects.Graphics;
  private readonly progressBg: Phaser.GameObjects.Graphics;
  private readonly progressFill: Phaser.GameObjects.Graphics;
  private readonly flagGraphics: Phaser.GameObjects.Graphics;
  private readonly stageText: Phaser.GameObjects.Text;
  private readonly unsubs: Array<() => void> = [];
  private readonly starObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly bounds: { x: number; y: number; width: number; height: number };
  private progressState: ProgressUpdateEvent = {
    mode: ProgressMode.Normal,
    totalWaves: 99,
    currentWave: 0,
    flagWaves: [],
  };
  private starShards = 0;
  private starSelected = false;
  private starFlashTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Game) {
    this.scene = scene;
    const layout = PositionManager.Instance.getSceneChromeLayout(this.scene.params.deviceType ?? "pc");
    this.bounds = layout.bottomToolbar;
    this.container = this.scene.add.container(this.bounds.x, this.bounds.y).setDepth(UI_CHROME_DEPTH + 1);
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

    this.starsContainer = this.scene.add.container(this.bounds.width * 0.13, 0);
    this.starsBg = this.scene.add.graphics();
    this.starsContainer.add(this.starsBg);
    this.container.add(this.starsContainer);

    const starsHit = this.scene.add.zone(0, 0, this.bounds.width * 0.27, this.bounds.height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    this.starsContainer.add(starsHit);
    starsHit.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      this.handleStarClick();
    });
    starsHit.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
    });

    this.progressBg = this.scene.add.graphics();
    this.progressFill = this.scene.add.graphics();
    this.flagGraphics = this.scene.add.graphics();
    this.container.add([this.progressBg, this.progressFill, this.flagGraphics]);

    this.stageText = this.scene.add.text(
      this.bounds.width * 0.9,
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
    const stageHit = this.scene.add.zone(this.bounds.width * 0.8, 0, this.bounds.width * 0.2, this.bounds.height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    this.container.add(stageHit);
    stageHit.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      if (!BackendWS.isOnlineMode()) {
        PhaserEventBus.emit(PhaserEvents.TogglePause);
      }
    });
    stageHit.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
    });

    this.refreshStageText();
    this.updateStars();
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
    this.starFlashTimer?.remove(false);
    this.container.destroy(true);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  };

  private bindEvents() {
    this.unsubs.push(ResourceManager.Instance.Eventbus.on("onStarShardsUpdate", (starShards, playerId) => {
      if (playerId === ResourceManager.Instance.mineId) {
        this.starShards = starShards;
        this.updateStars();
      }
    }));
    this.unsubs.push(MobManager.Instance.EventBus.on("onProgressUpdate", (progress) => {
      this.progressState = progress;
      this.updateProgress();
    }));
    this.unsubs.push(PlantsManager.Instance.EventBus.on("onStarshardsInsufficient", () => {
      this.flashStars();
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenStarShards", () => {
      this.starSelected = true;
      this.updateStars();
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenCard", () => {
      this.starSelected = false;
      this.updateStars();
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenPickaxe", () => {
      this.starSelected = false;
      this.updateStars();
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onCancelChosen", () => {
      this.starSelected = false;
      this.updateStars();
    }));

    PhaserEventBus.on(PhaserEvents.BossHealth, this.handleBossHealth);
    PhaserEventBus.on(PhaserEvents.BossDead, this.handleBossDead);
    i18n.on("languageChanged", this.refreshStageText);
  }

  private handleStarClick() {
    if (this.starShards <= 0) {
      PlantsManager.Instance.EventBus.emit("onStarshardsInsufficient");
      return;
    }
    CardpileManager.Instance.ClickStarShards();
  }

  private refreshStageText = () => {
    const stageRecord = this.scene.params.level ? StageDataRecords[this.scene.params.level] : null;
    const label = stageRecord
      ? translate(stageKey(stageRecord.nameKey))
      : translate(commonKey("loading"));
    this.stageText.setText(label);
    fitText(this.stageText, this.bounds.width * 0.18, Math.max(10, Math.round(this.bounds.height * 0.46)), 9);
  };

  private updateStars() {
    for (const object of this.starObjects.splice(0)) {
      object.destroy();
    }
    const width = this.bounds.width * 0.27;
    const height = this.bounds.height;
    this.starsBg.clear();
    if (this.starSelected) {
      this.starsBg.lineStyle(2, 0xffee22, 1);
      this.starsBg.strokeRoundedRect(1, 2, width - 2, height - 4, 5);
    }

    if (this.starShards >= 5) {
      const iconSize = height * 0.78;
      const icon = this.scene.add.image(iconSize * 0.55, height / 2, "starshards");
      icon.setDisplaySize(iconSize, iconSize);
      const text = this.scene.add.text(iconSize + 8, height / 2, `x ${this.starShards}`, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(10, Math.round(height * 0.42))}px`,
        color: "#ffffff",
        fontStyle: "bold",
      }).setOrigin(0, 0.5);
      this.starsContainer.add([icon, text]);
      this.starObjects.push(icon, text);
      return;
    }

    const iconSize = height * 0.78;
    for (let i = 0; i < this.starShards; i += 1) {
      const icon = this.scene.add.image(8 + iconSize / 2 + i * iconSize * 0.82, height / 2, "starshards");
      icon.setDisplaySize(iconSize, iconSize);
      this.starsContainer.add(icon);
      this.starObjects.push(icon);
    }
  }

  private flashStars() {
    this.starFlashTimer?.remove(false);
    this.starsBg.lineStyle(2, 0xff3c3c, 1);
    this.starsBg.strokeRoundedRect(1, 2, this.bounds.width * 0.27 - 2, this.bounds.height - 4, 5);
    this.starFlashTimer = this.scene.time.delayedCall(450, () => {
      this.starFlashTimer = null;
      this.updateStars();
    });
  }

  private updateProgress() {
    const x = this.bounds.width * 0.43;
    const y = this.bounds.height * 0.28;
    const width = this.bounds.width * 0.34;
    const height = Math.max(8, this.bounds.height * 0.44);
    this.progressBg.clear();
    this.progressFill.clear();
    this.flagGraphics.clear();

    this.progressBg.fillStyle(PROGRESS_BG, 1);
    this.progressBg.fillRoundedRect(x, y, width, height, height / 2);

    if (this.progressState.mode === ProgressMode.Boss) {
      const percent = Math.max(0, Math.min(1, this.progressState.bossHealthPercent || 0));
      this.progressFill.fillStyle(BOSS_FILL, 1);
      this.progressFill.fillRoundedRect(x, y, width * percent, height, height / 2);
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
    this.progressFill.fillStyle(PROGRESS_FILL, 1);
    this.progressFill.fillRoundedRect(x + width - fillWidth, y, fillWidth, height, height / 2);

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
