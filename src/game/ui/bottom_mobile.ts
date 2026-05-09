import DepthHelper from "../utils/helper/DepthHelper";
import i18n, { translate } from "../../i18n";
import BackendWS from "../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import CardpileManager from "../managers/combat/CardpileManager";
import MobManager, { ProgressMode, ProgressUpdateEvent } from "../managers/combat/MobManager";
import PlantsManager from "../managers/combat/PlantsManager";
import ResourceManager from "../managers/combat/ResourceManager";
import type { Game } from "../scenes/Game";
import { UI_CHROME_DEPTH } from "./cardslots";
import { getMobileSideBarLayout } from "./mobileSideBarLayout";

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

export class MobileBottomBar {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly starsContainer: Phaser.GameObjects.Container;
  private readonly starsBg: Phaser.GameObjects.Graphics;
  private readonly progressBg: Phaser.GameObjects.Graphics;
  private readonly progressFill: Phaser.GameObjects.Graphics;
  private readonly flagGraphics: Phaser.GameObjects.Graphics;
  private readonly starCountText: Phaser.GameObjects.Text;
  private readonly pauseText: Phaser.GameObjects.Text;
  private readonly unsubs: Array<() => void> = [];
  private readonly starObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly layout = getMobileSideBarLayout();
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
    const bounds = this.layout.bounds;

    this.container = this.scene.add.container(bounds.x, bounds.y).setDepth(DepthHelper.UI.chromeContainer());
    this.bg = this.scene.add.graphics();
    this.container.add(this.bg);
    this.drawBackground();

    this.starsContainer = this.scene.add.container(this.layout.actionSection.x, this.layout.actionSection.y);
    this.starsBg = this.scene.add.graphics();
    this.starsContainer.add(this.starsBg);
    this.container.add(this.starsContainer);

    const starsHit = this.scene.add.zone(0, 0, this.getStarsControlWidth(), this.layout.actionSection.height)
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

    this.starCountText = this.scene.add.text(
      0,
      0,
      "X0",
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(10, Math.round(bounds.width * 0.11))}px`,
        color: "#ffffff",
        fontStyle: "bold",
        align: "center",
      },
    ).setOrigin(0.5);
    this.starsContainer.add(this.starCountText);

    this.pauseText = this.scene.add.text(
      this.layout.actionSection.width * 0.82,
      this.layout.actionSection.y + this.layout.actionSection.height / 2,
      translate("game.pause"),
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(10, Math.round(bounds.width * 0.1))}px`,
        color: "#ffffff",
        fontStyle: "bold",
        backgroundColor: "#3f5164",
        padding: { x: 8, y: 4 },
      },
    ).setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.pauseText.setShadow(2, 2, "#18212b", 4);
    this.container.add(this.pauseText);

    this.pauseText.on("pointerover", () => {
      if (!BackendWS.isOnlineMode()) {
        this.pauseText.setStyle({ backgroundColor: "#52687f" });
        this.pauseText.setScale(1.04);
      }
    });
    this.pauseText.on("pointerout", () => {
      this.pauseText.setStyle({ backgroundColor: "#3f5164" });
      this.pauseText.setScale(1);
    });
    this.pauseText.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      if (!BackendWS.isOnlineMode()) {
        this.pauseText.setScale(0.96);
      }
    });
    this.pauseText.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      if (!BackendWS.isOnlineMode()) {
        PhaserEventBus.emit(PhaserEvents.TogglePause);
      }
    });

    this.refreshLabels();
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
    i18n.off("languageChanged", this.refreshLabels);
    this.starFlashTimer?.remove(false);
    this.container.destroy(true);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  };

  private drawBackground() {
    const bounds = this.layout.bounds;
    this.bg.clear();
    this.bg.fillStyle(BAR_BG, 1);
    this.bg.fillRect(0, 0, bounds.width, bounds.height);
    this.bg.lineStyle(2, PANEL_LINE, 0.55);
    this.bg.strokeRect(0, 0, bounds.width, bounds.height);

    for (const section of [this.layout.progressSection, this.layout.actionSection]) {
      this.bg.lineBetween(0, section.y, bounds.width, section.y);
    }
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
    i18n.on("languageChanged", this.refreshLabels);
  }

  private handleStarClick() {
    if (this.starShards <= 0) {
      PlantsManager.Instance.EventBus.emit("onStarshardsInsufficient");
      return;
    }
    CardpileManager.Instance.ClickStarShards();
  }

  private refreshLabels = () => {
    this.pauseText.setText(translate("game.pause"));
    fitText(this.pauseText, this.layout.actionSection.width * 0.24, Math.max(10, Math.round(this.layout.bounds.width * 0.1)), 8);
    this.updateStars();
  };

  private getStarsControlWidth() {
    return this.layout.actionSection.width * 0.58;
  }

  private updateStars() {
    for (const object of this.starObjects.splice(0)) {
      object.destroy();
    }

    const width = this.getStarsControlWidth();
    const height = this.layout.actionSection.height;
    this.starsBg.clear();
    if (this.starSelected) {
      this.starsBg.lineStyle(2, 0xffee22, 1);
      this.starsBg.strokeRoundedRect(4, 4, width - 8, height - 8, 5);
    }

    const iconSize = Math.min(height * 0.58, width * 0.26);
    const centerY = height / 2;
    const icon = this.scene.add.image(width * 0.35, centerY, "starshards");
    icon.setDisplaySize(iconSize, iconSize);
    this.starCountText
      .setText(`X${this.starShards}`)
      .setPosition(width * 0.55, centerY);
    fitText(this.starCountText, width * 0.36, Math.max(10, Math.round(height * 0.34)), 8);
    this.starsContainer.add(icon);
    this.starObjects.push(icon);
  }

  private flashStars() {
    this.starFlashTimer?.remove(false);
    this.starsBg.lineStyle(2, 0xff3c3c, 1);
    this.starsBg.strokeRoundedRect(4, 4, this.getStarsControlWidth() - 8, this.layout.actionSection.height - 8, 5);
    this.starFlashTimer = this.scene.time.delayedCall(450, () => {
      this.starFlashTimer = null;
      this.updateStars();
    });
  }

  private updateProgress() {
    const section = this.layout.progressSection;
    const pad = Math.max(8, this.layout.padding * 2);
    const x = section.x + pad;
    const width = Math.max(8, section.width - pad * 2);
    const height = this.layout.progressBarHeight;
    const y = section.y + (section.height - height) / 2;
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
    this.progressFill.fillRoundedRect(x, y, fillWidth, height, height / 2);

    this.flagGraphics.lineStyle(2, 0xffffff, 1);
    if (maxWaveIndex > 0) {
      for (const flagWave of this.progressState.flagWaves) {
        const flagPercent = Math.max(0, Math.min(1, flagWave / maxWaveIndex));
        const lineX = x + width * flagPercent;
        this.flagGraphics.lineBetween(lineX, y - 3, lineX, y + height + 3);
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
