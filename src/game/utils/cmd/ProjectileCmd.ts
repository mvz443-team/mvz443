import { ProjectileEntity } from "../../models/entities/ProjectileEntity";
import { ProjectileModel, ExplosionModel, ExplosionConfig, LaserModel, LaserConfig } from "../../models/projectiles/ProjectileModels";
import type { Game } from "../../scenes/Game";
import { DeferredManager } from "../../managers/DeferredManager";
import type { EntityLogicState, JsonValue, RestoreContext } from "../../core/SimulationState";
import { createProjectileModel } from "./ProjectileModelRegistry";

export namespace ProjectileCmd {
  /** 模型构造器类型（投射物模型均无需构造参数）。 */
  type ModelClass<TModel extends ProjectileModel<any, any>> = new () => TModel;
  // 类型辅助：从模型推导出配置类型
  type ConfigOf<TModel extends ProjectileModel<any, any>> = TModel extends ProjectileModel<infer TConfig, any> ? TConfig : never;

  interface ProjectileRebuildInfo {
    kind: string;
    x: number;
    row: number;
    cfg: Record<string, JsonValue>;
    dealerId: string | null;
  }

  /**
   * 活跃投射物注册表。
   * 投射物不进入 Manager 的 Map，但会参与碰撞与伤害，因此必须可快照/可恢复。
   */
  const activeProjectiles = new Set<ProjectileEntity<any>>();
  /** 快照 id -> 同进程重建工厂；只保留最近一批，支持回滚复活刚销毁的投射物。 */
  const rebuildFactories = new Map<string, () => ProjectileEntity<any> | null>();
  /** 同进程回滚时保留原始 dealer 引用，避免关系解析依赖重建顺序。 */
  const liveDealers = new Map<string, unknown>();
  /** 快照 id -> 跨进程重建所需的纯数据描述。 */
  const rebuildInfo = new Map<string, ProjectileRebuildInfo>();
  const MAX_REBUILD_FACTORIES = 512;
  let activeScene: Game | null = null;

  /**
   * 确定性投射物序号。
   *
   * 不能使用 lodash uniqueId：它会随本机创建/回滚/预测次数漂移，页面刷新后
   * 更是从 0 重新计数，导致两端实体 id 不同、哈希必然分叉。
   */
  let nextProjectileSeq = 1;

  export function setScene(scene: Game): void {
    activeScene = scene;
  }

  export function captureSequence(): number {
    return nextProjectileSeq;
  }

  export function restoreSequence(value: number): void {
    nextProjectileSeq = Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
  }

