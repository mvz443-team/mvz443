import i18n, { translate } from "../../i18n";
import { commonKey, stageKey } from "../../i18n/keys";
import BackendWS from "../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import CardpileManager from "../managers/combat/CardpileManager";
import MobManager, { ProgressMode, ProgressUpdateEvent } from "../managers/combat/MobManager";
import PlantsManager from "../managers/combat/PlantsManager";
import ResourceManager from "../managers/combat/ResourceManager";
import { PositionManager } from "../managers/view/PositionManager";
import type { Game } from "../scenes/Game";
import { StageDataRecords } from "../utils/loader";
import { UI_CHROME_DEPTH } from "./cardslots";

const BAR_BG = 0x333333;
const PANEL_LINE = 0x111111;
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

function compactTextToFit(text: Phaser.GameObjects.Text, value: string, maxWidth: number, preferred: number, minSize: number) {
  text.setText(value);
  fitText(text, maxWidth, preferred, minSize);
  if (text.width <= maxWidth) {
    return;
  }

  let next = value;
  while (next.length > 2 && text.width > maxWidth) {
    next = `${next.slice(0, -2)}.`;
    text.setText(next);
    fitText(text, maxWidth, preferred, minSize);
  }
}

export class MobileBottomBar {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly moneyText: Phaser.GameObjects.Text;
  private readonly starsContainer: Phaser.GameObjects.Container;
  private readonly starsBg: Phaser.GameObjects.Graphics;
  private readonly progressBg: Phaser.GameObjects.Graphics;
  private readonly progressFill: Phaser.GameObjects.Graphics;
  private readonly flagGraphics: Phaser.GameObjects.Graphics;
  private readonly stageBg: Phaser.GameObjects.Graphics;
  private readonly stageText: Phaser.GameObjects.Text;
  private readonly unsubs: Array<() => void> = [];
  private readonly starObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly bounds: { x: number; y: number; width: number; height: number };
  private readonly goldHeight: number;
  private readonly starsHeight: number;
  private readonly stageHeight: number;
  private readonly progressTop: number;
  private readonly progressHeight: number;
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
    const layout = PositionManager.Instance.getSceneChromeLayout("mobile");
    this.bounds = layout.mobileBottomToolbar;
    this.goldHeight = Math.max(54, this.bounds.height * 0.13);
    this.starsHeight = Math.max(82, this.bounds.height * 0.17);
    this.stageHeight = Math.max(74, this.bounds.height * 0.16);
    this.progressTop = this.goldHeight + this.starsHeight + 10;
    this.progressHeight = Math.max(120, this.bounds.height - this.progressTop - this.stageHeight - 10);

    this.container = this.scene.add.container(this.bounds.x, this.bounds.y).setDepth(UI_CHROME_DEPTH + 1);
    this.bg = this.scene.add.graphics();
    this.container.add(this.bg);
    this.drawBackground();

