import { DeferredManager } from "../../managers/DeferredManager";
import { ObstacleLibrary } from "../../managers/library/ObstacleLibrary";
import ObstacleManager from "../../managers/combat/ObstacleManager";
import { PositionManager } from "../../managers/view/PositionManager";
import { ObstacleConfig, ObstacleEntity } from "../../models/entities/ObstacleEntity";
import type { Game } from "../../scenes/Game";

namespace ObstacleCmd {
  export function createInGrid(
    oid: number,
    scene: Game,
    col: number,
    row: number,
    cfg: ObstacleConfig,
    callback?: (entity: ObstacleEntity) => void,
  ) {
    const { x } = PositionManager.Instance.getPlantBottomCenter(col, row);
    create(oid, scene, x, row, cfg, callback);
  }

  export function create(
    oid: number,
    scene: Game,
    x: number,
    row: number,
    cfg: ObstacleConfig,
    callback?: (entity: ObstacleEntity) => void,
  ) {
    DeferredManager.Instance.defer(() => {
      const model = ObstacleLibrary.GetModel(oid);
      if (!model) return;

      const col = Phaser.Math.Clamp(
        PositionManager.Instance.getColByX(x),
        0,
        PositionManager.Instance.Col_Number - 1,
      );
      const finalRow = Phaser.Math.Clamp(row, 0, PositionManager.Instance.Row_Number - 1);
      const entity = model.createEntity(scene, col, finalRow, cfg);
      // 障碍可能同格叠加，用创建时的确定性序号生成稳定快照 key。
      const existingCount = ObstacleManager.Instance.GetObstacles(col, finalRow).length;
      entity.adoptStableSnapshotKey(`obstacle:${oid}:${col}:${finalRow}:${existingCount}`);
      if (callback) callback(entity);
    });
  }
}

export default ObstacleCmd;
