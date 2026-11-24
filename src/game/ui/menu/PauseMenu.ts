import { translate } from "../../../i18n";
import DepthHelper from "../../utils/helper/DepthHelper";
import BackendWS from "../../../utils/net/sync";
import { showConfirm } from "../../../utils/uiDialog";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import CombatManager from "../../managers/CombatManager";
import SoundManager from "../../managers/SoundManager";
import { Game } from "../../scenes/Game";
import { Button, Menu, Slider, Switch } from "./Menu";

type PauseMenuShowOptions = {
  bluePrintMode?: boolean;
  /** 联机：只显示菜单供查看/设置音量与退出，不暂停模拟。 */
  onlineMode?: boolean;
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
  private noticeText: Phaser.GameObjects.Text;
  private continueButton: Button;
  private exitButton: Button;
  private isVisible = false;
  private isBluePrintMode = false;
  private isOnlineMode = false;

  constructor(game: Game) {
    this.game = game;
    const layout = this.getMenuLayout();
    this.createMenu(layout);
    this.createBluePrintPauseText(layout);
  }

  private getMenuLayout(): PauseMenuLayout {
    // 旧对局残留的全局事件可能调到已 DESTROY 的场景，此时 cameras.main 为空。
    const mainCamera = this.game?.cameras?.main;
    if (!mainCamera) {
      return {
        centerX: 0,
        startY: 0,
        menuWidth: 400,
        contentWidth: 400 - 96,
        paddingX: 48,
        paddingTop: 96,
        paddingBottom: 28,
        gap: 16,
      };
    }
    const centerX = mainCamera.width / 2;
    const startY = mainCamera.height * 0.15;
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

    // 联机提示：仅说明状态，不参与交互；单机时隐藏。
    this.noticeText = this.game.add.text(
      layout.centerX,
      layout.startY + layout.paddingTop + 3 * (38 + layout.gap),
      translate("game.online_pause_notice"),
      {
        fontSize: `${Math.min(this.game.scale.displaySize.width / 50, 13)}px`,
        color: "#ffcc66",
        fontFamily: "Arial, sans-serif",
        wordWrap: { width: layout.contentWidth },
        align: "center",
      }
    ).setOrigin(0.5, 0).setDepth(DepthHelper.UI.pauseMenu());
    this.noticeText.setVisible(false);
    this.menu.container.add(this.noticeText);

    const buttonGap = Math.max(12, layout.contentWidth * 0.08);
    const buttonWidth = (layout.contentWidth - buttonGap) / 2;
    this.continueButton = new Button(this.game, buttonWidth, {
      text: translate("game.continue"),
      normalColor: 0x27ae60,
      hoverColor: 0x2ecc71,
      onClick: () => {
        if (this.isOnlineMode) {
          // 联机不暂停模拟，关闭菜单即可。
          this.hide();
          return;
        }
        CombatManager.Instance.isPaused = false;
      },
    });
    this.exitButton = new Button(this.game, buttonWidth, {
      text: translate("game.exit"),
      normalColor: 0xe74c3c,
      hoverColor: 0xc0392b,
      onClick: () => { void this.handleExit(); },
    });
    this.menu.addRow([this.continueButton, this.exitButton], buttonGap);
  }

  private setGameSpeed(timeScale: 1 | 2) {
    // 联机倍速锁定：即使通过快捷键/调试钩子绕过 UI 也不能改变速度。
    if (BackendWS.isOnlineMode() && !CombatManager.Instance.isDesyncOffline()) {
      this.speedSwitch?.setChecked(false);
      this.game.time.timeScale = 1;
      return;
    }

    this.game.time.timeScale = timeScale;
    this.speedSwitch?.setChecked(timeScale > 1);
    PhaserEventBus.emit(PhaserEvents.TimespeedChanged, { timeScale });
  }

  /** 二次确认退出：联机会取消房间且不可重连，单机仅确认退出。 */
  private async handleExit() {
    const online = BackendWS.isOnlineMode();
    const confirmed = await showConfirm(
      translate(online ? "game.exit_confirm_online" : "game.exit_confirm_offline"),
      {
        title: translate("game.exit_confirm_title"),
        confirmText: translate("game.exit_confirm"),
        cancelText: translate("game.exit_cancel"),
      }
    );
    if (!confirmed) {
      return;
    }
    // 必须在 App 销毁 Phaser / Reset 管理器之前导出，否则拿不到完整战斗状态。
    CombatManager.Instance.exportNetDebugLog("client-exit");
    // 隐藏菜单，交由 App 层执行“永久离房 + 回主菜单”；
    // 单机也走同一路径，仅关闭 mock 房间，不进入结算页。
    this.hide();
    PhaserEventBus.emit(PhaserEvents.RequestExitGame, { online });
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
    // 全局事件总线是跨对局单例；旧对局若未及时退订，这里会被调到已销毁场景。
    if (!this.game?.cameras?.main) return;
    const { bluePrintMode = false, onlineMode = false } = options;

    this.isVisible = true;
    this.isBluePrintMode = bluePrintMode;
    this.isOnlineMode = onlineMode;

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
    this.isOnlineMode = false;
    this.menu.hide();
  }

  public isBlockingInput(): boolean {
    return this.isVisible && this.menu.container.visible;
  }

  public destroy() {
    this.menu?.destroy();
    this.bluePrintPauseText?.destroy();
    this.bluePrintEyeIcon?.destroy();
    this.noticeText?.destroy();
  }

  /** 走真实的二次确认退出路径，供 E2E 触发（与点击“退出游戏”一致）。 */
  public requestExit() {
    void this.handleExit();
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
    // 联机：强制 1x 并灰显倍速开关，仍允许尝试点击但不会生效。
    if (this.isOnlineMode) {
      this.game.time.timeScale = 1;
      this.speedSwitch?.setChecked(false);
    } else {
      // 快捷键 T 直接改时钟，不经过菜单；打开菜单时必须回读当前倍速，
      // 否则开关会停留在创建时的 1x，与实际运行速度不一致。
      this.speedSwitch?.setChecked(this.game.time.timeScale > 1);
    }
    this.speedSwitch?.setEnabled(!this.isOnlineMode);
    this.noticeText?.setText(translate("game.online_pause_notice"));
    this.noticeText?.setVisible(this.isOnlineMode);
    this.alignEyeIcons();
  }

  private alignEyeIcons() {
    const eyePosition = this.menu.getTitleIconPosition();
    this.fullMenuEyeIcon?.setPosition(eyePosition.x, eyePosition.y);
    this.bluePrintEyeIcon?.setPosition(eyePosition.x, eyePosition.y);
    this.bluePrintPauseText?.setPosition(this.getMenuLayout().centerX, eyePosition.y);
  }
}