    const baseFont = Math.max(10, Math.round(this.bounds.width * 0.18));
    this.moneyText = this.scene.add.text(
      this.bounds.width / 2,
      this.goldHeight / 2,
      `${this.scene.params.gold ?? 0} $`,
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${baseFont}px`,
        color: "#ffd700",
        fontStyle: "bold",
        align: "center",
      },
    ).setOrigin(0.5);
    fitText(this.moneyText, this.bounds.width * 0.86, baseFont, 8);
    this.container.add(this.moneyText);

    this.starsContainer = this.scene.add.container(0, this.goldHeight);
    this.starsBg = this.scene.add.graphics();
    this.starsContainer.add(this.starsBg);
    this.container.add(this.starsContainer);

    const starsHit = this.scene.add.zone(0, 0, this.bounds.width, this.starsHeight)
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

    this.stageBg = this.scene.add.graphics();
    this.container.add(this.stageBg);
    this.stageText = this.scene.add.text(
      this.bounds.width / 2,
      this.bounds.height - this.stageHeight / 2,
      "",
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${baseFont}px`,
        color: "#ffffff",
        fontStyle: "bold",
        align: "center",
      },
    ).setOrigin(0.5);
    this.container.add(this.stageText);

    const stageHit = this.scene.add.zone(0, this.bounds.height - this.stageHeight, this.bounds.width, this.stageHeight)
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

  private drawBackground() {
    this.bg.clear();
    this.bg.fillStyle(BAR_BG, 1);
    this.bg.fillRect(0, 0, this.bounds.width, this.bounds.height);
    this.bg.lineStyle(2, PANEL_LINE, 0.55);
    this.bg.strokeRect(0, 0, this.bounds.width, this.bounds.height);
    this.bg.lineBetween(0, this.goldHeight, this.bounds.width, this.goldHeight);
    this.bg.lineBetween(0, this.goldHeight + this.starsHeight, this.bounds.width, this.goldHeight + this.starsHeight);
    this.bg.lineBetween(0, this.bounds.height - this.stageHeight, this.bounds.width, this.bounds.height - this.stageHeight);
  }

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
    compactTextToFit(
      this.stageText,
      label,
      this.bounds.width * 0.84,
      Math.max(10, Math.round(this.bounds.width * 0.16)),
      7,
    );
    this.stageBg.clear();
    this.stageBg.fillStyle(0x2b2b2b, 1);
    this.stageBg.fillRoundedRect(4, this.bounds.height - this.stageHeight + 5, this.bounds.width - 8, this.stageHeight - 10, 5);
    this.stageBg.lineStyle(1, 0x5c5c5c, 1);
    this.stageBg.strokeRoundedRect(4, this.bounds.height - this.stageHeight + 5, this.bounds.width - 8, this.stageHeight - 10, 5);
  };

  private updateStars() {
    for (const object of this.starObjects.splice(0)) {
      object.destroy();
    }

    this.starsBg.clear();
    if (this.starSelected) {
      this.starsBg.lineStyle(2, 0xffee22, 1);
      this.starsBg.strokeRoundedRect(3, 4, this.bounds.width - 6, this.starsHeight - 8, 5);
    }

    const iconSize = Math.min(this.bounds.width * 0.42, this.starsHeight * 0.28);
    const centerX = this.bounds.width / 2;
    if (this.starShards >= 5) {
      const icon = this.scene.add.image(centerX, this.starsHeight * 0.35, "starshards");
      icon.setDisplaySize(iconSize, iconSize);
      const text = this.scene.add.text(centerX, this.starsHeight * 0.72, `x${this.starShards}`, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(9, Math.round(this.bounds.width * 0.16))}px`,
        color: "#ffffff",
        fontStyle: "bold",
      }).setOrigin(0.5);
      fitText(text, this.bounds.width * 0.8, Math.max(9, Math.round(this.bounds.width * 0.16)), 8);
      this.starsContainer.add([icon, text]);
      this.starObjects.push(icon, text);
      return;
    }

    const cols = 2;
    const startY = this.starsHeight * 0.28;
    const gapX = iconSize * 0.88;
    const gapY = iconSize * 0.88;
    for (let i = 0; i < this.starShards; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = centerX + (col - 0.5) * gapX;
      const y = startY + row * gapY;
      const icon = this.scene.add.image(x, y, "starshards");
      icon.setDisplaySize(iconSize, iconSize);
      this.starsContainer.add(icon);
      this.starObjects.push(icon);
    }
  }

  private flashStars() {
    this.starFlashTimer?.remove(false);
    this.starsBg.lineStyle(2, 0xff3c3c, 1);
    this.starsBg.strokeRoundedRect(3, 4, this.bounds.width - 6, this.starsHeight - 8, 5);
    this.starFlashTimer = this.scene.time.delayedCall(450, () => {
      this.starFlashTimer = null;
      this.updateStars();
    });
  }

  private updateProgress() {
    const barWidth = Math.max(8, this.bounds.width * 0.28);
    const x = (this.bounds.width - barWidth) / 2;
    const y = this.progressTop;
    const height = this.progressHeight;
    this.progressBg.clear();
    this.progressFill.clear();
    this.flagGraphics.clear();

    this.progressBg.fillStyle(PROGRESS_BG, 1);
    this.progressBg.fillRoundedRect(x, y, barWidth, height, barWidth / 2);

    if (this.progressState.mode === ProgressMode.Boss) {
      const percent = Math.max(0, Math.min(1, this.progressState.bossHealthPercent || 0));
      this.progressFill.fillStyle(BOSS_FILL, 1);
      this.progressFill.fillRoundedRect(x, y, barWidth, height * percent, barWidth / 2);
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

    const fillHeight = height * Math.max(0, Math.min(1, percent));
    this.progressFill.fillStyle(PROGRESS_FILL, 1);
    this.progressFill.fillRoundedRect(x, y, barWidth, fillHeight, barWidth / 2);

    this.flagGraphics.lineStyle(2, 0xffffff, 1);
    if (maxWaveIndex > 0) {
      for (const flagWave of this.progressState.flagWaves) {
        const flagPercent = Math.max(0, Math.min(1, flagWave / maxWaveIndex));
        const lineY = y + height * flagPercent;
        this.flagGraphics.lineBetween(x - 4, lineY, x + barWidth + 4, lineY);
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
