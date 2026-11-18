import DepthHelper from "../utils/helper/DepthHelper";
import i18n, { translate } from "../../i18n";
import BackendWS from "../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../EventBus";
import MobManager, { ProgressMode, ProgressUpdateEvent } from "../managers/combat/MobManager";
import type { Game } from "../scenes/Game";
import { getMobileSideBarLayout } from "./mobileSideBarLayout";
import { StarShardsPanelView } from "./StarShardsPanelView";

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

export class MobileBottomBar {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly starShardsPanel: StarShardsPanelView;
  private readonly progressBg: Phaser.GameObjects.Graphics;
  private readonly progressFill: Phaser.GameObjects.Graphics;
  private readonly flagGraphics: Phaser.GameObjects.Graphics;
  private readonly pauseText: Phaser.GameObjects.Text;
  private readonly unsubs: Array<() => void> = [];
  private readonly layout = getMobileSideBarLayout();
  private progressState: ProgressUpdateEvent = {
    mode: ProgressMode.Normal,
    totalWaves: 99,
    currentWave: 0,
    flagWaves: [],
  };
  constructor(scene: Game) {
    this.scene = scene;
    const bounds = this.layout.bounds;

    this.container = this.scene.add.container(bounds.x, bounds.y).setDepth(DepthHelper.UI.chromeContainer());
    this.bg = this.scene.add.graphics();
    this.container.add(this.bg);
    this.drawBackground();

    this.starShardsPanel = new StarShardsPanelView(
      this.scene,
      bounds.x + this.layout.actionSection.x,
      bounds.y + this.layout.actionSection.y,
      this.getStarsControlWidth(),
      this.layout.actionSection.height,
    );

    this.progressBg = this.scene.add.graphics();
    this.progressFill = this.scene.add.graphics();
    this.flagGraphics = this.scene.add.graphics();
    this.container.add([this.progressBg, this.progressFill, this.flagGraphics]);

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
    this.pauseText.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      this.pauseText.setScale(0.96);
    });
    this.pauseText.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      requestPause();
    });

    this.refreshLabels();
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
    this.starShardsPanel.destroy();
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
    this.unsubs.push(MobManager.Instance.EventBus.on("onProgressUpdate", (progress) => {
      this.progressState = progress;
      this.updateProgress();
    }));

    PhaserEventBus.on(PhaserEvents.BossHealth, this.handleBossHealth);
    PhaserEventBus.on(PhaserEvents.BossDead, this.handleBossDead);
    i18n.on("languageChanged", this.refreshLabels);
  }

  private refreshLabels = () => {
    this.pauseText.setText(translate("game.pause"));
    fitText(this.pauseText, this.layout.actionSection.width * 0.24, Math.max(10, Math.round(this.layout.bounds.width * 0.1)), 8);
  };

  private getStarsControlWidth() {
    return this.layout.actionSection.width * 0.58;
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
    fillProgressRect(this.progressFill, x, y, fillWidth, height, PROGRESS_FILL);

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
