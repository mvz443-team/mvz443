import type { Game } from "../../scenes/Game";
import DepthHelper from "../../utils/helper/DepthHelper";
import { PositionManager } from "../view/PositionManager";
import { BaseManager } from "../BaseManager";
import CardpileManager from "./CardpileManager";
import { EventBus } from "../../../utils/eventBus";
import CombatManager from "../CombatManager";
import { PlantLibrary } from "../library/PlantLibrary";
import PlantsManager from "./PlantsManager";
import PlantHelper from "../../utils/helper/PlantHelper";
import type { PlantEntity } from "../../models/entities/PlantEntity";

type CursorManagerEvent = {
  // cursor只管有在某个格子有‘尝试种植’事件发生，具体种植什么 或 是否种植成功 由其他mangager负责
  onAttemptPlant: (col: number, row: number) => void;
  onAttemptUseStarShards: (col: number, row: number, aspect: 'up' | 'down') => void;
  onAttemptRemovePlant: (col: number, row: number, aspect: 'up' | 'down') => void;
}

export default class CursorManager extends BaseManager {
  private static _instance: CursorManager;
  protected scene: Game | null = null;

  EventBus: EventBus<CursorManagerEvent>;

  starSprite: Phaser.GameObjects.Sprite | null = null;
  pickaxeSprite: Phaser.GameObjects.Sprite | null = null;

  private highlightSprite: Phaser.GameObjects.Sprite | null = null;
  private highlightTween: Phaser.Tweens.Tween | null = null;

  /** 星之碎片：悬浮目标植物的白色发光 + 边框。 */
  private starGlowSprite: Phaser.GameObjects.Sprite | null = null;
  private starBorder: Phaser.GameObjects.Rectangle | null = null;
  private starGlowTween: Phaser.Tweens.Tween | null = null;
  private starPrevCol = -1;
  private starPrevRow = -1;
  private starPrevAspect: 'up' | 'down' = 'up';

