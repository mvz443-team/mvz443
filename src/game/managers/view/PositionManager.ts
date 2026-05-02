import { BaseManager } from "../BaseManager";
import {
  BATTLE_GRID_CELL_HEIGHT,
  BATTLE_GRID_CELL_WIDTH,
  BATTLE_GRID_COLS,
  BATTLE_GRID_MAX_ROWS,
  BATTLE_GRID_OFFSET_X,
  BATTLE_GRID_OFFSET_Y_FOR_MAX_ROWS,
  getGameSceneChromeLayout,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
  LOGICAL_BATTLE_WORLD_WIDTH,
} from "../../../constants/gameLayout";
import type {
  GameDeviceType,
  GameSceneChromeLayout,
  Rect,
} from "../../../constants/gameLayout";

type GridGeometry = {
  offsetX: number;
  offsetY: number;
  sizeX: number;
  sizeY: number;
};

export type StageGridLayoutOptions = {
  /**
   * Deprecated compatibility flag. UI chrome is projected by cameras/layout
   * helpers; world/grid coordinates must always remain battle-local.
   */
  includeUiChrome?: boolean;
  deviceType?: GameDeviceType;
};

/**
 * PositionManager
 * - World/grid coordinates stay in a fixed logical space.
 * - `scaleFactor` is kept only for view-layer compatibility.
 */
export class PositionManager extends BaseManager {
  private static _instance: PositionManager;

  private static readonly BASE_GRID_OFFSET_X = BATTLE_GRID_OFFSET_X;
  private static readonly BASE_GRID_OFFSET_Y = BATTLE_GRID_OFFSET_Y_FOR_MAX_ROWS;
  private static readonly BASE_GRID_SIZE_X = BATTLE_GRID_CELL_WIDTH;
  private static readonly BASE_GRID_SIZE_Y = BATTLE_GRID_CELL_HEIGHT;
  private static readonly WORLD_HORIZONTAL_MARGIN = 40;
  private static readonly WORLD_VERTICAL_MARGIN = 40;
  private static readonly MAX_ROW_NUMBER = BATTLE_GRID_MAX_ROWS;

  private _scaleFactor = 1;
  private _gridOffsetX = PositionManager.calculateGridGeometry(4).offsetX;
  private _gridOffsetY = PositionManager.calculateGridGeometry(4).offsetY;
  private _GRID_SIZEX = PositionManager.calculateGridGeometry(4).sizeX;
  private _GRID_SIZEY = PositionManager.calculateGridGeometry(4).sizeY;

  private _Row_Number = 4;
  private _Col_Number = BATTLE_GRID_COLS;
  private _sceneLayoutDeviceType: GameDeviceType = 'pc';
  private _sceneMainWidth = LOGICAL_BATTLE_WIDTH;
  private _sceneMainHeight = LOGICAL_BATTLE_HEIGHT;

  /**
   * 获取位置管理器单例实例
   */
  public static get Instance(): PositionManager {
    if (!PositionManager._instance) {
      PositionManager._instance = new PositionManager();
    }
    return PositionManager._instance;
  }

  /**
   * 加载位置管理器资源或初始化状态
   */
  public Load(): void { }

  /**
   * 设置场景视口大小
   * @param width 逻辑宽度
   * @param height 逻辑高度
   * @param deviceType 游戏设备类型
   */
  public setSceneViewportSize(
    width: number = LOGICAL_BATTLE_WIDTH,
    height: number = LOGICAL_BATTLE_HEIGHT,
    deviceType: GameDeviceType = this._sceneLayoutDeviceType,
  ): void {
    this._sceneMainWidth = Math.max(1, width);
    this._sceneMainHeight = Math.max(1, height);
    this._sceneLayoutDeviceType = deviceType;
  }

  /**
   * 设置舞台网格布局
   * @param scaleFactor 缩放因子(遗留参数)
   * @param row_number 网格行数
   * @param col_number 网格列数
   * @param options 舞台网格布局选项
   */
  public setStageGrid(
    scaleFactor: number,
    row_number: number = 4,
    col_number: number = BATTLE_GRID_COLS,
    options: StageGridLayoutOptions = {},
  ): void {
    PositionManager.validateGridSize(row_number, col_number);

    const geometry = PositionManager.calculateGridGeometry(row_number);
    const deviceType = options.deviceType ?? this._sceneLayoutDeviceType;
    void scaleFactor;
    void options.includeUiChrome;

    this._Row_Number = row_number;
    this._Col_Number = col_number;
    this._scaleFactor = 1;
    this._sceneLayoutDeviceType = deviceType;

    // Logical world size is fixed; screen scaling/UI chrome belong to cameras.
    this._gridOffsetX = geometry.offsetX;
    this._gridOffsetY = geometry.offsetY;
    this._GRID_SIZEX = geometry.sizeX;
    this._GRID_SIZEY = geometry.sizeY;
  }

