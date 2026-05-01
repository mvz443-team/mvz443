import { translate } from "../../../i18n";
import DepthUtils from "../../../utils/depth";
import BackendWS from "../../../utils/net/sync";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import CombatManager from "../../managers/CombatManager";
import SoundManager from "../../managers/SoundManager";
import { Game } from "../../scenes/Game";

type PauseMenuShowOptions = {
  bluePrintMode?: boolean;
};

type VolumeSlider = {
  container: Phaser.GameObjects.Container;
  setLabel: (label: string) => void;
  setValue: (value: number) => void;
  destroy: () => void;
};

type PauseMenuLayout = {
  centerX: number;
  startY: number;
  menuWidth: number;
  menuHeight: number;
  titleY: number;
};

const clampVolume = (volume: number) => Math.max(0, Math.min(1, volume));

const storeCookie = (key: string, value: number | boolean) => {
  document.cookie = `${key}=${JSON.stringify(value)}; path=/; max-age=31536000`;
};

export class PauseMenu {
  private game: Game;
  private pauseText: Phaser.GameObjects.Text;
  private menuBackground: Phaser.GameObjects.Graphics;
  private menuContainer: Phaser.GameObjects.Container;
  private bluePrintPauseText: Phaser.GameObjects.Text;
  private bluePrintEyeIcon: Phaser.GameObjects.Container;
  private fullMenuEyeIcon: Phaser.GameObjects.Container;
  private soundVolumeSlider: VolumeSlider;
  private bgmVolumeSlider: VolumeSlider;
  private isVisible: boolean = false;
  private isBluePrintMode: boolean = false;

  constructor(game: Game) {
    this.game = game;
    this.createMenu();
    this.createBluePrintPauseText();
  }

  private getMenuLayout(): PauseMenuLayout {
    const centerX = this.game.cameras.main.width / 2;
    const startY = this.game.cameras.main.height * 0.15;
    const isMobile = this.game.params.deviceType === "mobile";
    const menuWidth = Math.min(this.game.scale.displaySize.width * 0.6, 400);
    const menuHeightRatio = isMobile ? 0.8 : 0.6;
    const maxMenuHeight = isMobile ? 480 : 360;
    const bottomSafeArea = 16;
    const availableMenuHeight = this.game.cameras.main.height - startY - bottomSafeArea;
    const menuHeight = Math.min(
      this.game.scale.displaySize.height * menuHeightRatio,
      maxMenuHeight,
      availableMenuHeight
    );

    return {
      centerX,
      startY,
      menuWidth,
      menuHeight,
      titleY: startY + menuHeight * 0.2,
    };
  }

