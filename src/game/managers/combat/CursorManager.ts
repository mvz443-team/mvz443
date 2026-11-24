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
import { isShieldPlantPid } from "../../utils/helper/PlantTargeting";
import type { PlantEntity } from "../../models/entities/PlantEntity";

type CursorManagerEvent = {
  // cursor只管有在某个格子有‘尝试种植’事件发生，具体种植什么 或 是否种植成功 由其他mangager负责
  // 返回值表示本地校验是否通过：true=已发起种植，可清除选中；false=本地失败，保留当前卡槽
  onAttemptPlant: (col: number, row: number) => boolean;
  onAttemptUseStarShards: (col: number, row: number, aspect: 'up' | 'down') => void;
  onAttemptRemovePlant: (col: number, row: number, aspect: 'up' | 'down') => void;
}

/** 高亮副本的来源精灵快照（只读表现数据，不引用实体）。 */
type HighlightPart = {
  x: number;
  y: number;
  textureKey: string;
  frame: string | number;
  originX: number;
  originY: number;
  displayWidth: number;
  displayHeight: number;
  angle: number;
  flipX: boolean;
  flipY: boolean;
  depth: number;
};

/** 会悬浮高亮目标植物的工具。 */
type TargetGlowMode = 'starshards' | 'pickaxe';

/** 可被拖到格子上使用的卡槽对象。 */
export type DragKind = 'plant' | 'pickaxe' | 'starshards';

/**
 * 按下卡槽后登记的候选拖拽。
 *
 * 先登记、移动超过阈值才真正进入拖拽：轻点卡片仍然是原来的"选中"交互，
 * 只有明确拖出卡槽才按拖放落地，两种手势互不干扰。
 */
type DragPress = {
  kind: DragKind;
  pid: number;
  level: number;
  pointerId: number;
  startX: number;
  startY: number;
  /** 拖拽时随手走的卡面幽灵（只对卡片有，工具用自身的光标精灵）。 */
  ghostTexture?: string;
  ghostWidth?: number;
  ghostHeight?: number;
};

/** 指针从按下点移动超过该距离（CSS 像素）才判定为拖拽。 */
const DRAG_START_DISTANCE = 10;
/** 拖拽幽灵相对手指上移的比例：避免卡片被手指整个盖住。 */
const DRAG_GHOST_LIFT = 0.45;

export default class CursorManager extends BaseManager {
  private static _instance: CursorManager;
  protected scene: Game | null = null;

  EventBus: EventBus<CursorManagerEvent>;

  starSprite: Phaser.GameObjects.Sprite | null = null;
  pickaxeSprite: Phaser.GameObjects.Sprite | null = null;

  private highlightSprite: Phaser.GameObjects.Sprite | null = null;
  private highlightTween: Phaser.Tweens.Tween | null = null;

  /**
   * 工具悬浮高亮（星之碎片 / 铲子）：按目标植物自身的精灵轮廓叠一层发光副本。
   *
   * 不再画整格方框——护盾外壳和被罩住的内部植物都在同一格，
   * 方框会让两者看起来一模一样，也盖住格子里的其它植物。
   */
  private glowSprites: Phaser.GameObjects.Sprite[] = [];
  private glowTweens: Phaser.Tweens.Tween[] = [];
  private glowCol = -1;
  private glowRow = -1;
  private glowAspect: 'up' | 'down' = 'up';
  private glowMode: TargetGlowMode | null = null;

  prevCol: number = -1;
  prevRow: number = -1;
  prevMovementTime = 0;
  UPDATE_INTERVAL = 50;

