import { translate } from "../../../i18n";
import DepthHelper from "../../utils/helper/DepthHelper";
import BackendWS from "../../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import CombatManager from "../../managers/CombatManager";
import SoundManager from "../../managers/SoundManager";
import { Game } from "../../scenes/Game";
import { Button, Menu, Slider, Switch } from "./Menu";

type PauseMenuShowOptions = {
  bluePrintMode?: boolean;
};

type PauseMenuLayout = {
  centerX: number;
  startY: number;
  menuWidth: number;
  contentWidth: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
  gap: number;
};

const storeCookie = (key: string, value: number | boolean) => {
  document.cookie = `${key}=${JSON.stringify(value)}; path=/; max-age=31536000`;
};

export class PauseMenu {
  private readonly game: Game;
  private menu: Menu;
  private bluePrintPauseText: Phaser.GameObjects.Text;
  private bluePrintEyeIcon: Phaser.GameObjects.Container;
  private fullMenuEyeIcon: Phaser.GameObjects.Container;
  private soundVolumeSlider: Slider;
  private bgmVolumeSlider: Slider;
  private speedSwitch: Switch;
  private continueButton: Button;
  private exitButton: Button;
  private isVisible = false;
  private isBluePrintMode = false;

  constructor(game: Game) {
    this.game = game;
    const layout = this.getMenuLayout();
    this.createMenu(layout);
    this.createBluePrintPauseText(layout);
  }

  private getMenuLayout(): PauseMenuLayout {
    const centerX = this.game.cameras.main.width / 2;
    const startY = this.game.cameras.main.height * 0.15;
    const isMobile = this.game.params.deviceType === "mobile";
    const menuWidth = Math.min(this.game.scale.displaySize.width * (isMobile ? 0.78 : 0.6), isMobile ? 430 : 400);
    const paddingX = Math.max(28, menuWidth * 0.12);
    const paddingTop = isMobile ? 104 : 96;
    const paddingBottom = isMobile ? 30 : 28;
    const contentWidth = menuWidth - paddingX * 2;
    const gap = isMobile ? 18 : 16;

    return {
      centerX,
      startY,
      menuWidth,
      contentWidth,
      paddingX,
      paddingTop,
      paddingBottom,
      gap,
    };
  }

  private createMenu(layout: PauseMenuLayout) {
    this.menu = new Menu(
      this.game,
      {
        x: layout.centerX - layout.menuWidth / 2,
        y: layout.startY,
        width: layout.menuWidth,
        title: translate("game.paused"),
        depth: DepthHelper.UI.pauseMenu(),
      },
      {
        paddingX: layout.paddingX,
        paddingTop: layout.paddingTop,
        paddingBottom: layout.paddingBottom,
        gap: layout.gap,
      }
    );

    const eyePosition = this.menu.getTitleIconPosition();
    this.fullMenuEyeIcon = this.createEyeIcon(
      eyePosition.x,
      eyePosition.y,
      true,
      () => this.showBluePrintCompact()
    );
    this.fullMenuEyeIcon.setVisible(false);
    this.menu.container.add(this.fullMenuEyeIcon);

    this.soundVolumeSlider = new Slider(this.game, layout.contentWidth, {
      label: translate("menu.settings_gaming_sound_effects"),
      value: SoundManager.Instance.getSoundAudioVolume(),
      min: 0,
      max: 1,
      step: 0.01,
      onChange: (volume) => {
        this.game.innerSettings.soundAudioVolume = volume;
        this.game.innerSettings.isSoundAudio = volume > 0;
        SoundManager.Instance.setSoundAudioVolume(volume);
        storeCookie("soundAudioVolume", volume);
        storeCookie("isSoundAudio", volume > 0);
      },
    });
    this.menu.add(this.soundVolumeSlider);

    this.bgmVolumeSlider = new Slider(this.game, layout.contentWidth, {
      label: translate("menu.settings_gaming_background_music"),
      value: SoundManager.Instance.getBgmVolume(),
      min: 0,
      max: 1,
      step: 0.01,
      onChange: (volume) => {
        this.game.innerSettings.bgmVolume = volume;
        this.game.innerSettings.isBgm = volume > 0;
        SoundManager.Instance.setBgmVolume(volume);
        storeCookie("bgmVolume", volume);
        storeCookie("isBgm", volume > 0);
      },
    });
    this.menu.add(this.bgmVolumeSlider);

    this.speedSwitch = new Switch(this.game, layout.contentWidth, {
      label: translate("game.speedUp"),
      checked: this.game.time.timeScale > 1,
      onChange: (checked) => {
        this.setGameSpeed(checked ? 2 : 1);
      },
    });
    this.menu.add(this.speedSwitch);

    const buttonGap = Math.max(12, layout.contentWidth * 0.08);
    const buttonWidth = (layout.contentWidth - buttonGap) / 2;
    this.continueButton = new Button(this.game, buttonWidth, {
      text: translate("game.continue"),
      normalColor: 0x27ae60,
      hoverColor: 0x2ecc71,
      onClick: () => {
        CombatManager.Instance.isPaused = false;
      },
    });
    this.exitButton = new Button(this.game, buttonWidth, {
      text: translate("game.exit"),
      normalColor: 0xe74c3c,
      hoverColor: 0xc0392b,
      onClick: () => {
        CombatManager.Instance.EndGame(false);
        if (!BackendWS.isOnlineMode()) {
          PhaserEventBus.emit(PhaserEvents.RoomGameEnd, { isWin: false });
        }
      },
    });
    this.menu.addRow([this.continueButton, this.exitButton], buttonGap);
  }