  prevCol: number = -1;
  prevRow: number = -1;
  prevMovementTime = 0;
  UPDATE_INTERVAL = 50;
  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer) => {
    this.onMouseMoveEvent(pointer);
  };
  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.leftButtonReleased()) {
      this.onClickUp(pointer);
    }
  };

  constructor() {
    super();
    this.EventBus = new EventBus<CursorManagerEvent>();
  }

  public Load(): void {
    this.scene?.input.on('pointermove', this.handlePointerMove);
    this.scene?.input.on('pointerup', this.handlePointerUp);

    CardpileManager.Instance.EventBus.on('onChosenCard', this.handleChosenCard);
    CardpileManager.Instance.EventBus.on('onChosenPickaxe', this.handleChosenPickaxe);
    CardpileManager.Instance.EventBus.on('onChosenStarShards', this.handleChosenStarShards);
    CardpileManager.Instance.EventBus.on('onCancelChosen', this.handleChosenCancel);
  }

  public setScene(scene: Game) {
    this.scene = scene;

    this.pickaxeSprite = scene.add.sprite(0, 0, 'pickaxe');
    this.pickaxeSprite.setDisplaySize(52 * PositionManager.Instance.scaleFactor, 52 * PositionManager.Instance.scaleFactor)
      .setDepth(DepthHelper.UI.cursorTool());
    this.pickaxeSprite.setVisible(false);

    this.starSprite = scene.add.sprite(0, 0, 'starshards');
    this.starSprite.setDisplaySize(52 * PositionManager.Instance.scaleFactor, 52 * PositionManager.Instance.scaleFactor)
      .setDepth(DepthHelper.UI.cursorTool());
    this.starSprite.setVisible(false);
  }

  public static get Instance(): CursorManager {
    if (!this._instance) {
      this._instance = new CursorManager();
    }
    return this._instance;
  }

  public Reset() {
    this.scene?.input.off('pointermove', this.handlePointerMove);
    this.scene?.input.off('pointerup', this.handlePointerUp);
    CardpileManager.Instance.EventBus.off('onChosenCard', this.handleChosenCard);
    CardpileManager.Instance.EventBus.off('onChosenPickaxe', this.handleChosenPickaxe);
    CardpileManager.Instance.EventBus.off('onChosenStarShards', this.handleChosenStarShards);
    CardpileManager.Instance.EventBus.off('onCancelChosen', this.handleChosenCancel);
    this.EventBus.removeAllListeners();
    this.stopHighlight();
    if (this.pickaxeSprite) {
      this.pickaxeSprite.destroy();
      this.pickaxeSprite = null;
    }
    if (this.starSprite) {
      this.starSprite.destroy();
      this.starSprite = null;
    }
    this.scene = null;
  }

  private changeCursorMode(data: { mode: 'pickaxe' | 'starshards' | 'plant' | 'default', pid?: number }) {
    if (!this.scene || !this.pickaxeSprite || !this.starSprite) return;
    if (CombatManager.Instance.isGameEnd) return;

    const mode = data.mode;

    this.stopHighlight();
    this.pickaxeSprite.setVisible(false);
    this.starSprite.setVisible(false);

    if (mode === 'pickaxe') {
      this.pickaxeSprite.setVisible(true);
      try {
        const pointer = this.scene.input.activePointer;
        this.pickaxeSprite.setPosition(pointer.x, pointer.y);
      } catch {
        this.pickaxeSprite.setPosition(this.scene.scale.width, 0);
      }
    } else if (mode === 'starshards') {
      this.starSprite.setVisible(true);
      this.starPrevCol = -1;
      this.starPrevRow = -1;
      try {
        const pointer = this.scene.input.activePointer;
        this.starSprite.setPosition(pointer.x, pointer.y);
      } catch {
        this.starSprite.setPosition(this.scene.scale.width * 1 / 3, this.scene.scale.height);
      }
    } else if (mode === 'plant' && data.pid !== undefined) {
      // Will highlight on move
      this.prevCol = -1;
      this.prevRow = -1;
    }
  }

  handleChosenCard = (pid: number, _level: number) => {
    this.changeCursorMode({ mode: 'plant', pid });
  }

  handleChosenPickaxe = () => {
    this.changeCursorMode({ mode: 'pickaxe' });
  }

  handleChosenStarShards = () => {
    this.changeCursorMode({ mode: 'starshards' });
  }

  handleChosenCancel = () => {
    this.changeCursorMode({ mode: 'default' });
  }

  public onMouseMoveEvent(pointer: Phaser.Input.Pointer) {
    if (!this.scene || !this.pickaxeSprite || !this.starSprite) return;

    const choice = CardpileManager.Instance;

    if (choice.usePickaxe) {
      const currentX = this.pickaxeSprite.x;
      const currentY = this.pickaxeSprite.y;
      const targetX = pointer.x;
      const targetY = pointer.y;
      const speed = 0.6;
      const newX = Phaser.Math.Linear(currentX, targetX, speed);
      const newY = Phaser.Math.Linear(currentY, targetY, speed);
      this.pickaxeSprite.setPosition(newX, newY);
      return;
    }

    if (choice.useStarShards) {
      const currentX = this.starSprite.x;
      const currentY = this.starSprite.y;
      const targetX = pointer.x;
      const targetY = pointer.y;
      const speed = 0.6;
      const newX = Phaser.Math.Linear(currentX, targetX, speed);
      const newY = Phaser.Math.Linear(currentY, targetY, speed);
      this.starSprite.setPosition(newX, newY);
      // 高亮"即将被使用星之碎片"的那株植物（白色发光 + 边框）。
      this.updateStarShardsHighlight(pointer);
      return;
    }

    if (choice.prePlantPid === null) {
      return;
    }

    const time = this.scene.time.now;
    if (time - this.prevMovementTime < this.UPDATE_INTERVAL) {
      return;
    }
    this.prevMovementTime = time;

    const worldPoint = this.scene.getBattleWorldPoint(pointer);
    const { col, row } = PositionManager.Instance.GetGridByPos(worldPoint.x, worldPoint.y);
    if ((col === this.prevCol && row === this.prevRow) || col < 0 || row < 0) {
      return;
    }

    this.prevCol = col;
    this.prevRow = row;
    const pid = choice.prePlantPid[0];
    const plantRecord = PlantLibrary.GetModel(pid);
    if (plantRecord) {
      this.startHighlight(col, row, plantRecord.texturePath);
    }
  }

  public onClickUp(pointer: Phaser.Input.Pointer) {
    if (!this.scene) return;

    const choice = CardpileManager.Instance;
    if (choice.prePlantPid === null && !choice.useStarShards && !choice.usePickaxe) return;

    // 禁用高亮
    this.changeCursorMode({ mode: 'default' });

    if (choice.useStarShards) {
      const worldPoint = this.scene.getBattleWorldPoint(pointer);
      const { col, row, aspect } = PositionManager.Instance.GetGridByPos(worldPoint.x, worldPoint.y);
      if (col >= 0 && row >= 0) {
        this.EventBus.emit('onAttemptUseStarShards', col, row, aspect);
        // 取消Choice
        CardpileManager.Instance.cancelSelection();
      }
      return;
    }

    if (choice.usePickaxe) {
      const worldPoint = this.scene.getBattleWorldPoint(pointer);
      const { col, row, aspect } = PositionManager.Instance.GetGridByPos(worldPoint.x, worldPoint.y);
      if (col >= 0 && row >= 0) {
        this.EventBus.emit('onAttemptRemovePlant', col, row, aspect);
        // 取消Choice
        CardpileManager.Instance.cancelSelection();
      }
      return;
    }

    if (choice.prePlantPid !== null) {
      if (!this.scene.innerSettings.isBluePrint && CombatManager.Instance.isPaused) {
        return;
      }

      const worldPoint = this.scene.getBattleWorldPoint(pointer);
      const { col, row } = PositionManager.Instance.GetGridByPos(worldPoint.x, worldPoint.y);
      if (col >= 0 && row >= 0) {
        // CAUTION : && PlantsManager.Instance.canPlant(choice.prePlantPid[0], col, row) 
        // 判断是否能够种植逻辑放在了PlantsManager里，CursorManager只负责发出尝试种植的事件，具体能不能种成功由PlantsManager根据规则判断后决定
        this.EventBus.emit('onAttemptPlant', col, row);
        // 取消Choice
        CardpileManager.Instance.cancelSelection();
      }
    }
  }

  /**
   * 悬浮在格子上时，把"将被使用星之碎片的植物"高亮出来。
   *
   * 目标选择与 `PlantsManager.handleAttemptUseStarShards` 共用
   * `PlantHelper.GetStarShardsTarget`，保证预览与真正生效的目标完全一致。
   */
  private updateStarShardsHighlight(pointer: Phaser.Input.Pointer) {
    if (!this.scene) return;

    const time = this.scene.time.now;
    if (time - this.prevMovementTime < this.UPDATE_INTERVAL) return;
    this.prevMovementTime = time;

    const worldPoint = this.scene.getBattleWorldPoint(pointer);
    const { col, row, aspect } = PositionManager.Instance.GetGridByPos(worldPoint.x, worldPoint.y);
    if (col < 0 || row < 0) {
      this.stopStarShardsHighlight(true);
      return;
    }

    const plants = PlantsManager.Instance.PlantsMap.get(`${col}-${row}`) ?? [];
    const target = PlantHelper.GetStarShardsTarget(plants, aspect);
    if (!target) {
      this.stopStarShardsHighlight(true);
      return;
    }

    if (this.starGlowSprite && col === this.starPrevCol && row === this.starPrevRow && aspect === this.starPrevAspect) {
      return;
    }

    this.starPrevCol = col;
    this.starPrevRow = row;
    this.starPrevAspect = aspect;
    this.startStarShardsHighlight(target.plantEntity);
  }

  private startStarShardsHighlight(plant: PlantEntity) {
    if (!this.scene) return;
    this.stopStarShardsHighlight(false);

    const size = PositionManager.Instance.getPlantDisplaySize();
    const depth = plant.baseDepth + 6;

    // 白色发光：用同贴图的加色副本做呼吸，不改变植物自身的 tint/透明度。
    this.starGlowSprite = this.scene.add.sprite(plant.x, plant.y, plant.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setTint(0xffffff)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.45)
      .setDepth(depth);

    // 边框
    this.starBorder = this.scene.add.rectangle(plant.x, plant.y, size.sizeX * 0.92, size.sizeY * 0.92, 0xffffff, 0.06)
      .setOrigin(0.5, 1)
      .setStrokeStyle(3, 0xffffff, 0.95)
      .setDepth(depth + 1);

    this.starGlowTween = this.scene.tweens.add({
      targets: [this.starGlowSprite, this.starBorder],
      alpha: { from: 0.45, to: 0.15 },
      duration: 450,
      yoyo: true,
      repeat: -1,
    });
  }

  private stopStarShardsHighlight(resetGrid: boolean) {
    if (this.starGlowTween) {
      this.starGlowTween.stop();
      this.starGlowTween.remove();
      this.starGlowTween = null;
    }
    if (this.starGlowSprite) {
      this.starGlowSprite.destroy();
      this.starGlowSprite = null;
    }
    if (this.starBorder) {
      this.starBorder.destroy();
      this.starBorder = null;
    }
    if (resetGrid) {
      this.starPrevCol = -1;
      this.starPrevRow = -1;
    }
  }

  private startHighlight(col: number, row: number, texture: string = 'plant/peashooter') {
    if (!this.scene) return;

    if (this.highlightSprite) {
      this.stopHighlight();
    }

    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);
    const size = PositionManager.Instance.getPlantDisplaySize();

    this.highlightSprite = this.scene.add.sprite(x, y, texture);
    this.highlightSprite.setDisplaySize(size.sizeX, size.sizeY);
    this.highlightSprite.setOrigin(0.5, 1);
    this.highlightSprite.setTint(0xffffff);
    this.highlightSprite.setAlpha(0.8);
    this.highlightSprite.setDepth(DepthHelper.UI.plantingPreview());

    this.highlightTween = this.scene.tweens.add({
      targets: this.highlightSprite,
      alpha: { from: 0.8, to: 0.2 },
      duration: 500,
      yoyo: true,
      repeat: -1,
    });
  }

  private stopHighlight() {
    this.stopStarShardsHighlight(true);
    if (this.highlightTween) {
      this.highlightTween.stop();
      this.highlightTween.remove();
      this.highlightTween = null;
    }
    if (this.highlightSprite) {
      this.highlightSprite.destroy();
      this.highlightSprite = null;
    }
    this.prevCol = -1;
    this.prevRow = -1;
  }
}