  private createMenu() {
    this.menuContainer = this.game.add.container(0, 0);
    this.menuContainer.setDepth(DepthUtils.getPauseMenuDepth());
    this.menuContainer.setVisible(false);

    const overlay = this.game.add.graphics();
    overlay.fillStyle(0x000000, 0.6);
    overlay.fillRect(0, 0, this.game.cameras.main.width, this.game.cameras.main.height);
    this.menuContainer.add(overlay);

    const { centerX, startY, menuWidth, menuHeight, titleY } = this.getMenuLayout();

    const buttonFontSize = Math.min(this.game.scale.displaySize.width / 25, 24);
    const buttonPaddingY = 10;
    const continueButtonHeightH = buttonFontSize + buttonPaddingY * 2;
    const exitButtonHeightH = continueButtonHeightH;

    const buttonBottomPadding = Math.max(18, menuHeight * 0.08);
    const continueToExitButtonGap = Math.max(10, menuHeight * 0.05);
    const exitButtonCenterY = startY + menuHeight - buttonBottomPadding - exitButtonHeightH / 2;
    const continueButtonCenterY = exitButtonCenterY - exitButtonHeightH / 2 - continueToExitButtonGap - continueButtonHeightH / 2;

    this.menuBackground = this.game.add.graphics();
    this.menuBackground.fillStyle(0x2c3e50, 0.95);
    this.menuBackground.fillRoundedRect(
      centerX - menuWidth / 2,
      startY,
      menuWidth,
      menuHeight,
      20
    );

    this.menuBackground.lineStyle(4, 0xecf0f1, 1);
    this.menuBackground.strokeRoundedRect(
      centerX - menuWidth / 2,
      startY,
      menuWidth,
      menuHeight,
      20
    );

    this.menuBackground.fillGradientStyle(0xe74c3c, 0xc0392b, 0xe74c3c, 0xc0392b, 1);
    this.menuBackground.fillRoundedRect(
      centerX - menuWidth / 2 + 10,
      startY + 10,
      menuWidth - 20,
      8,
      4
    );

    this.menuContainer.add(this.menuBackground);

    this.pauseText = this.game.add.text(
      centerX,
      titleY,
      translate("game.paused"),
      {
        fontSize: `${Math.min(this.game.scale.displaySize.width / 18, 32)}px`,
        color: "#ecf0f1",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        align: "center",
      }
    ).setOrigin(0.5);

    this.pauseText.setShadow(2, 2, "#2c3e50", 4);
    this.menuContainer.add(this.pauseText);

    this.fullMenuEyeIcon = this.createEyeIcon(
      centerX + this.pauseText.width / 2 + 26,
      titleY,
      true,
      () => this.showBluePrintCompact()
    );
    this.fullMenuEyeIcon.setVisible(false);
    this.menuContainer.add(this.fullMenuEyeIcon);

    const sliderWidth = Math.min(menuWidth * 0.72, 300);
    this.soundVolumeSlider = this.createVolumeSlider(
      centerX - sliderWidth / 2,
      startY + menuHeight * 0.36,
      sliderWidth,
      translate("menu.settings_gaming_sound_effects"),
      SoundManager.Instance.getSoundAudioVolume(),
      (volume) => {
        this.game.innerSettings.soundAudioVolume = volume;
        this.game.innerSettings.isSoundAudio = volume > 0;
        SoundManager.Instance.setSoundAudioVolume(volume);
        storeCookie("soundAudioVolume", volume);
        storeCookie("isSoundAudio", volume > 0);
      }
    );
    this.menuContainer.add(this.soundVolumeSlider.container);

    this.bgmVolumeSlider = this.createVolumeSlider(
      centerX - sliderWidth / 2,
      startY + menuHeight * 0.46,
      sliderWidth,
      translate("menu.settings_gaming_background_music"),
      SoundManager.Instance.getBgmVolume(),
      (volume) => {
        this.game.innerSettings.bgmVolume = volume;
        this.game.innerSettings.isBgm = volume > 0;
        SoundManager.Instance.setBgmVolume(volume);
        storeCookie("bgmVolume", volume);
        storeCookie("isBgm", volume > 0);
      }
    );
    this.menuContainer.add(this.bgmVolumeSlider.container);

    this.createButton(
      centerX,
      continueButtonCenterY,
      translate("game.continue"),
      "#27ae60",
      "#2ecc71",
      buttonFontSize,
      buttonPaddingY,
      () => {
        CombatManager.Instance.isPaused = false;
      }
    );

    this.createButton(
      centerX,
      exitButtonCenterY,
      translate("game.exit"),
      "#e74c3c",
      "#c0392b",
      buttonFontSize,
      buttonPaddingY,
      () => {
        CombatManager.Instance.EndGame(false);
        if (!BackendWS.isOnlineMode()) {
          PhaserEventBus.emit(PhaserEvents.RoomGameEnd, { isWin: false });
        }
      }
    );
  }

