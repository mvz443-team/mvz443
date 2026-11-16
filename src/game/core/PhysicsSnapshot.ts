/**
 * Rapier 世界恢复后，把实体与新的 RigidBody 句柄重新绑定。
 *
 * Rapier 的 `World.restoreSnapshot()` 会返回一个全新的 World，
 * 旧 World 上的 JS 句柄全部失效；快照中的 handle 索引保持不变，
 * 因此可以用 handle 重新取回刚体，并补回不参与序列化的 userData。
 */

type RigidBodyLike = {
  handle: number;
  userData?: unknown;
  setTranslation?: (position: { x: number; y: number }, wake: boolean) => void;
};

type WorldLike = {
  getRigidBody: (handle: number) => RigidBodyLike | undefined;
};

export interface PhysicsBoundEntity {
  rigidBody: RigidBodyLike | null;
}

const bindings = new Map<number, PhysicsBoundEntity>();

/** 记录实体与刚体 handle 的绑定，供世界恢复后重绑。 */
export function rememberRigidBody(entity: PhysicsBoundEntity & { rigidBody: RigidBodyLike | null }): void {
  if (!entity.rigidBody) return;
  bindings.set(entity.rigidBody.handle, entity);
}

/** 世界恢复后重建实体 -> 刚体引用，并补回碰撞分发所需的 userData。 */
export function rebindPhysicsEntities(world: WorldLike): { rebound: number; lost: number } {
  let rebound = 0;
  let lost = 0;
  for (const [handle, entity] of bindings) {
    const body = world.getRigidBody(handle);
    if (!body) {
      entity.rigidBody = null;
      lost += 1;
      continue;
    }
    entity.rigidBody = body;
    body.userData = entity;
    rebound += 1;
  }
  return { rebound, lost };
}

export function clearPhysicsBindings(): void {
  bindings.clear();
}

/** 从绑定表中移除已销毁实体。 */
export function forgetRigidBody(entity: PhysicsBoundEntity): void {
  if (!entity.rigidBody) return;
  bindings.delete(entity.rigidBody.handle);
}