  export function resetSequence(): void {
    nextProjectileSeq = 1;
  }

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
      const info = rebuildInfo.get(entity.SnapshotId);
      return {
        ...snapshot,
        kind: "projectile",
        extra: {
          ...snapshot.extra,
          // extra 不参与跨端哈希，只用于恢复重建。
          projectile: info ? infoToJson(info) : null,
        },
      };
    });
  }

  /**
   * 就地恢复投射物。
   * 快照中不存在但当前仍存活的投射物会被销毁（回滚点之后才生成的）；
   * 快照中存在但已销毁的投射物优先用内存工厂重建，页面刷新后则用
   * 快照正文里的 kind/cfg 描述重建。
   */
  export function restoreProjectileSnapshots(
    snapshots: EntityLogicState[],
    context: RestoreContext,
  ): void {
    const byId = new Map(snapshots.map((snapshot) => [String(snapshot.id), snapshot]));
    // 一次遍历建立 id→entity 索引，避免对每个快照重复调用 getActiveProjectiles().find()
    // 造成的 O(n²) 扫描与临时数组分配。
    const activeById = new Map<string, ProjectileEntity<any>>();
    for (const entity of getActiveProjectiles()) {
      activeById.set(entity.SnapshotId, entity);
      if (!byId.has(entity.SnapshotId)) {
        // 回滚删除是“从未存在过”，不能触发投射物命中/爆炸等业务死亡逻辑。
        entity.destroySilently();
        activeById.delete(entity.SnapshotId);
      }
    }
    for (const snapshot of snapshots) {
      let target: ProjectileEntity<any> | null | undefined = activeById.get(String(snapshot.id));
      if (!target) {
        const info = readRebuildInfo(snapshot) ?? rebuildInfo.get(String(snapshot.id)) ?? null;
        const factory = rebuildFactories.get(String(snapshot.id));
        target = factory ? factory() : rebuildFromInfo(info, context);
        if (!target) {
          context.report.missing.push(`projectile:${snapshot.id}`);
          continue;
        }
        // rebuildFromInfo 走纯数据重建，实体仍是构造时的临时 uniqueId；
        // 必须先 adopt 快照 id，再按 id 登记注册表/关系，否则跨进程恢复后
        // 投射物 id、timer group 和 dealer 解析全部错位。
        target.adoptStableSnapshotKey(String(snapshot.id));
        activeProjectiles.add(target);
        activeById.set(target.SnapshotId, target);
        context.report.restored.push(`projectile.rebuilt:${snapshot.id}`);
      }
      target.restoreSnapshot(snapshot, context);
      const info = rebuildInfo.get(target.SnapshotId) ?? readRebuildInfo(snapshot);
      if (info) registerRebuild(target.SnapshotId, info, target.dealer);
    }
  }

  /**
   * 跨局清理：销毁残留投射物并复位序号。
   *
   * `projectile.seq` 会进入跨端哈希，页面不刷新连续开第二局时，上一局的
   * 序号和未销毁的投射物若残留，第二局第一帧两端摘要必然分叉。传入 scene
   * 时只清理属于该局的注册表，避免新旧场景交替时序误清新一局状态。
   */
  export function clearProjectiles(scene?: Game): void {
    if (scene && activeScene && activeScene !== scene) return;
    for (const entity of [...activeProjectiles]) {
      entity.destroySilently();
    }
    activeProjectiles.clear();
    rebuildFactories.clear();
    rebuildInfo.clear();
    liveDealers.clear();
    activeScene = null;
    resetSequence();
  }

  /**
   * 通用投射物创建方法 - 传入模型 class，配置类型自动推导
   * @param ModelClass 投射物模型类（引擎会在创建时实例化）
   * @param scene 当前场景
   * @param x 初始X坐标
   * @param row 初始行
   * @param cfg 初始化配置
   *
   * @example
   * Create(ArrowModel, scene, 100, 2, { damage: 20, faction })
   */
  export function Create<TModel extends ProjectileModel<any, any>>(
    ModelClass: ModelClass<TModel>,
    scene: Game,
    x: number,
    row: number,
    cfg: ConfigOf<TModel>
  ): void {
    const kind = (ModelClass as unknown as { projectileKind?: string }).projectileKind;
    if (!kind) {
      throw new Error("[ProjectileCmd] 投射物模型缺少稳定 projectileKind");
    }
    activeScene = scene;
    // 序号必须在命令执行时同步分配，不能等 DeferredManager flush；
    // 否则同一帧内多个命令的先后顺序会被渲染循环打乱。
    const seq = nextProjectileSeq++;
    const snapshotId = `projectile:${seq}`;
    const info = encodeRebuildInfo(kind, x, row, cfg as unknown as Record<string, unknown>);
    const dealer = (cfg as unknown as { dealer?: unknown }).dealer;

    DeferredManager.Instance.defer(() => {
      const model = new ModelClass();
      const entity = model.createEntity(scene, x, row, cfg) as ProjectileEntity<any>;
      entity.initializeEntity();
      entity.adoptStableSnapshotKey(snapshotId);
      activeProjectiles.add(entity);
      registerRebuild(snapshotId, info, dealer);
    });
  }

  /** 快捷创建爆炸：等价于 Create(ExplosionModel, ...) */
  export function CreateExplosion(
    scene: Game,
    x: number,
    row: number,
    cfg: ExplosionConfig
  ): void {
    Create(ExplosionModel, scene, x, row, cfg);
  }

  /** 快捷创建激光：等价于 Create(LaserModel, ...) */
  export function CreateLaser(
    scene: Game,
    x: number,
    row: number,
    cfg: LaserConfig
  ): void {
    Create(LaserModel, scene, x, row, cfg);
  }

  function registerRebuild(
    snapshotId: string,
    info: ProjectileRebuildInfo,
    dealer?: unknown,
  ): void {
    rebuildInfo.set(snapshotId, info);
    if (dealer) liveDealers.set(snapshotId, dealer);
    else liveDealers.delete(snapshotId);
    rebuildFactories.set(snapshotId, () => {
      if (!activeScene) return null;
      const model = createProjectileModel(info.kind);
      if (!model) return null;
      const cfg: Record<string, unknown> = { ...info.cfg };
      const liveDealer = liveDealers.get(snapshotId);
      if (liveDealer) cfg.dealer = liveDealer;
      const entity = model.createEntity(
        activeScene,
        info.x,
        info.row,
        cfg as never,
      ) as ProjectileEntity<any>;
      entity.initializeEntity();
      entity.adoptStableSnapshotKey(snapshotId);
      return entity;
    });
    if (rebuildFactories.size > MAX_REBUILD_FACTORIES) {
      const oldest = rebuildFactories.keys().next().value;
      if (oldest !== undefined) {
        rebuildFactories.delete(oldest);
        rebuildInfo.delete(oldest);
        liveDealers.delete(oldest);
      }
    }
  }

  function rebuildFromInfo(
    info: ProjectileRebuildInfo | null,
    context: RestoreContext,
  ): ProjectileEntity<any> | null {
    if (!info || !activeScene) return null;
    const model = createProjectileModel(info.kind);
    if (!model) return null;
    const entity = model.createEntity(
      activeScene,
      info.x,
      info.row,
      decodeConfig(info, context) as never,
    ) as ProjectileEntity<any>;
    entity.initializeEntity();
    return entity;
  }

  function encodeRebuildInfo(
    kind: string,
    x: number,
    row: number,
    cfg: Record<string, unknown>,
  ): ProjectileRebuildInfo {
    const values: Record<string, JsonValue> = {};
    let dealerId: string | null = null;
    for (const key of Object.keys(cfg)) {
      const value = cfg[key];
      if (key === "dealer") {
        const id = (value as { SnapshotId?: string } | null | undefined)?.SnapshotId;
        dealerId = typeof id === "string" ? id : null;
        continue;
      }
      const encoded = toJsonValue(value);
      if (encoded !== undefined) values[key] = encoded;
    }
    return { kind, x, row, cfg: values, dealerId };
  }

  function decodeConfig(
    info: ProjectileRebuildInfo,
    context: RestoreContext,
  ): Record<string, unknown> {
    const cfg: Record<string, unknown> = { ...info.cfg };
    if (info.dealerId) {
      cfg.dealer = context.resolveEntity?.(info.dealerId) ?? undefined;
    }
    return cfg;
  }

  function infoToJson(info: ProjectileRebuildInfo): JsonValue {
    return {
      kind: info.kind,
      x: info.x,
      row: info.row,
      cfg: info.cfg,
      dealerId: info.dealerId,
    };
  }

  function readRebuildInfo(snapshot: EntityLogicState): ProjectileRebuildInfo | null {
    const value = snapshot.extra.projectile;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, JsonValue>;
    const kind = record.kind;
    const x = record.x;
    const row = record.row;
    const cfg = record.cfg;
    if (typeof kind !== "string" || typeof x !== "number" || typeof row !== "number") return null;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
    const dealerId = record.dealerId;
    return {
      kind,
      x,
      row,
      cfg: cfg as Record<string, JsonValue>,
      dealerId: typeof dealerId === "string" ? dealerId : null,
    };
  }

  /** 只接受 JSON 安全的配置值；实体引用单独编码为 dealerId。 */
  function toJsonValue(value: unknown): JsonValue | undefined {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      const items: JsonValue[] = [];
      for (const item of value) {
        const encoded = toJsonValue(item);
        if (encoded !== undefined) items.push(encoded);
      }
      return items;
    }
    if (typeof value === "object") {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return undefined;
      const record: Record<string, JsonValue> = {};
      for (const key of Object.keys(value)) {
        const encoded = toJsonValue((value as Record<string, unknown>)[key]);
        if (encoded !== undefined) record[key] = encoded;
      }
      return record;
    }
    return undefined;
  }
}
