import PlantsManager from "../../../managers/combat/PlantsManager";
import type { EntityRandom } from "../../../core/DeterministicRandom";
import { GetDecValue, LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { ArcSfx } from "../../../sfx/arc/ArcSfx";
import { DirtOutSfx } from "../../../sfx/dirt/DirtOutSfx";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { Faction } from "../../../models/Enum";
import { CollisionContext } from "../../../types";
import CombatManager from "../../../managers/CombatManager";
import { DeferredManager } from "../../../managers/DeferredManager";
import { CombatEntity } from "../../../models/core/CombatEntity";
import { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { ModelHost } from "../../../core/logic/LogicModel";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import type { JsonValue } from "../../../core/SimulationState";
import MobManager from "../../../managers/combat/MobManager";

type VaultingMonster = MonsterEntity & {
  canVaultOverPlant?: (target: PlantEntity) => boolean;
};

const TNT_MINES_EVENTS = {
  Wakeup: "TntMinesWakeup",
  SpawnMine: "TntMinesSpawnMine",
} as const;

type TntContactResult = "explode" | "ignore";

export class TntMinesModel extends PlantModel {
  public override pid = 4;
  public override nameKey = 'name_tnt_mines';
  public override descriptionKey = 'tnt_mines_description';
  public override texturePath = 'plant/tnt_mines';

  public maxHealth = new LevelScaledValue(400);
  public cost = new LevelScaledValue(25);

  public cooldown = new LevelScaledValue(30000).setThreshold(5, 25000);
  public cooldownStartAtRatio = 0.5;

  public damage = new LevelScaledValue(1500);

  public override readonly tickEventNames: readonly string[] = [
    ...DEFAULT_TICK_EVENT_NAMES,
    TNT_MINES_EVENTS.Wakeup,
    TNT_MINES_EVENTS.SpawnMine,
  ];

  /** 地雷爆炸效果由 Model 定义。 */
  public explode(host: ModelHost, level: number): void {
    if (host.hasExploded) return;
    host.hasExploded = true;
    host.createExplosion({
      damage: this.damage.getValueAt(level),
      rightGrid: level >= 9 ? 1.5 : 1,
      leftGrid: 0.5,
      upGrid: 0,
      faction: host.faction,
      dealer: host,
    });
    host.destroySelf();
  }

  /** 接触判定统一在 Model：爆炸、等待飞行单位落地、或忽略。 */
  public handleContact(host: TntMinesEntity, target: unknown): TntContactResult {
    if (this.isBuried || this.hasExploded) return "ignore";
    if (!(target instanceof CombatEntity)) return "ignore";
    if (target.faction === host.faction) return "ignore";

    if (target instanceof MonsterEntity) {
      if (target.model.inVoid) return "ignore";
      if (canVaultOverMine(target, host)) return "ignore";
      // 飞行单位从上方经过不引爆；落地后重新进入碰撞范围才会触发。
      if (target.model.flying) return "ignore";
    }
    return "explode";
  }

  /**
   * 出土瞬间的一次性接触判定（不做每帧轮询）。
   *
   * 只检查本行、本格范围内的怪物；结果只取决于"是否有可引爆目标"，
   * 与遍历顺序无关，因此回滚重放不会分叉。
   */
  public checkContactOnce(host: TntMinesEntity): void {
    if (this.isBuried || this.hasExploded || host.currentHealth <= 0) return;

    const range = PositionManager.Instance.GRID_SIZEX * 0.5;
    const mobs = MobManager.Instance.MobsByLane.get(host.row);
    if (!mobs) return;
    for (const mob of mobs) {
      if (!(mob instanceof MonsterEntity)) continue;
      if (mob.currentHealth <= 0 || mob.model.isDying) continue;
      if (Math.abs(mob.x - host.x) > range) continue;
      if (this.handleContact(host, mob) !== "explode") continue;
      this.explode(host, host.level);
      return;
    }
  }

  public isNightPlant = false;
  /** 只能在普通地面种植：不能种在水面，因此也无法种在睡莲上。 */
  public override allowedPlantSlots = ['ground'] as const;

  constructor() {
    super();
    // 低矮植物：只有带 tiny 的投射物能命中。
    this.tiny = true;
  }

  public override createEntity(scene: Game, col: number, row: number, level: number): TntMinesEntity {
    return this.initializeEntity(new TntMinesEntity(scene, col, row, level));
  }

  public override onCreate(entity: TntMinesEntity): void {
    const buriedTime = GetDecValue(15000, 0.8, entity.level);
    this.tickmanager.schedule(TNT_MINES_EVENTS.Wakeup, buriedTime);
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === TNT_MINES_EVENTS.Wakeup) {
      const entity = this.host as TntMinesEntity | null;
      if (entity) {
        entity.wakeup();
        // 出土瞬间一次性补判：碰撞事件只在 overlap-start 派发，
        // 埋藏期间已经重叠的怪物不会在出土后重发事件。
        this.checkContactOnce(entity);
      }
      return;
    }
    if (eventName === TNT_MINES_EVENTS.SpawnMine) {
      this.spawnMineFromEvent(args);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private spawnMineFromEvent(args: JsonValue): void {
    const host = this.host as TntMinesEntity | null;
    if (!host || !args || typeof args !== "object" || Array.isArray(args)) return;

    const { col, row, level } = args as Record<string, JsonValue>;
    if (typeof col !== "number" || typeof row !== "number" || typeof level !== "number") return;

    DeferredManager.Instance.defer(() => {
      const newMine = this.createEntity(host.scene, col, row, level);
      newMine.wakeup();
    });
  }

  public override onStarShards(entity: TntMinesEntity): void {
    if (entity.game) {
      // 立刻出土
      entity.wakeup();

      const scene = entity.game;
      let leftCount = 2;

      // 记录目标位置
      const targetPositions: { x: number; y: number; col: number; row: number }[] = [];
      const usedRows = new Set<number>();
      const usedCols = new Set<number>();

      // 第一遍：保证分布在不同的行和列中
      for (let col = PositionManager.Instance.Col_Number - 1; col >= 0 && leftCount > 0; col--) {
        const rows = Array.from({ length: PositionManager.Instance.Row_Number }, (_, i) => i);
        shuffleRows(rows, entity);

        for (const row of rows) {
          if (leftCount <= 0) break;
          const key = `${col}-${row}`;
          if (PlantsManager.Instance?.PlantsMap.has(key)) {
            const list = PlantsManager.Instance?.PlantsMap.get(key);
            if (list && list.length > 0) continue;
          }
          if (usedRows.has(row) || usedCols.has(col)) continue;

          const { x: tmpx, y: tmpy } = PositionManager.Instance.getPlantBottomCenter(col, row);
          targetPositions.push({ x: tmpx, y: tmpy, col: col, row: row });

          leftCount--;
          usedRows.add(row);
          usedCols.add(col);
        }
      }

      // 第二遍：如果不足，放宽限制
      if (leftCount > 0) {
        for (let col = PositionManager.Instance.Col_Number - 1; col >= 0 && leftCount > 0; col--) {
          const rows = Array.from({ length: PositionManager.Instance.Row_Number }, (_, i) => i);
          shuffleRows(rows, entity);

          for (const row of rows) {
            if (leftCount <= 0) break;
            const key = `${col}-${row}`;
            if (PlantsManager.Instance?.PlantsMap.has(key)) {
              const list = PlantsManager.Instance?.PlantsMap.get(key);
              if (list && list.length > 0) continue;
            }
            const { x: tmpx, y: tmpy } = PositionManager.Instance.getPlantBottomCenter(col, row);
            if (targetPositions.some(pos => pos.x === tmpx && pos.y === tmpy)) continue;
            targetPositions.push({ x: tmpx, y: tmpy, col: col, row: row });

            leftCount--;
          }
        }
      }

      // 开始放置
      const arcDuration = 1000;
      for (const pos of targetPositions) {
        SfxCmd.Create(ArcSfx, {
          scene,
          x1: entity.x, y1: entity.y,
          x2: pos.x, y2: pos.y,
          texture: 'plant/tnt_mines',
          duration: arcDuration,
        });
        this.tickmanager.schedule(TNT_MINES_EVENTS.SpawnMine, arcDuration, {
          args: { col: pos.col, row: pos.row, level: entity.level },
        });
      }
    }
  }
}

export const TntMinesData = new TntMinesModel();

export class TntMinesEntity extends PlantEntity {
  public declare model: TntMinesModel;
  /** 逻辑状态由 Model 持有。 */
  public declare isBuried: boolean;
  public declare hasExploded: boolean;
  public random: EntityRandom;

  private declare buriedSprite: Phaser.GameObjects.Sprite;
  private declare mainSprite: Phaser.GameObjects.Sprite;
  private colliderZombie: Phaser.Physics.Arcade.Collider | null = null;
  public game: Game;

  // Flying monsters whose overlap-start was skipped while airborne. We re-check
  // them each step in case they land while still over the mine — Rapier only
  // dispatches `started` events so the landing alone wouldn't re-trigger.

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, TntMinesData, level);
    this.isBuried = true;
    this.hasExploded = false;
    this.random = this.initializeEntityRandom("tnt_mines", CombatManager.Instance.seed * 3);
    this.game = scene;
  }

  protected override buildView() {
    const size = PositionManager.Instance.getPlantDisplaySize();

    // 埋藏状态：显示泥土
    this.buriedSprite = this.scene.add.sprite(this.x, this.y, 'anime/dirt_out', 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);

    // 主体：TNT 炸弹
    this.mainSprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth)
      .setVisible(false);

    this.viewGroup.addMultiple([this.buriedSprite, this.mainSprite]);
  }

  public wakeup(): void {
    if (this.currentHealth > 0 && this.model.isBuried && this.game) {
      this.model.isBuried = false;

      this.buriedSprite.setVisible(false);
      SfxCmd.Create(DirtOutSfx, {
        scene: this.game,
        col: this.col,
        row: this.row,
        onComplete: () => this.mainSprite.setVisible(true),
      });
    }
  }

  public override onHurt(damage: number, realDamage: number, dealer?: any, source?: any): void {
    if (this.model.isBuried) {
      // 埋藏时受伤正常减血
      super.onHurt(damage, realDamage, dealer, source);
    } else {
      // 出土后立即爆炸
      this.model.explode(this, this.level);
    }
  }

  public override onCollision(ctx: CollisionContext): void {
    if (this.currentHealth <= 0) return;

    if (this.model.handleContact(this, ctx.targetEntity) === "explode") {
      this.model.explode(this, this.level);
    }
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    if (!this.viewGroup?.children) return;

    const buried = this.model.isBuried && this.currentHealth > 0;
    this.buriedSprite?.setVisible(buried);
    this.mainSprite?.setVisible(!buried && this.currentHealth > 0);
  }

}

function canVaultOverMine(monster: MonsterEntity, mine: PlantEntity): boolean {
  return (monster as VaultingMonster).canVaultOverPlant?.(mine) === true;
}

function shuffleRows(rows: number[], entity: TntMinesEntity): void {
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const target = Math.floor(entity.random() * (index + 1));
    [rows[index], rows[target]] = [rows[target], rows[index]];
  }
}

export default TntMinesData;
