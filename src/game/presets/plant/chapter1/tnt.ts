import type { EntityRandom } from "../../../core/DeterministicRandom";
import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { AlphaBlinkSfx } from "../../../sfx/flash/AlphaBlinkSfx";
import CombatManager from "../../../managers/CombatManager";
import type { ModelHost } from "../../../core/logic/LogicModel";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import type { JsonValue } from "../../../core/SimulationState";

const TNT_EVENTS = {
  ClusterExplosion: "TntClusterExplosion",
} as const;

export class TntModel extends PlantModel {
  public override pid = 7;
  public override nameKey = 'name_tnt';
  public override descriptionKey = 'tnt_description';
  public override texturePath = 'plant/tnt';

  public maxHealth = new LevelScaledValue(2000).setThreshold(1, 2000); // SECKILL 高血量
  public cost = new LevelScaledValue(150);

  public cooldown = new LevelScaledValue(50000).setIncRatio(0.85);
  public cooldownStartAtRatio = 0.5;

  public damage = new LevelScaledValue(1400).setIncRatio(1.35);
  public isNightPlant = false;

  /** 7 级集束炸弹的二次爆炸状态；与主爆炸分开，避免被主爆炸防重入字段拦截。 */
  public hasClusterExploded = false;

  public override get tickEventNames(): readonly string[] {
    return [
      ...DEFAULT_TICK_EVENT_NAMES,
      TNT_EVENTS.ClusterExplosion,
    ];
  }

  public override createEntity(scene: Game, col: number, row: number, level: number): TntEntity {
    return this.initializeEntity(new TntEntity(scene, col, row, level));
  }

  public override onCreate(entity: TntEntity): void {
    // 计算伤害值
    let baseDamage = this.damage.getValueAt(entity.level);
    if (entity.level >= 5) {
      baseDamage *= 1.3;
    }
    entity.explosionDamage = baseDamage;

    // 闪烁效果（表现层）
    SfxCmd.Create(AlphaBlinkSfx, {
      scene: entity.scene,
      targets: entity.mainSprite,
      from: 1,
      to: 0.2,
      duration: 300,
      yoyo: true,
      repeat: 3,
    });

    // 倒计时爆炸（游戏逻辑），使用 tickmanager
    entity.model.tickmanager.delayedCall({
      delay: 850,
      callback: () => {
        this.primaryExplosion(entity);
      }
    });

    // 7 级起，TNT 在第一次爆炸后留下集束炸弹；3 秒后二次爆炸再销毁。
    // 低等级仍按原节奏在第一次爆炸后 50ms 销毁。
    if (entity.level < 7) {
      entity.model.tickmanager.delayedCall({
        delay: 900,
        callback: () => {
          entity.destroy();
        }
      });
    }
  }

  /** 爆炸效果由 Model 定义。 */
  public primaryExplosion(host: ModelHost): void {
    if (this.hasExploded) return;
    this.hasExploded = true;
    host.createExplosion({
      damage: host.explosionDamage,
      rightGrid: 1.5,
      leftGrid: 1.5,
      upGrid: 1,
      faction: host.faction,
      dealer: host,
    });

    if (this.level >= 7) {
      this.tickmanager.schedule(TNT_EVENTS.ClusterExplosion, 3000);
    }
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === TNT_EVENTS.ClusterExplosion) {
      this.clusterExplosion();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private clusterExplosion(): void {
    if (this.hasClusterExploded) return;
    this.hasClusterExploded = true;

    const host = this.host;
    if (!host) return;
    host.createExplosion({
      damage: this.explosionDamage,
      rightGrid: 1.5,
      leftGrid: 1.5,
      upGrid: 1,
      faction: host.faction,
      dealer: host,
    });
    host.destroySelf();
  }

  public override onStarShards(_entity: TntEntity): void {
    // TNT cannot use Star Shards.
  }
}

export const TntData = new TntModel();

export class TntEntity extends PlantEntity {
  public explosionDamage: number = 0;
  public random: EntityRandom;
  public game: Game;
  public declare mainSprite: Phaser.GameObjects.Sprite;

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, TntData, level);
    this.random = this.initializeEntityRandom("tnt", CombatManager.Instance.seed * 5);
    this.game = scene;
  }

  protected override buildView() {
    const size = PositionManager.Instance.getPlantDisplaySize();

    this.mainSprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);

    this.viewGroup.add(this.mainSprite);
  }

}

export default TntData;
