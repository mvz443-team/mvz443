/**
 * 全局实体查找表。
 *
 * 快照恢复时，`attacking` / `underAttackBy` / `dealer` 等字段保存的是实体 id，
 * 需要解析回仍然存活的实体对象。各管理器注册自己的实体来源，
 * 避免恢复逻辑直接依赖具体 Manager 造成循环引用。
 */

export interface LookupEntity {
  readonly SnapshotId: string;
}

type EntityProvider = () => readonly unknown[];

const providers: EntityProvider[] = [];

export function registerEntityLookupProvider(provider: EntityProvider): void {
  if (!providers.includes(provider)) providers.push(provider);
}

export function clearEntityLookupProviders(): void {
  providers.length = 0;
}

export function resolveEntityBySnapshotId(snapshotId: string): unknown {
  for (const provider of providers) {
    for (const entity of provider()) {
      if ((entity as Partial<LookupEntity>)?.SnapshotId === snapshotId) {
        return entity;
      }
    }
  }
  return undefined;
}