  /**
   * 重置位置管理器到默认状态
   */
  public Reset(): void {
    const geometry = PositionManager.calculateGridGeometry(4);
    this._scaleFactor = 1;
    this._gridOffsetX = geometry.offsetX;
    this._gridOffsetY = geometry.offsetY;
    this._GRID_SIZEX = geometry.sizeX;
    this._GRID_SIZEY = geometry.sizeY;
    this._Row_Number = 4;
    this._Col_Number = BATTLE_GRID_COLS;
    this._sceneLayoutDeviceType = 'pc';
    this._sceneMainWidth = LOGICAL_BATTLE_WIDTH;
    this._sceneMainHeight = LOGICAL_BATTLE_HEIGHT;
  }

  /**
   * 获取指定网格单元的左上角坐标
   * @param col 列索引
   * @param row 行索引
   */
  public getGridTopLeft(col: number, row: number): { x: number; y: number } {
    return {
      x: col * this._GRID_SIZEX + this._gridOffsetX,
      y: row * this._GRID_SIZEY + this._gridOffsetY,
    };
  }

  /**
   * 获取指定网格单元的中心坐标
   * @param col 列索引
   * @param row 行索引
   */
  public getGridCenter(col: number, row: number): { x: number; y: number } {
    const topLeft = this.getGridTopLeft(col, row);
    return {
      x: topLeft.x + this._GRID_SIZEX / 2,
      y: topLeft.y + this._GRID_SIZEY / 2,
    };
  }

  /**
   * 获取植物的底部中心坐标
   * @param col 列索引
   * @param row 行索引
   */
  public getPlantBottomCenter(col: number, row: number): { x: number; y: number } {
    const { x, y } = this.getGridTopLeft(col, row);
    return {
      x: x + this._GRID_SIZEX / 2,
      y: y + this._GRID_SIZEY,
    };
  }

  /**
   * 获取植物的躯干中心坐标
   * @param col 列索引
   * @param row 行索引
   */
  public getPlantBodyCenter(col: number, row: number): { x: number; y: number } {
    const bottomCenter = this.getPlantBottomCenter(col, row);
    return this.getPlantBodyCenterByBottom(bottomCenter.x, bottomCenter.y);
  }

