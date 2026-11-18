import type { ProjectileModel } from "../../models/projectiles/ProjectileModels";

type ProjectileModelCtor = new () => ProjectileModel<any, any>;

/**
 * 投射物模型工厂表。
 *
 * 断线重连后内存里的 `rebuildFactories` 已经不存在，只能用快照中保存的
 * 稳定 kind 重新构造模型。禁止使用 constructor.name：生产构建会压缩类名。
 */
const factories = new Map<string, ProjectileModelCtor>();

export function registerProjectileModel(kind: string, ctor: ProjectileModelCtor): void {
  if (!kind) throw new Error("projectile kind 不能为空");
  factories.set(kind, ctor);
}

export function createProjectileModel(kind: string): ProjectileModel<any, any> | null {
  const ctor = factories.get(kind);
  return ctor ? new ctor() : null;
}

export function hasProjectileModel(kind: string): boolean {
  return factories.has(kind);
}