  private setGameSpeed(timeScale: 1 | 2) {
    if (BackendWS.isOnlineMode()) {
      this.speedSwitch?.setChecked(false);
      return;
    }

    this.game.time.timeScale = timeScale;
    this.speedSwitch?.setChecked(timeScale > 1);
    PhaserEventBus.emit(PhaserEvents.TimespeedChanged, { timeScale });
  }

  private createBluePrintPauseText(layout: PauseMenuLayout) {
    this.bluePrintPauseText = this.game.add.text(
      layout.centerX,
      this.menu.getTitleIconPosition().y,
      translate("game.paused"),
      {
        fontSize: `${Math.min(this.game.scale.displaySize.width / 18, 30)}px`,
        color: "#f4f7fb",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        align: "center",
      }
    ).setOrigin(0.5);

    this.bluePrintPauseText
      .setDepth(DepthHelper.UI.pauseMenu())
      .setAlpha(0.45)
      .setVisible(false)
      .setShadow(2, 2, "#1f2937", 6);

    const eyePosition = this.menu.getTitleIconPosition();
    this.bluePrintEyeIcon = this.createEyeIcon(
      eyePosition.x,
      eyePosition.y,
      false,
      () => this.showBluePrintFullMenu()
    );
    this.bluePrintEyeIcon
      .setDepth(DepthHelper.UI.pauseMenu())
      .setAlpha(0.7)
      .setVisible(false);
  }

  private createEyeIcon(
    x: number,
    y: number,
    isOpen: boolean,
    onClick: () => void
  ) {
    const icon = this.game.add.container(x, y);
    const hitArea = this.game.add.rectangle(0, 0, 34, 28, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true });
    const eye = this.game.add.graphics();

    eye.lineStyle(2, 0xecf0f1, 0.95);
    eye.strokeEllipse(0, 0, 24, 13);

    if (isOpen) {
      eye.fillStyle(0xecf0f1, 0.95);
      eye.fillCircle(0, 0, 4);
      eye.fillStyle(0x2c3e50, 1);
      eye.fillCircle(0, 0, 2);
    } else {
      eye.lineStyle(3, 0xecf0f1, 0.95);
      eye.lineBetween(-12, 9, 12, -9);
    }

    hitArea.on("pointerover", () => {
      icon.setScale(1.12);
      icon.setAlpha(1);
    });
    hitArea.on("pointerout", () => {
      icon.setScale(1);
      icon.setAlpha(isOpen ? 1 : 0.7);
    });
    hitArea.on("pointerdown", () => {
      icon.setScale(0.95);
    });
    hitArea.on("pointerup", () => {
      icon.setScale(1.12);
      onClick();
    });

    icon.add([hitArea, eye]);
    return icon;
  }

  private showBluePrintCompact() {
    if (!this.isVisible || !this.isBluePrintMode) return;
    this.menu.hide();
    this.fullMenuEyeIcon.setVisible(false);
    this.bluePrintPauseText.setVisible(true);
    this.bluePrintEyeIcon.setVisible(true);
  }

  private showBluePrintFullMenu() {
    if (!this.isVisible || !this.isBluePrintMode) return;
    this.bluePrintPauseText.setVisible(false);
    this.bluePrintEyeIcon.setVisible(false);
    this.menu.show();
    this.fullMenuEyeIcon.setVisible(true);
  }

  public show(options: PauseMenuShowOptions = {}) {
    const { bluePrintMode = false } = options;

    this.isVisible = true;
    this.isBluePrintMode = bluePrintMode;

    this.menu.setDepth(DepthHelper.UI.pauseMenu());
    this.bluePrintPauseText.setDepth(DepthHelper.UI.pauseMenu());
    this.refreshControls();

    if (bluePrintMode) {
      this.showBluePrintCompact();
      return;
    }

    this.bluePrintPauseText.setVisible(false);
    this.bluePrintEyeIcon.setVisible(false);
    this.fullMenuEyeIcon.setVisible(false);
    this.menu.show();
  }

  public hide() {
    this.bluePrintPauseText.setVisible(false);
    this.bluePrintEyeIcon.setVisible(false);
    this.fullMenuEyeIcon.setVisible(false);

    if (!this.isVisible) {
      return;
    }

    this.isVisible = false;
    this.isBluePrintMode = false;
    this.menu.hide();
  }

  public isBlockingInput(): boolean {
    return this.isVisible && this.menu.container.visible;
  }

  public destroy() {
    this.menu?.destroy();
    this.bluePrintPauseText?.destroy();
    this.bluePrintEyeIcon?.destroy();
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  private refreshControls() {
    this.menu?.setTitle(translate("game.paused"));
    this.soundVolumeSlider?.setLabel(translate("menu.settings_gaming_sound_effects"));
    this.bgmVolumeSlider?.setLabel(translate("menu.settings_gaming_background_music"));
    this.speedSwitch?.setLabel(translate("game.speedUp"));
    this.continueButton?.setText(translate("game.continue"));
    this.exitButton?.setText(translate("game.exit"));
    this.soundVolumeSlider?.setValue(SoundManager.Instance.getSoundAudioVolume());
    this.bgmVolumeSlider?.setValue(SoundManager.Instance.getBgmVolume());
    this.speedSwitch?.setChecked(this.game.time.timeScale > 1);
    this.alignEyeIcons();
  }

  private alignEyeIcons() {
    const eyePosition = this.menu.getTitleIconPosition();
    this.fullMenuEyeIcon?.setPosition(eyePosition.x, eyePosition.y);
    this.bluePrintEyeIcon?.setPosition(eyePosition.x, eyePosition.y);
    this.bluePrintPauseText?.setPosition(this.getMenuLayout().centerX, eyePosition.y);
  }
}
