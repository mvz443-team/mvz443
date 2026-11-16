import { ProjectileEntity } from "../../models/entities/ProjectileEntity";
import { ProjectileModel, BulletModel, BulletConfig, ExplosionModel, ExplosionConfig, LaserModel, LaserConfig } from "../../models/projectiles/ProjectileModels";
import type { Game } from "../../scenes/Game";
import { DeferredManager } from "../../managers/DeferredManager";
import type { EntityLogicState, RestoreContext } from "../../core/SimulationState";

export namespace ProjectileCmd {
  // 类型辅助：从模型推导出配置类型
  type ConfigOf<TModel extends ProjectileModel<any, any>> = TModel extends ProjectileModel<infer TConfig, any> ? TConfig : never;

  /**
   * 活跃投射物注册表。
   * 投射物不进入 Manager 的 Map，但会参与碰撞与伤害，因此必须可快照/可恢复。
   */
  const activeProjectiles = new Set<ProjectileEntity<any>>();
  /** 快照 id -> 重建工厂；仅保留最近一批，支持回滚复活刚销毁的投射物。 */
  const rebuildFactories = new Map<string, () => ProjectileEntity<any>>();
  const MAX_REBUILD_FACTORIES = 512;

  export function getActiveProjectiles(): readonly ProjectileEntity<any>[] {
    // 顺手裁剪已销毁实体
    for (const entity of [...activeProjectiles]) {
      if (!entity.IsAlive) activeProjectiles.delete(entity);
    }
    return [...activeProjectiles];
  }

  export function captureProjectileSnapshots(): EntityLogicState[] {
    return getActiveProjectiles().map((entity) => {
      const snapshot = entity.captureSnapshot();
      return { ...snapshot, kind: "projectile" };
    });
  }

  /**
   * 就地恢复投射物。
   * 快照中不存在但当前仍存活的投射物会被销毁（回滚点之后才生成的）；
   * 快照中存在但已销毁的投射物无法无中生有，会写入 missing 供诊断。
   */
  export function restoreProjectileSnapshots(
    snapshots: EntityLogicState[],
    context: RestoreContext,
  ): void {
    const byId = new Map(snapshots.map((snapshot) => [String(snapshot.id), snapshot]));
    for (const entity of getActiveProjectiles()) {
      if (!byId.has(entity.SnapshotId)) {
        entity.destroy();
        activeProjectiles.delete(entity);
      }
    }
    for (const snapshot of snapshots) {
      let target = getActiveProjectiles().find((entity) => entity.SnapshotId === String(snapshot.id));
      if (!target) {
        const factory = rebuildFactories.get(String(snapshot.id));
        if (!factory) {
          context.report.missing.push(`projectile:${snapshot.id}`);
          continue;
        }
        target = factory();
        activeProjectiles.add(target);
        context.report.restored.push(`projectile.rebuilt:${snapshot.id}`);
      }
      target.restoreSnapshot(snapshot, context);
    }
  }

  export function clearProjectiles(): void {
    for (const entity of [...activeProjectiles]) {
      entity.destroy();
    }
    activeProjectiles.clear();
    rebuildFactories.clear();
  }

  /**
   * 通用投射物创建方法 - 通过模型类型自动推导配置类型
   * @param model 投射物模型实例
   * @param scene 当前场景
   * @param x 初始X坐标
   * @param row 初始行
   * @param cfg 配置参数
   *
   * @example
   * Create(new BulletModel(), scene, 100, 2, bulletConfig)
   * Create(new ExplosionModel(), scene, 100, 2, explosionConfig)
   */
  export function Create<TModel extends ProjectileModel<any, any>>(
    model: TModel,
    scene: Game,
    x: number,
    row: number,
    cfg: ConfigOf<TModel>
  ) {
    DeferredManager.Instance.defer(() => {
      const entity = model.createEntity(scene, x, row, cfg) as ProjectileEntity<any>;
      activeProjectiles.add(entity);
      // 保存重建所需上下文（同进程回滚/重放使用），并用稳定 key 对齐快照计时器组。
      const snapshotId = entity.SnapshotId;
      rebuildFactories.set(snapshotId, () => {
        const rebuilt = model.createEntity(scene, x, row, cfg) as ProjectileEntity<any>;
        rebuilt.adoptStableTimerKey(snapshotId);
        return rebuilt;
      });
      if (rebuildFactories.size > MAX_REBUILD_FACTORIES) {
        const oldest = rebuildFactories.keys().next().value;
        if (oldest !== undefined) rebuildFactories.delete(oldest);
      }
    });
  }

  /**
   * 快捷创建子弹
   */
  export function CreateBullet(
    scene: Game,
    x: number,
    row: number,
    cfg: BulletConfig
  ) {
    const model = new BulletModel();
    Create(model, scene, x, row, cfg);
  }

  /**
   * 快捷创建爆炸
   */
  export function CreateExplosion(
    scene: Game,
    x: number,
    row: number,
    cfg: ExplosionConfig
  ) {
    const model = new ExplosionModel();
    Create(model, scene, x, row, cfg);
  }

  /**
   * 快捷创建激光
   */
  export function CreateLaser(
    scene: Game,
    x: number,
    row: number,
    cfg: LaserConfig
  ) {
    const model = new LaserModel();
    Create(model, scene, x, row, cfg);
  }
}
