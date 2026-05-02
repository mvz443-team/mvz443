type MenuControl = {
  container: Phaser.GameObjects.Container;
  width: number;
  height: number;
  destroy: () => void;
};

type MenuOptions = {
  x: number;
  y: number;
  width: number;
  title: string;
  depth: number;
};

type LayoutOptions = {
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
  gap: number;
};

type SliderOptions = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
};

type SwitchOptions = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

type ButtonOptions = {
  text: string;
  normalColor: number;
  hoverColor: number;
  onClick: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class Menu {
  public readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly panelX: number;
  private readonly panelY: number;
  private readonly panelWidth: number;
  private readonly paddingTop: number;
  private readonly paddingBottom: number;
  private readonly contentX: number;
  private readonly contentY: number;
  private readonly contentWidth: number;
  private readonly layout: Layout;
  private readonly controls: MenuControl[] = [];

  constructor(scene: Phaser.Scene, options: MenuOptions, layoutOptions: LayoutOptions) {
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setDepth(options.depth);
    this.container.setVisible(false);
    this.panelX = options.x;
    this.panelY = options.y;
    this.panelWidth = options.width;
    this.paddingTop = layoutOptions.paddingTop;
    this.paddingBottom = layoutOptions.paddingBottom;

    const overlay = scene.add.graphics();
    overlay.fillStyle(0x000000, 0.6);
    overlay.fillRect(0, 0, scene.cameras.main.width, scene.cameras.main.height);
    this.container.add(overlay);

    this.panel = scene.add.graphics();
    this.container.add(this.panel);

    this.titleText = scene.add.text(options.x + options.width / 2, options.y + layoutOptions.paddingTop * 0.58, options.title, {
      fontSize: `${Math.min(scene.scale.displaySize.width / 18, 32)}px`,
      color: "#ecf0f1",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
      align: "center",
    }).setOrigin(0.5);
    this.titleText.setShadow(2, 2, "#2c3e50", 4);
    this.container.add(this.titleText);

    this.contentX = options.x + layoutOptions.paddingX;
    this.contentY = options.y + layoutOptions.paddingTop;
    this.contentWidth = options.width - layoutOptions.paddingX * 2;
    this.layout = new Layout(this.contentX, this.contentY, this.contentWidth, layoutOptions.gap);
    this.redrawPanel();
  }

  private redrawPanel() {
    const height = this.paddingTop + this.layout.getContentHeight() + this.paddingBottom;

    this.panel.clear();
    this.panel.fillStyle(0x2c3e50, 0.95);
    this.panel.fillRoundedRect(this.panelX, this.panelY, this.panelWidth, height, 20);
    this.panel.lineStyle(4, 0xecf0f1, 1);
    this.panel.strokeRoundedRect(this.panelX, this.panelY, this.panelWidth, height, 20);
    this.panel.fillGradientStyle(0xe74c3c, 0xc0392b, 0xe74c3c, 0xc0392b, 1);
    this.panel.fillRoundedRect(this.panelX + 10, this.panelY + 10, this.panelWidth - 20, 8, 4);
  }

  public add(control: MenuControl) {
    this.controls.push(control);
    this.layout.place(control);
    this.container.add(control.container);
    this.redrawPanel();
  }

  public addRow(controls: MenuControl[], gap: number) {
    const row = new RowControl(this.scene, controls, this.contentWidth, gap);
    this.add(row);
  }

  public setTitle(title: string) {
    this.titleText.setText(title);
  }

  public getTitleIconPosition(gap = 24) {
    return {
      x: this.titleText.x + this.titleText.displayWidth / 2 + gap,
      y: this.titleText.y,
    };
  }

  public setDepth(depth: number) {
    this.container.setDepth(depth);
  }

  public show() {
    this.container.setVisible(true);
    this.container.setAlpha(1);
    this.container.setScale(1);
  }

  public hide() {
    this.container.setVisible(false);
    this.container.setAlpha(1);
    this.container.setScale(1);
  }

  public destroy() {
    for (const control of this.controls) {
      control.destroy();
    }
    this.container.destroy();
  }
}

export class Layout {
  private cursorY: number;
  private contentHeight = 0;

  constructor(
    private readonly x: number,
    y: number,
    private readonly width: number,
    private readonly gap: number,
  ) {
    this.cursorY = y;
  }

  public place(control: MenuControl) {
    control.container.setPosition(this.x + (this.width - control.width) / 2, this.cursorY);
    this.cursorY += control.height + this.gap;
    this.contentHeight += control.height + (this.contentHeight > 0 ? this.gap : 0);
  }

  public getContentHeight() {
    return this.contentHeight;
  }
}

export class Slider implements MenuControl {
  public readonly container: Phaser.GameObjects.Container;
  public readonly height = 34;
  private readonly scene: Phaser.Scene;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly thumb: Phaser.GameObjects.Arc;
  private readonly track: Phaser.GameObjects.Rectangle;
  private readonly min: number;
  private readonly max: number;
  private readonly step: number;
  private value: number;
  private dragging = false;

  constructor(scene: Phaser.Scene, public readonly width: number, private readonly options: SliderOptions) {
    this.scene = scene;
    this.min = options.min ?? 0;
    this.max = options.max ?? 1;
    this.step = options.step ?? 0.01;
    this.value = this.normalize(options.value);
    this.container = scene.add.container(0, 0);

    const trackWidth = width * 0.5;
    const trackHeight = 7;
    const trackX = width - trackWidth - 44;
    const centerY = this.height / 2;

    this.labelText = scene.add.text(0, centerY, options.label, {
      fontSize: `${Math.min(scene.scale.displaySize.width / 42, 15)}px`,
      color: "#edf6ff",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
    }).setOrigin(0, 0.5);

    this.valueText = scene.add.text(width, centerY, "", {
      fontSize: `${Math.min(scene.scale.displaySize.width / 48, 13)}px`,
      color: "#d7e8f7",
      fontFamily: "Arial, sans-serif",
    }).setOrigin(1, 0.5);

    this.track = scene.add.rectangle(trackX, centerY, trackWidth, trackHeight, 0x52606d, 0.95)
      .setOrigin(0, 0.5);
    this.fill = scene.add.rectangle(trackX, centerY, trackWidth, trackHeight, 0x00ccff, 1)
      .setOrigin(0, 0.5);
    this.thumb = scene.add.circle(trackX, centerY, 8, 0xf8fbff, 1)
      .setStrokeStyle(2, 0x1b2733, 1)
      .setInteractive({ useHandCursor: true });
    const hitArea = scene.add.rectangle(trackX, centerY, trackWidth, this.height, 0xffffff, 0.001)
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });

    hitArea.on("pointerdown", this.handlePointerDown);
    this.thumb.on("pointerdown", this.handlePointerDown);
    scene.input.on("pointermove", this.handlePointerMove);
    scene.input.on("pointerup", this.handlePointerUp);

    this.container.add([this.labelText, this.track, this.fill, hitArea, this.thumb, this.valueText]);
    this.render();
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer) => {
    this.dragging = true;
    this.setFromPointer(pointer);
  };

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!this.dragging) return;
    this.setFromPointer(pointer);
  };

  private readonly handlePointerUp = () => {
    this.dragging = false;
  };

  private normalize(value: number) {
    const stepped = Math.round(value / this.step) * this.step;
    return clamp(stepped, this.min, this.max);
  }

  private setFromPointer(pointer: Phaser.Input.Pointer) {
    const bounds = this.track.getBounds();
    const ratio = clamp((pointer.x - bounds.left) / bounds.width, 0, 1);
    this.setValue(this.min + (this.max - this.min) * ratio);
    this.options.onChange(this.value);
  }

  private render() {
    const ratio = (this.value - this.min) / (this.max - this.min);
    this.fill.width = Math.max(1, this.track.width * ratio);
    this.thumb.x = this.track.x + this.track.width * ratio;
    this.valueText.setText(`${Math.round(ratio * 100)}%`);
  }

  public setLabel(label: string) {
    this.labelText.setText(label);
  }

  public setValue(value: number) {
    this.value = this.normalize(value);
    this.render();
  }

  public destroy() {
    this.scene.input.off("pointermove", this.handlePointerMove);
    this.scene.input.off("pointerup", this.handlePointerUp);
    this.container.destroy();
  }
}

