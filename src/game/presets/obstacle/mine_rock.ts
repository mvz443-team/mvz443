import DepthHelper from "../../utils/helper/DepthHelper";
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { PositionManager } from "../../managers/view/PositionManager";
import ObstacleManager from "../../managers/combat/ObstacleManager";
import { ObstacleModel } from "../../models/ObstacleModel";
import { ObstacleConfig, ObstacleEntity } from "../../models/entities/ObstacleEntity";
import type { Game } from "../../scenes/Game";
import ResourceCmd from "../../utils/cmd/ResourceCmd";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import { StarShardsOrbitSfx } from "../../sfx/star/StarShardsOrbitSfx";

export class MineRockObstacleModel extends ObstacleModel {
  public readonly oid = 2;
  public readonly nameKey = "MineRockObstacle";
  public readonly texturePath = "";

  public createEntity(scene: Game, col: number, row: number, config: ObstacleConfig): ObstacleEntity {
    return this.initializeEntity(new MineRockObstacleEntity(scene, col, row, this, config));
  }
}

export class MineRockObstacleEntity extends ObstacleEntity {
  private starOrbit: StarShardsOrbitSfx | null = null;
  private extraRow = -1;
  private dropped = false;
  private rectangle: Phaser.GameObjects.Rectangle | null = null;

  protected buildView(): void {
    const size = PositionManager.Instance.getPlantDisplaySize();
    const totalHeight = size.sizeY * 2 - 6;

    this.rectangle = this.scene.add.rectangle(this.x, this.y, size.sizeX, totalHeight, 0x4d4658)
      .setOrigin(0.5, 1)
      .setStrokeStyle(2, 0x9c8aa3)
      .setDepth(DepthHelper.Plant.sfx(this.baseDepth));

    this.viewGroup.add(this.rectangle);
  }

  public override initializeEntity(): this {
    if ((this as any).initialized) return this;
    (this as any).initialized = true;

    this.buildView();
    this.buildOwnPhysics();

    ObstacleManager.Instance.RegisterObstacle(this);
    this.extraRow = this.row + 1;
    if (this.extraRow < PositionManager.Instance.Row_Number) {
      const fakeKey = `${this.col}-${this.extraRow}`;
      const map = ObstacleManager.Instance.ObstaclesMap;
      if (!map.has(fakeKey)) {
        map.set(fakeKey, [this]);
      } else {
        map.get(fakeKey)?.push(this);
      }
    }

    this.starOrbit = SfxCmd.Create(StarShardsOrbitSfx, {
      scene: this.scene,
      baseDepth: this.baseDepth,
      viewGroup: this.viewGroup,
      getAnchor: () => ({ x: this.x, y: this.y - PositionManager.Instance.GRID_SIZEY * 0.5, active: true }),
    });

    this.model.onCreate(this);
    return this;
  }

  private buildOwnPhysics(): void {
    const physicBodySize = PositionManager.Instance.getPlantBodySize();
    const sizeX = physicBodySize.sizeX;
    const sizeY = physicBodySize.sizeY * 2 + (PositionManager.Instance.GRID_SIZEY - physicBodySize.sizeY);
    const centerX = this.x;
    const centerY = this.y - sizeY / 2;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(centerX, centerY);
    rigidBodyDesc.setUserData(this);
    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(sizeX / 2, sizeY / 2);
    colliderDesc.setSensor(true);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
  }

  public override destroy(): void {
    if (!this.dropped) {
      this.dropped = true;
      ResourceCmd.AddStarshardToAll(1);
    }
    this.starOrbit?.stop();
    this.starOrbit = null;

    if (this.extraRow >= 0 && this.extraRow < PositionManager.Instance.Row_Number) {
      const map = ObstacleManager.Instance.ObstaclesMap;
      const key = `${this.col}-${this.extraRow}`;
      const list = map.get(key);
      if (list) {
        const idx = list.indexOf(this);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) map.delete(key);
      }
    }

    super.destroy();
  }
}

export const MineRockObstacleData = new MineRockObstacleModel();