  private createVolumeSlider(
    x: number,
    y: number,
    width: number,
    label: string,
    initialVolume: number,
    onChange: (volume: number) => void
  ): VolumeSlider {
    const height = 28;
    const trackWidth = width * 0.52;
    const trackHeight = 7;
    const trackX = width - trackWidth - 42;
    const trackY = height / 2;
    let volume = clampVolume(initialVolume);
    let dragging = false;

    const container = this.game.add.container(x, y);
    const labelText = this.game.add.text(0, trackY, label, {
      fontSize: `${Math.min(this.game.scale.displaySize.width / 42, 15)}px`,
      color: "#edf6ff",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
    }).setOrigin(0, 0.5);

    const valueText = this.game.add.text(width, trackY, "", {
      fontSize: `${Math.min(this.game.scale.displaySize.width / 48, 13)}px`,
      color: "#d7e8f7",
      fontFamily: "Arial, sans-serif",
    }).setOrigin(1, 0.5);

    const track = this.game.add.rectangle(trackX, trackY, trackWidth, trackHeight, 0x52606d, 0.95)
      .setOrigin(0, 0.5);
    const fill = this.game.add.rectangle(trackX, trackY, trackWidth * volume, trackHeight, 0x00ccff, 1)
      .setOrigin(0, 0.5);
    const thumb = this.game.add.circle(trackX + trackWidth * volume, trackY, 8, 0xf8fbff, 1)
      .setStrokeStyle(2, 0x1b2733, 1)
      .setInteractive({ useHandCursor: true });
    const hitArea = this.game.add.rectangle(trackX, trackY, trackWidth, height, 0xffffff, 0.001)
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });

    const render = () => {
      fill.width = Math.max(1, trackWidth * volume);
      thumb.x = trackX + trackWidth * volume;
      valueText.setText(`${Math.round(volume * 100)}%`);
    };

    const setFromPointer = (pointer: Phaser.Input.Pointer) => {
      const localX = pointer.x - x;
      volume = clampVolume((localX - trackX) / trackWidth);
      render();
      onChange(volume);
    };

    hitArea.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      dragging = true;
      setFromPointer(pointer);
    });
    thumb.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      dragging = true;
      setFromPointer(pointer);
    });

    const handlePointerMove = (pointer: Phaser.Input.Pointer) => {
      if (!dragging) return;
      setFromPointer(pointer);
    };
    const handlePointerUp = () => {
      dragging = false;
    };
    this.game.input.on("pointermove", handlePointerMove);
    this.game.input.on("pointerup", handlePointerUp);

    container.add([labelText, track, fill, hitArea, thumb, valueText]);
    render();

    return {
      container,
      setLabel(nextLabel: string) {
        labelText.setText(nextLabel);
      },
      setValue(nextValue: number) {
        volume = clampVolume(nextValue);
        render();
      },
      destroy: () => {
        this.game.input.off("pointermove", handlePointerMove);
        this.game.input.off("pointerup", handlePointerUp);
        container.destroy();
      },
    };
  }

  private createBluePrintPauseText() {
    const { centerX, titleY } = this.getMenuLayout();

    this.bluePrintPauseText = this.game.add.text(
      centerX,
      titleY,
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
      .setDepth(DepthUtils.getPauseMenuDepth())
      .setAlpha(0.45)
      .setVisible(false)
      .setShadow(2, 2, "#1f2937", 6);

    this.bluePrintEyeIcon = this.createEyeIcon(
      centerX + this.bluePrintPauseText.width / 2 + 24,
      titleY,
      false,
      () => this.showBluePrintFullMenu()
    );
    this.bluePrintEyeIcon
      .setDepth(DepthUtils.getPauseMenuDepth())
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
    this.menuContainer.setVisible(false);
    this.fullMenuEyeIcon.setVisible(false);
    this.bluePrintPauseText.setVisible(true);
    this.bluePrintEyeIcon.setVisible(true);
  }

  private showBluePrintFullMenu() {
    if (!this.isVisible || !this.isBluePrintMode) return;
    this.bluePrintPauseText.setVisible(false);
    this.bluePrintEyeIcon.setVisible(false);
    this.menuContainer.setVisible(true);
    this.menuContainer.setAlpha(1);
    this.menuContainer.setScale(1);
    this.fullMenuEyeIcon.setVisible(true);
  }

  private createButton(
    x: number,
    y: number,
    text: string,
    normalColor: string,
    hoverColor: string,
    fontSize: number,
    paddingY: number,
    onClick: () => void
  ): Phaser.GameObjects.Text {
    const button = this.game.add.text(x, y, text, {
      fontSize: `${fontSize}px`,
      color: "#ffffff",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
      align: "center",
      backgroundColor: normalColor,
      padding: { x: 20, y: paddingY },
    }).setOrigin(0.5);

    button.setShadow(2, 2, "#2c3e50", 3);
    button.setInteractive({ useHandCursor: true });

    button.on("pointerover", () => {
      button.setStyle({ backgroundColor: hoverColor });
      button.setScale(1.05);
      this.game.tweens.add({
        targets: button,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 100,
        ease: "Power2",
      });
    });

    button.on("pointerout", () => {
      button.setStyle({ backgroundColor: normalColor });
      this.game.tweens.add({
        targets: button,
        scaleX: 1,
        scaleY: 1,
        duration: 100,
        ease: "Power2",
      });
    });

    button.on("pointerdown", () => {
      button.setScale(0.95);
    });

    button.on("pointerup", () => {
      button.setScale(1.05);
      onClick();
    });

    this.menuContainer.add(button);
    return button;
  }

  private addDecorativeElements(
    centerX: number,
    pauseIconTopY: number,
    pauseIconWidth: number,
    pauseIconHeight: number
  ) {
    const pauseIcon = this.game.add.graphics();
    pauseIcon.fillStyle(0xecf0f1, 0.8);

    pauseIcon.fillRect(
      centerX - pauseIconWidth * 0.6,
      pauseIconTopY,
      pauseIconWidth * 0.3,
      pauseIconHeight
    );
    pauseIcon.fillRect(
      centerX + pauseIconWidth * 0.3,
      pauseIconTopY,
      pauseIconWidth * 0.3,
      pauseIconHeight
    );

    this.menuContainer.add(pauseIcon);

    this.game.tweens.add({
      targets: pauseIcon,
      alpha: 0.5,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public show(options: PauseMenuShowOptions = {}) {
    const { bluePrintMode = false } = options;

    this.isVisible = true;
    this.isBluePrintMode = bluePrintMode;

    this.menuContainer.setDepth(DepthUtils.getPauseMenuDepth());
    this.bluePrintPauseText.setDepth(DepthUtils.getPauseMenuDepth());
    this.refreshAudioSliders();

    if (bluePrintMode) {
      this.showBluePrintCompact();
      return;
    }

    this.bluePrintPauseText.setVisible(false);
    this.bluePrintEyeIcon.setVisible(false);
    this.fullMenuEyeIcon.setVisible(false);
    this.menuContainer.setVisible(true);
    this.menuContainer.setAlpha(1);
    this.menuContainer.setScale(1);
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

    if (!this.menuContainer.visible) {
      return;
    }

    this.game.tweens.add({
      targets: this.menuContainer,
      alpha: 0,
      scaleX: 0.8,
      scaleY: 0.8,
      duration: 200,
      ease: "Back.easeIn",
      onComplete: () => {
        this.menuContainer.setVisible(false);
        this.menuContainer.setAlpha(1);
        this.menuContainer.setScale(1);
      },
    });
  }

  public isBlockingInput(): boolean {
    return this.isVisible && this.menuContainer.visible;
  }

  public destroy() {
    this.soundVolumeSlider?.destroy();
    this.bgmVolumeSlider?.destroy();
    this.menuContainer?.destroy();
    this.bluePrintPauseText?.destroy();
    this.bluePrintEyeIcon?.destroy();
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  private refreshAudioSliders() {
    this.soundVolumeSlider?.setLabel(translate("menu.settings_gaming_sound_effects"));
    this.bgmVolumeSlider?.setLabel(translate("menu.settings_gaming_background_music"));
    this.soundVolumeSlider?.setValue(SoundManager.Instance.getSoundAudioVolume());
    this.bgmVolumeSlider?.setValue(SoundManager.Instance.getBgmVolume());
  }
}

