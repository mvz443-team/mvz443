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

  public static get Instance(): PositionManager {
    if (!PositionManager._instance) {
      PositionManager._instance = new PositionManager();
    }
    return PositionManager._instance;
  }

  public Load(): void { }

  public setSceneViewportSize(
    width: number = LOGICAL_BATTLE_WIDTH,
    height: number = LOGICAL_BATTLE_HEIGHT,
    deviceType: GameDeviceType = this._sceneLayoutDeviceType,
  ): void {
    this._sceneMainWidth = Math.max(1, width);
    this._sceneMainHeight = Math.max(1, height);
    this._sceneLayoutDeviceType = deviceType;
  }

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

  public getGridTopLeft(col: number, row: number): { x: number; y: number } {
    return {
      x: col * this._GRID_SIZEX + this._gridOffsetX,
      y: row * this._GRID_SIZEY + this._gridOffsetY,
    };
  }

  public getGridCenter(col: number, row: number): { x: number; y: number } {
    const topLeft = this.getGridTopLeft(col, row);
    return {
      x: topLeft.x + this._GRID_SIZEX / 2,
      y: topLeft.y + this._GRID_SIZEY / 2,
    };
  }

  public getPlantBottomCenter(col: number, row: number): { x: number; y: number } {
    const { x, y } = this.getGridTopLeft(col, row);
    return {
      x: x + this._GRID_SIZEX / 2,
      y: y + this._GRID_SIZEY,
    };
  }

  public getPlantBodyCenter(col: number, row: number): { x: number; y: number } {
    const bottomCenter = this.getPlantBottomCenter(col, row);
    return this.getPlantBodyCenterByBottom(bottomCenter.x, bottomCenter.y);
  }

  public getPlantDisplaySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: this._GRID_SIZEX * 0.9,
      sizeY: this._GRID_SIZEY * 0.9,
    };
  }

  public getPlantBodySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 60,
      sizeY: 45,
    };
  }

  public getPlantBodyCenterByBottom(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getPlantBodySize();
    return {
      x,
      y: y - bodySize.sizeY / 2,
    };
  }

  public getPlantBottomCenterByBody(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getPlantBodySize();
    return {
      x,
      y: y + bodySize.sizeY / 2,
    };
  }

  public getBulletCenter(col: number, row: number): { x: number; y: number } {
    return this.getGridCenter(col, row);
  }

  public getRowCenterY(row: number): number {
    return row * this._GRID_SIZEY + this._gridOffsetY + this._GRID_SIZEY / 2;
  }

  public getBulletDisplaySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 20 * this._scaleFactor,
      sizeY: 20 * this._scaleFactor,
    };
  }

  public getBulletBodySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 20,
      sizeY: 20,
    };
  }

  public getZombieBottomCenter(col: number, row: number): { x: number; y: number } {
    const { x, y } = this.getGridTopLeft(col, row);
    return {
      x: x + this._GRID_SIZEX / 2,
      y: y + this._GRID_SIZEY,
    };
  }

  public getZombieBodyCenter(col: number, row: number): { x: number; y: number } {
    const bottomCenter = this.getZombieBottomCenter(col, row);
    return this.getZombieBodyCenterByBottom(bottomCenter.x, bottomCenter.y);
  }

  public getZombieDisplaySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 72 * this._scaleFactor,
      sizeY: 108 * this._scaleFactor,
    };
  }

  public getZombieBodySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: 30,
      sizeY: 45,
    };
  }

  public getZombieBodyCenterByBottom(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getZombieBodySize();
    return {
      x,
      y: y - bodySize.sizeY / 2,
    };
  }

  public getZombieBottomCenterByBody(x: number, y: number): { x: number; y: number } {
    const bodySize = this.getZombieBodySize();
    return {
      x,
      y: y + bodySize.sizeY / 2,
    };
  }

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

  public getColByX(x: number): number {
    if (x < this._gridOffsetX || x > this._gridOffsetX + this._GRID_SIZEX * this._Col_Number) {
      return -1;
    }
    return Math.floor((x - this._gridOffsetX - 1) / this._GRID_SIZEX);
  }

  public getRowByY(y: number): number {
    if (y < this._gridOffsetY || y > this._gridOffsetY + this._GRID_SIZEY * this._Row_Number) {
      return -1;
    }
    return Math.floor((y - this._gridOffsetY - 1) / this._GRID_SIZEY);
  }

  public getCenterByPos(x: number, y: number): { x: number; y: number } {
    const { col, row } = this.GetGridByPos(x, y);
    return this.getGridCenter(col, row);
  }

  public getRandomCol(rand: number): number {
    return Math.floor(this._Col_Number * rand);
  }

  public getRandomRow(rand: number): number {
    return Math.floor(this._Row_Number * rand);
  }

  public get scaleFactor(): number {
    return this._scaleFactor;
  }

  public get GRID_SIZEX(): number {
    return this._GRID_SIZEX;
  }

  public get GRID_SIZEY(): number {
    return this._GRID_SIZEY;
  }

  public get gridOffsetX(): number {
    return this._gridOffsetX;
  }

  public get gridOffsetY(): number {
    return this._gridOffsetY;
  }

  public get Col_Number(): number {
    return this._Col_Number;
  }

  public get Row_Number(): number {
    return this._Row_Number;
  }

  public getScaleFactor(): number {
    return this._scaleFactor;
  }

  public getRowCount(): number {
    return this._Row_Number;
  }

  public getColCount(): number {
    return this._Col_Number;
  }

  public getGridSize(): { width: number; height: number } {
    return {
      width: this._GRID_SIZEX,
      height: this._GRID_SIZEY,
    };
  }

  public getGridOffset(): { x: number; y: number } {
    return {
      x: this._gridOffsetX,
      y: this._gridOffsetY,
    };
  }

  public getGridBounds(): Rect {
    return {
      x: this._gridOffsetX,
      y: this._gridOffsetY,
      width: this._GRID_SIZEX * this._Col_Number,
      height: this._GRID_SIZEY * this._Row_Number,
    };
  }

  public getSceneChromeLayout(deviceType: GameDeviceType = this._sceneLayoutDeviceType): GameSceneChromeLayout {
    return getGameSceneChromeLayout(this._sceneMainWidth, this._sceneMainHeight, deviceType, true);
  }

  public getGameViewportBounds(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    return this.getSceneChromeLayout(deviceType).mainViewport;
  }

  public getSceneBounds(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    return this.getSceneChromeLayout(deviceType).sceneBounds;
  }

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

  public getWorldBounds(): { left: number; right: number; top: number; bottom: number } {
    return {
      left: -PositionManager.WORLD_HORIZONTAL_MARGIN,
      right: LOGICAL_BATTLE_WORLD_WIDTH + PositionManager.WORLD_HORIZONTAL_MARGIN,
      top: -PositionManager.WORLD_VERTICAL_MARGIN,
      bottom: LOGICAL_BATTLE_HEIGHT + PositionManager.WORLD_VERTICAL_MARGIN,
    };
  }

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