  /**
   * 获取植物在显示时的渲染大小
   */
  public getPlantDisplaySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: this._GRID_SIZEX * 0.9,
      sizeY: this._GRID_SIZEY * 0.9,
    };
  }

  /**
   * 获取植物逻辑物理碰撞大小
   */
  public getPlantBodySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 60,
      sizeY: 45,
    };
  }

  /**
   * 通过植物的底部坐标计算其躯干中心坐标
   * @param x 底部中心X
   * @param y 底部中心Y
   */
  public getPlantBodyCenterByBottom(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getPlantBodySize();
    return {
      x,
      y: y - bodySize.sizeY / 2,
    };
  }

  /**
   * 通过植物的躯干中心坐标计算其底部坐标
   * @param x 躯干中心X
   * @param y 躯干中心Y
   */
  public getPlantBottomCenterByBody(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getPlantBodySize();
    return {
      x,
      y: y + bodySize.sizeY / 2,
    };
  }

  /**
   * 获取子弹在网格中的中心坐标
   * @param col 列索引
   * @param row 行索引
   */
  public getBulletCenter(col: number, row: number): { x: number; y: number } {
    return this.getGridCenter(col, row);
  }

  /**
   * 获取指定行的中心Y坐标
   * @param row 行索引
   */
  public getRowCenterY(row: number): number {
    return row * this._GRID_SIZEY + this._gridOffsetY + this._GRID_SIZEY / 2;
  }

  /**
   * 获取子弹在显示时的渲染大小
   */
  public getBulletDisplaySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 20 * this._scaleFactor,
      sizeY: 20 * this._scaleFactor,
    };
  }

  /**
   * 获取子弹逻辑物理碰撞大小
   */
  public getBulletBodySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 20,
      sizeY: 20,
    };
  }

  /**
   * 获取僵尸的底部中心坐标
   * @param col 列索引
   * @param row 行索引
   */
  public getZombieBottomCenter(col: number, row: number): { x: number; y: number } {
    const { x, y } = this.getGridTopLeft(col, row);
    return {
      x: x + this._GRID_SIZEX / 2,
      y: y + this._GRID_SIZEY,
    };
  }

  /**
   * 获取僵尸的躯干中心坐标
   * @param col 列索引
   * @param row 行索引
   */
  public getZombieBodyCenter(col: number, row: number): { x: number; y: number } {
    const bottomCenter = this.getZombieBottomCenter(col, row);
    return this.getZombieBodyCenterByBottom(bottomCenter.x, bottomCenter.y);
  }

  /**
   * 获取僵尸在显示时的渲染大小
   */
  public getZombieDisplaySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 72 * this._scaleFactor,
      sizeY: 108 * this._scaleFactor,
    };
  }

  /**
   * 获取僵尸逻辑物理碰撞大小
   */
  public getZombieBodySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 30,
      sizeY: 45,
    };
  }

  /**
   * 通过僵尸的底部坐标计算其躯干中心坐标
   * @param x 底部中心X
   * @param y 底部中心Y
   */
  public getZombieBodyCenterByBottom(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getZombieBodySize();
    return {
      x,
      y: y - bodySize.sizeY / 2,
    };
  }

  /**
   * 通过僵尸的躯干中心坐标计算其底部坐标
   * @param x 躯干中心X
   * @param y 躯干中心Y
   */
  public getZombieBottomCenterByBody(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getZombieBodySize();
    return {
      x,
      y: y + bodySize.sizeY / 2,
    };
  }

  /**
   * 根据世界坐标获取对应的网格信息
   * @param x X坐标
   * @param y Y坐标
   */
  public GetGridByPos(x: number, y: number): { col: number; row: number; aspect: "up" | "down" } {
    const isOutOfBounds =
      x < this._gridOffsetX ||
      y < this._gridOffsetY ||
      x > this._gridOffsetX + this._GRID_SIZEX * this._Col_Number ||
      y > this._gridOffsetY + this._GRID_SIZEY * this._Row_Number;

    if (isOutOfBounds) {
      return { col: -1, row: -1, aspect: "down" };
    }

    const col = Math.floor((x - this._gridOffsetX - 1) / this._GRID_SIZEX);
    const row = Math.floor((y - this._gridOffsetY - 1) / this._GRID_SIZEY);
    const aspect = y < this.getGridCenter(col, row).y ? "up" : "down";

    return { col, row, aspect };
  }

  /**
   * 根据X坐标获取对应的列号
   * @param x X坐标
   */
  public getColByX(x: number): number {
    if (x < this._gridOffsetX || x > this._gridOffsetX + this._GRID_SIZEX * this._Col_Number) {
      return -1;
    }
    return Math.floor((x - this._gridOffsetX - 1) / this._GRID_SIZEX);
  }

  /**
   * 根据Y坐标获取对应的行号
   * @param y Y坐标
   */
  public getRowByY(y: number): number {
    if (y < this._gridOffsetY || y > this._gridOffsetY + this._GRID_SIZEY * this._Row_Number) {
      return -1;
    }
    return Math.floor((y - this._gridOffsetY - 1) / this._GRID_SIZEY);
  }

  /**
   * 获取坐标所在网格的中心坐标
   * @param x X坐标
   * @param y Y坐标
   */
  public getCenterByPos(x: number, y: number): { x: number; y: number } {
    const { col, row } = this.GetGridByPos(x, y);
    return this.getGridCenter(col, row);
  }

  /**
   * 获取一个随机的列号
   * @param rand [0,1) 的随机种子值
   */
  public getRandomCol(rand: number): number {
    return Math.floor(this._Col_Number * rand);
  }

  /**
   * 获取一个随机的行号
   * @param rand [0,1) 的随机种子值
   */
  public getRandomRow(rand: number): number {
    return Math.floor(this._Row_Number * rand);
  }

  /**
   * 获取视图缩放比例
   */
  public get scaleFactor(): number {
    return this._scaleFactor;
  }

  /**
   * 获取网格单元格宽度
   */
  public get GRID_SIZEX(): number {
    return this._GRID_SIZEX;
  }

  /**
   * 获取网格单元格高度
   */
  public get GRID_SIZEY(): number {
    return this._GRID_SIZEY;
  }

  /**
   * 获取网格区域X偏移量
   */
  public get gridOffsetX(): number {
    return this._gridOffsetX;
  }

  /**
   * 获取网格区域Y偏移量
   */
  public get gridOffsetY(): number {
    return this._gridOffsetY;
  }

  /**
   * 获取网格列数枚举
   */
  public get Col_Number(): number {
    return this._Col_Number;
  }

  /**
   * 获取网格行数枚举
   */
  public get Row_Number(): number {
    return this._Row_Number;
  }

  /**
   * 获取缩放比例的方法封装
   */
  public getScaleFactor(): number {
    return this._scaleFactor;
  }

  /**
   * 获取当前行数的方法封装
   */
  public getRowCount(): number {
    return this._Row_Number;
  }

  /**
   * 获取当前列数的方法封装
   */
  public getColCount(): number {
    return this._Col_Number;
  }

  /**
   * 获取当前网格宽高尺寸
   */
  public getGridSize(): { width: number; height: number } {
    return {
      width: this._GRID_SIZEX,
      height: this._GRID_SIZEY,
    };
  }

  /**
   * 获取当前网格的原点偏移量
   */
  public getGridOffset(): { x: number; y: number } {
    return {
      x: this._gridOffsetX,
      y: this._gridOffsetY,
    };
  }

  /**
   * 获取整个网格区域的边界矩形
   */
  public getGridBounds(): Rect {
    return {
      x: this._gridOffsetX,
      y: this._gridOffsetY,
      width: this._GRID_SIZEX * this._Col_Number,
      height: this._GRID_SIZEY * this._Row_Number,
    };
  }

  /**
   * 获取场景布局计算结果(结合UI)
   * @param deviceType 游戏设备类型
   */
  public getSceneChromeLayout(deviceType: GameDeviceType = this._sceneLayoutDeviceType): GameSceneChromeLayout {
    return getGameSceneChromeLayout(this._sceneMainWidth, this._sceneMainHeight, deviceType, true);
  }

  /**
   * 获取战斗游戏画面的视口边界
   * @param deviceType 游戏设备类型
   */
  public getGameViewportBounds(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    return this.getSceneChromeLayout(deviceType).mainViewport;
  }

  /**
   * 获取整个外层场景视图边界
   * @param deviceType 游戏设备类型
   */
  public getSceneBounds(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    return this.getSceneChromeLayout(deviceType).sceneBounds;
  }

  /**
   * 获取网格经过视口变换后在场景中的边界
   * @param deviceType 游戏设备类型
   */
  public getGridBoundsInScene(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    const gridBounds = this.getGridBounds();
    const viewport = this.getGameViewportBounds(deviceType);
    return {
      x: viewport.x + gridBounds.x,
      y: viewport.y + gridBounds.y,
      width: gridBounds.width,
      height: gridBounds.height,
    };
  }

  /**
   * 获取战斗环境下的逻辑世界物理边界(含边距)
   */
  public getWorldBounds(): { left: number; right: number; top: number; bottom: number } {
    return {
      left: -PositionManager.WORLD_HORIZONTAL_MARGIN,
      right: LOGICAL_BATTLE_WORLD_WIDTH + PositionManager.WORLD_HORIZONTAL_MARGIN,
      top: -PositionManager.WORLD_VERTICAL_MARGIN,
      bottom: LOGICAL_BATTLE_HEIGHT + PositionManager.WORLD_VERTICAL_MARGIN,
    };
  }

  /**
   * 验证网格尺寸的合法性
   * @param rowNumber 行数
   * @param colNumber 列数
   */
  private static validateGridSize(rowNumber: number, colNumber: number): void {
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
      throw new Error("row_number should be a positive integer");
    }
    if (rowNumber > PositionManager.MAX_ROW_NUMBER) {
      throw new Error(`row_number should be less than or equal to ${PositionManager.MAX_ROW_NUMBER}`);
    }
    if (!Number.isInteger(colNumber) || colNumber <= 0) {
      throw new Error("col_number should be a positive integer");
    }
  }

  /**
   * 计算指定行数下的网格几何形状结构参数
   * @param rowNumber 行数
   */
  private static calculateGridGeometry(rowNumber: number): GridGeometry {
    const extraRows = PositionManager.MAX_ROW_NUMBER - rowNumber;
    const offsetY = PositionManager.BASE_GRID_OFFSET_Y
      + extraRows * PositionManager.BASE_GRID_SIZE_Y / 2;

    return {
      offsetX: PositionManager.BASE_GRID_OFFSET_X,
      offsetY,
      sizeX: PositionManager.BASE_GRID_SIZE_X,
      sizeY: PositionManager.BASE_GRID_SIZE_Y,
    };
  }
}