  /** 按下卡槽但还没拖出卡槽的候选手势。 */
  private dragPress: DragPress | null = null;
  /** 是否已进入拖拽：此时选中态由拖拽持有，抬起时在格子上落地。 */
  private draggingCard = false;
  /** 拖拽中的卡面幽灵（纯表现，跟随指针）。 */
  private dragGhost: Phaser.GameObjects.Image | null = null;

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer) => {
    this.updateDragPress(pointer);
    this.onMouseMoveEvent(pointer);
  };
  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer) => {
    // 只跟踪发起按下的那根指针，其它指针（多点触控）仍走普通点击流程。
    if (this.dragPress && pointer.id === this.dragPress.pointerId) {
      if (this.draggingCard) {
        this.finishCardDrag(pointer);
        return;
      }
      // 没拖出卡槽就松手：交回卡片自身的点击流程处理。
      this.clearDragPress();
      return;
    }
    if (pointer.leftButtonReleased()) {
      this.onClickUp(pointer);
    }
  };
  /**
   * 新的按下开始 = 上一轮手势结束。
   *
   * 卡槽控件自身会 `stopPropagation`，所以这里的 pointerdown 只会在"按在网格 /
   * 空白处"时触发；用它兜底清掉可能因释放事件被别的 UI 吞掉而残留的拖拽状态。
   * 若发起拖拽的那根手指仍按着（多点触控下的第二根手指），则不能中断它。
   */
  private readonly handlePointerDown = () => {
    const press = this.dragPress;
    if (press) {
      const tracked = this.scene?.input.manager.pointers[press.pointerId];
      if (tracked?.isDown) return;
    }
    this.clearDragPress();
  };
  /** 指针在画布外松开：拖拽作废，避免手势与选中态残留。 */
  private readonly handlePointerUpOutside = () => {
    if (!this.dragPress) return;
    const wasDragging = this.draggingCard;
    this.clearDragPress();
    if (wasDragging) {
      this.changeCursorMode({ mode: 'default' });
      CardpileManager.Instance.cancelSelection();
    }
  };

  constructor() {
    super();
    this.EventBus = new EventBus<CursorManagerEvent>();
  }

  public Load(): void {
    this.scene?.input.on('pointermove', this.handlePointerMove);
    this.scene?.input.on('pointerup', this.handlePointerUp);
    this.scene?.input.on('pointerdown', this.handlePointerDown);
    this.scene?.input.on('pointerupoutside', this.handlePointerUpOutside);

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
    this.scene?.input.off('pointerdown', this.handlePointerDown);
    this.scene?.input.off('pointerupoutside', this.handlePointerUpOutside);
    this.clearDragPress();
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

  /**
   * 卡槽按下时登记"候选拖拽"（由卡片 / 铲子 / 星碎按钮的 pointerdown 调用）。
   *
   * 移动端手感：手指按住卡槽直接拖到格子上松手即可种植 / 铲除 / 使用星碎，
   * 不必再"先点卡片、再点格子"。轻点不动仍然是原有的选中交互：
   * 只有位移超过 `DRAG_START_DISTANCE` 才会真正进入拖拽。
   */
  public beginCardDragPress(
    kind: DragKind,
    pointer: Phaser.Input.Pointer,
    pid: number = -1,
    level: number = 1,
    ghost?: { texture: string; width: number; height: number },
  ) {
    if (!this.scene) return;
    if (this.draggingCard) return;
    this.dragPress = {
      kind,
      pid,
      level,
      pointerId: pointer.id,
      startX: pointer.x,
      startY: pointer.y,
      ghostTexture: ghost?.texture,
      ghostWidth: ghost?.width,
      ghostHeight: ghost?.height,
    };
  }

  /**
   * 卡槽控件收到 pointerup：结束本轮拖拽判定。
   *
   * 返回 `true` 表示刚才确实处于拖拽中（松手正好落在某个卡槽控件上），
   * 此时不能再当成"点击该卡槽"处理——否则拖拽途中划过的卡片会被误选。
   * 手势结束、状态必须清干净，否则残留的 `draggingCard` 会让下一次按下无法开始新的拖拽。
   */
  public endCardDragPress(): boolean {
    const wasDragging = this.draggingCard;
    this.clearDragPress();
    if (wasDragging) {
      // 拖拽落在卡槽上（而不是格子上）：与"拖到网格外"一致，撤销这次拖拽。
      this.changeCursorMode({ mode: 'default' });
      CardpileManager.Instance.cancelSelection();
    }
    return wasDragging;
  }

  private clearDragPress() {
    this.dragPress = null;
    this.draggingCard = false;
    this.hideDragGhost();
  }

  /** 按住卡槽移动超过阈值 → 真正开始拖拽。 */
  private updateDragPress(pointer: Phaser.Input.Pointer) {
    const press = this.dragPress;
    if (!press) return;
    if (pointer.id !== press.pointerId) return;

    if (this.draggingCard) {
      this.moveDragGhost(pointer);
      return;
    }

    if (!this.movedBeyondDragThreshold(pointer, press)) return;

    if (!this.armCardSelection(press)) {
      this.clearDragPress();
      return;
    }
    this.draggingCard = true;
    this.showDragGhost(press, pointer);
  }

  /**
   * 位移是否超过拖拽阈值。
   *
   * 指针坐标是游戏坐标，画布可能被 CSS 非等比拉伸（移动端竖屏尤其明显），
   * 直接比较游戏坐标会让横向阈值小得离谱——手指刚按下就被判成拖拽。
   * 这里先换算成 CSS 像素再比较，保证不同机型上手感一致。
   */
  private movedBeyondDragThreshold(pointer: Phaser.Input.Pointer, press: DragPress): boolean {
    let dx = pointer.x - press.startX;
    let dy = pointer.y - press.startY;
    const scale = this.scene?.scale;
    const canvas = scale?.game?.canvas as HTMLCanvasElement | undefined;
    const cssWidth = canvas?.clientWidth ?? 0;
    const cssHeight = canvas?.clientHeight ?? 0;
    if (scale && cssWidth > 0 && cssHeight > 0 && scale.gameSize.width > 0 && scale.gameSize.height > 0) {
      dx = (dx * cssWidth) / scale.gameSize.width;
      dy = (dy * cssHeight) / scale.gameSize.height;
    }
    return dx * dx + dy * dy >= DRAG_START_DISTANCE * DRAG_START_DISTANCE;
  }

  /** 拖拽中的卡面幽灵：跟随手指并抬高一点，避免被手指盖住。 */
  private showDragGhost(press: DragPress, pointer: Phaser.Input.Pointer) {
    if (!this.scene || !press.ghostTexture) return;
    this.hideDragGhost();
    // 幽灵必须压在卡槽栏之上：移动端侧边栏是 ui 层的不透明面板，
    // 排在 chrome 之下的精灵在手指还没拖出侧边栏时就完全看不见。
    const ghost = this.scene.add.image(pointer.x, pointer.y, press.ghostTexture)
      .setDepth(DepthHelper.UI.chromeControl() + 8)
      .setAlpha(0.9);
    if (press.ghostWidth && press.ghostHeight) {
      ghost.setDisplaySize(press.ghostWidth, press.ghostHeight);
    }
    this.dragGhost = ghost;
    this.moveDragGhost(pointer);
  }

  private moveDragGhost(pointer: Phaser.Input.Pointer) {
    const ghost = this.dragGhost;
    if (!ghost || !ghost.scene) return;
    ghost.setPosition(pointer.x, pointer.y - ghost.displayHeight * DRAG_GHOST_LIFT);
  }

  private hideDragGhost() {
    if (this.dragGhost) {
      this.dragGhost.destroy();
      this.dragGhost = null;
    }
  }

  /**
   * 拖拽开始时把卡槽切到选中态，之后完全复用既有的跟随 / 高亮 / 落地逻辑：
   * 预览看到的目标就是松手后真正作用的目标。
   */
  private armCardSelection(press: DragPress): boolean {
    const choice = CardpileManager.Instance;
    if (press.kind === 'plant') {
      if (choice.prePlantPid?.[0] !== press.pid) {
        choice.ClickCard(press.pid, press.level);
      }
      return choice.prePlantPid?.[0] === press.pid;
    }
    if (press.kind === 'pickaxe') {
      if (!choice.usePickaxe) choice.ClickPickaxe();
      return choice.usePickaxe;
    }
    if (!choice.useStarShards) choice.ClickStarShards();
    return choice.useStarShards;
  }

  /** 拖拽松手：落在格子上就按点击同一套路径落地，落在网格外则取消。 */
  private finishCardDrag(pointer: Phaser.Input.Pointer) {
    this.clearDragPress();
    if (!this.scene) return;

    if (!this.isPointerOnGrid(pointer)) {
      // 拖到网格外松手：直接撤销选中，避免留下"看不见但仍选中"的卡槽。
      this.changeCursorMode({ mode: 'default' });
      CardpileManager.Instance.cancelSelection();
      return;
    }
    this.onClickUp(pointer);
  }

  private isPointerOnGrid(pointer: Phaser.Input.Pointer): boolean {
    if (!this.scene) return false;
    const worldPoint = this.scene.getBattleWorldPoint(pointer);
    const { col, row } = PositionManager.Instance.GetGridByPos(worldPoint.x, worldPoint.y);
    return col >= 0 && row >= 0;
  }

  /**
   * 兜底校正光标与选中态。
   *
   * 选中态可能在别处被清空（资源不足、逻辑层取消），只要没走 `onCancelChosen`，
   * 光标精灵 / 格子预览就会停在原地不再跟随鼠标。这里在每次移动时对齐一次，
   * 保证"有选中才有光标"，不会卡住。
   */
  private syncCursorWithSelection(choice: CardpileManager) {
    if (this.pickaxeSprite?.visible && !choice.usePickaxe) {
      this.pickaxeSprite.setVisible(false);
    }
    if (this.starSprite?.visible && !choice.useStarShards) {
      this.starSprite.setVisible(false);
    }
    const idle = choice.prePlantPid === null && !choice.usePickaxe && !choice.useStarShards;
    if (idle && (this.highlightSprite || this.glowSprites.length > 0)) {
      this.stopHighlight();
    }
  }

  public onMouseMoveEvent(pointer: Phaser.Input.Pointer) {
    if (!this.scene || !this.pickaxeSprite || !this.starSprite) return;

    const choice = CardpileManager.Instance;
    this.syncCursorWithSelection(choice);

    if (choice.usePickaxe) {
      const currentX = this.pickaxeSprite.x;
      const currentY = this.pickaxeSprite.y;
      const targetX = pointer.x;
      const targetY = pointer.y;
      const speed = 0.6;
      const newX = Phaser.Math.Linear(currentX, targetX, speed);
      const newY = Phaser.Math.Linear(currentY, targetY, speed);
      this.pickaxeSprite.setPosition(newX, newY);
      // 高亮"即将被铲掉"的那株植物。
      this.updateTargetHighlight(pointer, 'pickaxe');
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
      // 高亮"即将被使用星之碎片"的那株植物。
      this.updateTargetHighlight(pointer, 'starshards');
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
        const [plantAccepted] = this.EventBus.emit('onAttemptPlant', col, row);
        // 仅本地校验通过、真正发起种植时才清除选中；本地失败时保留卡槽，方便玩家直接改点其它格子
        if (plantAccepted) {
          CardpileManager.Instance.cancelSelection();
        }
      }
    }
  }

  /**
   * 悬浮在格子上时，把"这次点击真正会作用到的那株植物"高亮出来。
   *
   * 目标选择与实际执行共用同一份规则：
   * - 星之碎片 → `PlantHelper.GetStarShardsTarget`（`PlantsManager.handleAttemptUseStarShards`）；
   * - 铲子 → `PlantHelper.GetRemovePlantTarget`（`PlantsManager.handleAttemptRemovePlant`）。
   * 这样预览与执行永远一致，不会出现"高亮 A、实际作用到 B"。
   */
  private updateTargetHighlight(pointer: Phaser.Input.Pointer, mode: TargetGlowMode) {
    if (!this.scene) return;

    const time = this.scene.time.now;
    if (time - this.prevMovementTime < this.UPDATE_INTERVAL) return;
    this.prevMovementTime = time;

    const worldPoint = this.scene.getBattleWorldPoint(pointer);
    const { col, row, aspect } = PositionManager.Instance.GetGridByPos(worldPoint.x, worldPoint.y);
    if (col < 0 || row < 0) {
      this.stopTargetGlow(true);
      return;
    }

    const plants = PlantsManager.Instance.PlantsMap.get(`${col}-${row}`) ?? [];
    const target = mode === 'pickaxe'
      ? PlantHelper.GetRemovePlantTarget(plants, aspect)
      : PlantHelper.GetStarShardsTarget(plants, aspect);
    if (!target) {
      this.stopTargetGlow(true);
      return;
    }

    if (this.glowSprites.length > 0
      && mode === this.glowMode
      && col === this.glowCol
      && row === this.glowRow
      && aspect === this.glowAspect) {
      return;
    }

    this.glowMode = mode;
    this.glowCol = col;
    this.glowRow = row;
    this.glowAspect = aspect;
    this.startTargetGlow(target.plantEntity, mode);
  }

  /**
   * 高亮被选中的那株植物。
   *
   * 形状只覆盖目标自己的精灵轮廓（护盾高亮的是壳，内部植物高亮的是植物本体），
   * 颜色区分工具与身份：
   * - 星之碎片：护盾外壳暖金色、被罩住的内部植物冷青色；
   * - 铲子：统一的警示红。
   */
  private startTargetGlow(plant: PlantEntity, mode: TargetGlowMode) {
    if (!this.scene) return;
    this.stopTargetGlow(false);

    const isShield = isShieldPlantPid(plant.model.pid);
    const tint = mode === 'pickaxe' ? 0xff5340 : (isShield ? 0xffb62e : 0x5fdcff);
    const coreAlpha = mode === 'pickaxe' ? 0.85 : (isShield ? 0.9 : 0.78);
    const haloAlpha = mode === 'pickaxe' ? 0.38 : (isShield ? 0.4 : 0.32);

    const parts = this.collectHighlightParts(plant);
    if (parts.length === 0) return;

    const coreSprites: Phaser.GameObjects.Sprite[] = [];
    const haloSprites: Phaser.GameObjects.Sprite[] = [];
    for (const part of parts) {
      // 只比原精灵高半个层级：被护盾外壳罩住的植物，高光仍然会被外壳挡住，
      // 不会出现"光从壳里透出来"的错觉。外层光晕略微放大，让发光更明显。
      haloSprites.push(this.createHighlightSprite(part, tint, haloAlpha, 1.12, part.depth + 0.4));
      coreSprites.push(this.createHighlightSprite(part, tint, coreAlpha, 1, part.depth + 0.6));
    }

    this.glowSprites = [...haloSprites, ...coreSprites];
    this.glowTweens = [
      this.scene.tweens.add({
        targets: haloSprites,
        alpha: { from: haloAlpha, to: haloAlpha * 0.25 },
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
      this.scene.tweens.add({
        targets: coreSprites,
        alpha: { from: coreAlpha, to: coreAlpha * 0.45 },
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
    ];
  }

  /** 收集目标植物实际显示中的精灵部件（跳过碰撞盒、文字与隐藏部件）。 */
  private collectHighlightParts(plant: PlantEntity): HighlightPart[] {
    const parts: HighlightPart[] = [];
    for (const child of plant.viewGroup.getChildren()) {
      if (!(child instanceof Phaser.GameObjects.Sprite)) continue;
      const sprite = child as Phaser.GameObjects.Sprite;
      if (!sprite.visible || sprite.alpha <= 0.01) continue;
      if (!sprite.texture?.key || !sprite.frame) continue;
      parts.push({
        x: sprite.x,
        y: sprite.y,
        textureKey: sprite.texture.key,
        frame: sprite.frame.name,
        originX: sprite.originX,
        originY: sprite.originY,
        displayWidth: sprite.displayWidth,
        displayHeight: sprite.displayHeight,
        angle: sprite.angle,
        flipX: sprite.flipX,
        flipY: sprite.flipY,
        depth: sprite.depth,
      });
    }

    if (parts.length === 0) {
      // 兜底：没有可复制的精灵时（例如尚未构建视图），至少给整株贴图打亮。
      const size = PositionManager.Instance.getPlantDisplaySize();
      parts.push({
        x: plant.x,
        y: plant.y,
        textureKey: plant.model.texturePath,
        frame: 0,
        originX: 0.5,
        originY: 1,
        displayWidth: size.sizeX,
        displayHeight: size.sizeY,
        angle: 0,
        flipX: false,
        flipY: false,
        depth: plant.baseDepth + 6,
      });
    }
    return parts;
  }

  private createHighlightSprite(
    part: HighlightPart,
    tint: number,
    alpha: number,
    sizeScale: number,
    depth: number,
  ): Phaser.GameObjects.Sprite {
    const sprite = this.scene!.add.sprite(part.x, part.y, part.textureKey, part.frame)
      .setOrigin(part.originX, part.originY)
      .setDepth(depth)
      .setTint(tint)
      .setAlpha(alpha)
      .setBlendMode(Phaser.BlendModes.ADD);

    sprite.setDisplaySize(part.displayWidth * sizeScale, part.displayHeight * sizeScale);
    if (part.flipX) sprite.setFlipX(true);
    if (part.flipY) sprite.setFlipY(true);
    if (part.angle !== 0) sprite.setAngle(part.angle);
    return sprite;
  }

  private stopTargetGlow(resetGrid: boolean) {
    for (const tween of this.glowTweens) {
      tween.stop();
      tween.remove();
    }
    this.glowTweens = [];

    for (const sprite of this.glowSprites) {
      sprite.destroy();
    }
    this.glowSprites = [];

    if (resetGrid) {
      this.glowCol = -1;
      this.glowRow = -1;
      this.glowMode = null;
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
    this.stopTargetGlow(true);
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
