import { ObstacleEntity } from "../../models/entities/ObstacleEntity";
import { BaseManager } from "../BaseManager";

export default class ObstacleManager extends BaseManager {
  private static _instance: ObstacleManager;

  public ObstaclesMap: Map<string, Array<ObstacleEntity>> = new Map();
  public ObstaclesByLane: Map<number, Array<ObstacleEntity>> = new Map();

  constructor() {
    super();
    this.ObstaclesMap = new Map();
    this.ObstaclesByLane = new Map();
  }

  public Load(): void { }

  public Reset(): void {
    this.ObstaclesMap.clear();
    this.ObstaclesByLane.clear();
  }

  public static get Instance(): ObstacleManager {
    if (!this._instance) {
      this._instance = new ObstacleManager();
    }
    return this._instance;
  }

  public RegisterObstacle(obstacle: ObstacleEntity) {
    const key = `${obstacle.col}-${obstacle.row}`;
    if (!this.ObstaclesMap.has(key)) {
      this.ObstaclesMap.set(key, [obstacle]);
    } else {
      this.ObstaclesMap.get(key)?.push(obstacle);
    }

    this.RegisterObstacleLaneAlias(obstacle, obstacle.row);
  }

  public RegisterObstacleLaneAlias(obstacle: ObstacleEntity, row: number) {
    if (!this.ObstaclesByLane.has(row)) {
      this.ObstaclesByLane.set(row, [obstacle]);
    } else {
      this.ObstaclesByLane.get(row)?.push(obstacle);
    }
  }

  public UnregisterObstacle(obstacle: ObstacleEntity) {
    const key = `${obstacle.col}-${obstacle.row}`;
    const list = this.ObstaclesMap.get(key);
    if (!list) return;

    const index = list.indexOf(obstacle);
    if (index >= 0) {
      list.splice(index, 1);
    }
    if (list.length === 0) {
      this.ObstaclesMap.delete(key);
    }

    this.UnregisterObstacleLaneAlias(obstacle, obstacle.row);
  }

  public UnregisterObstacleLaneAlias(obstacle: ObstacleEntity, row: number) {
    const laneObstacles = this.ObstaclesByLane.get(row);
    if (!laneObstacles) return;

    const laneIndex = laneObstacles.indexOf(obstacle);
    if (laneIndex >= 0) {
      laneObstacles.splice(laneIndex, 1);
    }
    if (laneObstacles.length === 0) {
      this.ObstaclesByLane.delete(row);
    }
  }

  public GetObstaclesByLane(row: number): Array<ObstacleEntity> | undefined {
    return this.ObstaclesByLane.get(row);
  }

  public GetObstacles(col: number, row: number): ObstacleEntity[] {
    return [...(this.ObstaclesMap.get(`${col}-${row}`) ?? [])];
  }

  public HasObstacle(col: number, row: number): boolean {
    return this.GetObstacles(col, row).length > 0;
  }
}