export class Switch implements MenuControl {
  public readonly container: Phaser.GameObjects.Container;
  public readonly height = 38;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly track: Phaser.GameObjects.Graphics;
  private readonly thumb: Phaser.GameObjects.Arc;
  private checked: boolean;

  constructor(scene: Phaser.Scene, public readonly width: number, private readonly options: SwitchOptions) {
    this.checked = options.checked;
    this.container = scene.add.container(0, 0);

    const switchWidth = 58;
    const switchHeight = 26;
    const switchX = width - switchWidth;
    const centerY = this.height / 2;

    this.labelText = scene.add.text(0, centerY, options.label, {
      fontSize: `${Math.min(scene.scale.displaySize.width / 42, 15)}px`,
      color: "#edf6ff",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
    }).setOrigin(0, 0.5);
    this.valueText = scene.add.text(switchX - 12, centerY, "", {
      fontSize: `${Math.min(scene.scale.displaySize.width / 48, 13)}px`,
      color: "#d7e8f7",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
    }).setOrigin(1, 0.5);
    this.track = scene.add.graphics();
    this.thumb = scene.add.circle(0, centerY, 10, 0xf8fbff, 1)
      .setStrokeStyle(2, 0x1b2733, 1);
    const hitArea = scene.add.rectangle(switchX, centerY, switchWidth, this.height, 0xffffff, 0.001)
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });

    hitArea.on("pointerover", () => this.container.setScale(1.03));
    hitArea.on("pointerout", () => this.container.setScale(1));
    hitArea.on("pointerdown", () => this.container.setScale(0.98));
    hitArea.on("pointerup", () => {
      this.container.setScale(1.03);
      this.setChecked(!this.checked);
      this.options.onChange(this.checked);
    });

    this.container.add([this.labelText, this.valueText, this.track, this.thumb, hitArea]);
    this.render(switchX, centerY, switchWidth, switchHeight);
  }

  private render(switchX = this.width - 58, centerY = this.height / 2, switchWidth = 58, switchHeight = 26) {
    this.track.clear();
    this.track.fillStyle(this.checked ? 0x27ae60 : 0x52606d, 0.98);
    this.track.fillRoundedRect(switchX, centerY - switchHeight / 2, switchWidth, switchHeight, switchHeight / 2);
    this.track.lineStyle(2, this.checked ? 0x9af0bd : 0xaab7c4, 0.95);
    this.track.strokeRoundedRect(switchX, centerY - switchHeight / 2, switchWidth, switchHeight, switchHeight / 2);
    this.thumb.x = switchX + (this.checked ? switchWidth - 13 : 13);
    this.valueText.setText(this.checked ? "2x" : "1x");
  }

  public setLabel(label: string) {
    this.labelText.setText(label);
  }

  public setChecked(checked: boolean) {
    this.checked = checked;
    this.render();
  }

  public destroy() {
    this.container.destroy();
  }
}

