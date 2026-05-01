import { BaseManager } from "../BaseManager";
import {
  getGameSceneChromeLayout,
  LOGICAL_GAME_HEIGHT,
  LOGICAL_GAME_WIDTH,
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
   * Keep false while React owns the surrounding UI. When the top/bottom/side
   * tools move into Phaser, set this to true so grid coordinates are placed
   * inside the full scene chrome instead of the local 800x600 viewport.
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

  private static readonly BASE_GRID_OFFSET_X = 50;
  private static readonly BASE_GRID_OFFSET_Y = 100;
  private static readonly BASE_GRID_SIZE_X = 80;
  private static readonly BASE_GRID_SIZE_Y = 90;
  private static readonly WORLD_HORIZONTAL_MARGIN = 40;
  private static readonly WORLD_VERTICAL_MARGIN = 40;
  private static readonly MAX_ROW_NUMBER = 7;
  private static readonly MAX_FULL_SIZE_ROW_NUMBER = 6;
  private static readonly MAX_FULL_SIZE_GRID_OFFSET_Y = 20;
  private static readonly MAX_FULL_SIZE_GRID_BOTTOM_MARGIN = 40;
  private static readonly COMPATIBLE_GRID_AREA_HEIGHT =
    LOGICAL_GAME_HEIGHT
    - PositionManager.MAX_FULL_SIZE_GRID_OFFSET_Y
    - PositionManager.MAX_FULL_SIZE_GRID_BOTTOM_MARGIN;

  private _scaleFactor = 1;
  private _gridOffsetX = PositionManager.BASE_GRID_OFFSET_X;
  private _gridOffsetY = PositionManager.BASE_GRID_OFFSET_Y;
  private _GRID_SIZEX = PositionManager.BASE_GRID_SIZE_X;
  private _GRID_SIZEY = PositionManager.BASE_GRID_SIZE_Y;

  private _Row_Number = 4;
  private _Col_Number = 9;
  private _layoutIncludesUiChrome = false;
  private _sceneLayoutDeviceType: GameDeviceType = 'pc';

  public static get Instance(): PositionManager {
    if (!PositionManager._instance) {
      PositionManager._instance = new PositionManager();
    }
    return PositionManager._instance;
  }

  public Load(): void { }

  public setStageGrid(
    scaleFactor: number,
    row_number: number = 4,
    col_number: number = 9,
    options: StageGridLayoutOptions = {},
  ): void {
    PositionManager.validateGridSize(row_number, col_number);

    const geometry = PositionManager.calculateGridGeometry(row_number);
    const deviceType = options.deviceType ?? this._sceneLayoutDeviceType;
    const sceneLayout = this.getSceneChromeLayout(deviceType);
    const mainViewport = options.includeUiChrome ? sceneLayout.mainViewport : { x: 0, y: 0 };

    this._Row_Number = row_number;
    this._Col_Number = col_number;
    this._scaleFactor = scaleFactor;
    this._layoutIncludesUiChrome = options.includeUiChrome ?? false;
    this._sceneLayoutDeviceType = deviceType;

    // Logical world size is fixed; screen scaling should not affect physics/world coordinates.
    this._gridOffsetX = mainViewport.x + geometry.offsetX;
    this._gridOffsetY = mainViewport.y + geometry.offsetY;
    this._GRID_SIZEX = geometry.sizeX;
    this._GRID_SIZEY = geometry.sizeY;
  }

  public Reset(): void {
    this._scaleFactor = 1;
    this._gridOffsetX = PositionManager.BASE_GRID_OFFSET_X;
    this._gridOffsetY = PositionManager.BASE_GRID_OFFSET_Y;
    this._GRID_SIZEX = PositionManager.BASE_GRID_SIZE_X;
    this._GRID_SIZEY = PositionManager.BASE_GRID_SIZE_Y;
    this._Row_Number = 4;
    this._Col_Number = 9;
    this._layoutIncludesUiChrome = false;
    this._sceneLayoutDeviceType = 'pc';
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
    return getGameSceneChromeLayout(LOGICAL_GAME_WIDTH, LOGICAL_GAME_HEIGHT, deviceType, true);
  }

  public getGameViewportBounds(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    return this.getSceneChromeLayout(deviceType).mainViewport;
  }

  public getSceneBounds(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    return this.getSceneChromeLayout(deviceType).sceneBounds;
  }

  public getGridBoundsInScene(deviceType: GameDeviceType = this._sceneLayoutDeviceType): Rect {
    const gridBounds = this.getGridBounds();
    if (this._layoutIncludesUiChrome) {
      return gridBounds;
    }

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
      right: this._gridOffsetX + this._GRID_SIZEX * this._Col_Number + PositionManager.WORLD_HORIZONTAL_MARGIN,
      top: -PositionManager.WORLD_VERTICAL_MARGIN,
      bottom: this._gridOffsetY + this._GRID_SIZEY * this._Row_Number + PositionManager.WORLD_VERTICAL_MARGIN,
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
    if (rowNumber > PositionManager.MAX_FULL_SIZE_ROW_NUMBER) {
      return {
        offsetX: PositionManager.BASE_GRID_OFFSET_X,
        offsetY: PositionManager.MAX_FULL_SIZE_GRID_OFFSET_Y,
        sizeX: PositionManager.BASE_GRID_SIZE_X,
        sizeY: PositionManager.COMPATIBLE_GRID_AREA_HEIGHT / rowNumber,
      };
    }

    let offsetY = PositionManager.BASE_GRID_OFFSET_Y;
    if (rowNumber === PositionManager.MAX_FULL_SIZE_ROW_NUMBER) {
      offsetY = PositionManager.MAX_FULL_SIZE_GRID_OFFSET_Y;
    } else if (rowNumber <= 5) {
      offsetY = PositionManager.BASE_GRID_OFFSET_Y
        + (5 - rowNumber) * (PositionManager.BASE_GRID_SIZE_Y * 2 / 3);
    }

    return {
      offsetX: PositionManager.BASE_GRID_OFFSET_X,
      offsetY,
      sizeX: PositionManager.BASE_GRID_SIZE_X,
      sizeY: PositionManager.BASE_GRID_SIZE_Y,
    };
  }
}