export class Button implements MenuControl {
  public readonly container: Phaser.GameObjects.Container;
  public readonly height: number;
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly hitArea: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, public readonly width: number, private readonly options: ButtonOptions) {
    this.height = Math.max(40, Math.min(scene.scale.displaySize.width / 25, 24) + 20);
    this.container = scene.add.container(0, 0);
    this.background = scene.add.graphics();
    this.labelText = scene.add.text(width / 2, this.height / 2, options.text, {
      fontSize: `${Math.min(scene.scale.displaySize.width / 25, 24)}px`,
      color: "#ffffff",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
      align: "center",
    }).setOrigin(0.5);
    this.labelText.setShadow(2, 2, "#2c3e50", 3);
    this.hitArea = scene.add.rectangle(0, 0, width, this.height, 0xffffff, 0.001)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });

    this.hitArea.on("pointerover", () => {
      this.draw(options.hoverColor);
      this.container.setScale(1.04);
    });
    this.hitArea.on("pointerout", () => {
      this.draw(options.normalColor);
      this.container.setScale(1);
    });
    this.hitArea.on("pointerdown", () => this.container.setScale(0.96));
    this.hitArea.on("pointerup", () => {
      this.container.setScale(1.04);
      options.onClick();
    });

    this.container.add([this.background, this.labelText, this.hitArea]);
    this.draw(options.normalColor);
  }

  private draw(color: number) {
    this.background.clear();
    this.background.fillStyle(color, 1);
    this.background.fillRoundedRect(0, 0, this.width, this.height, 8);
  }

  public setText(text: string) {
    this.labelText.setText(text);
  }

  public destroy() {
    this.container.destroy();
  }
}

class RowControl implements MenuControl {
  public readonly container: Phaser.GameObjects.Container;
  public readonly height: number;

  constructor(_scene: Phaser.Scene, private readonly controls: MenuControl[], public readonly width: number, gap: number) {
    this.container = controls[0].container.scene.add.container(0, 0);
    this.height = controls.reduce((maxHeight, control) => Math.max(maxHeight, control.height), 0);

    const totalWidth = controls.reduce((sum, control) => sum + control.width, 0) + gap * Math.max(0, controls.length - 1);
    let x = (width - totalWidth) / 2;
    for (const control of controls) {
      control.container.setPosition(x, (this.height - control.height) / 2);
      this.container.add(control.container);
      x += control.width + gap;
    }
  }

  public destroy() {
    for (const control of this.controls) {
      control.destroy();
    }
    this.container.destroy();
  }
}
