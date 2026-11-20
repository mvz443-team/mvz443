import seedrandom from "seedrandom";

interface StatefulAlea extends seedrandom.PRNG {
  state(): seedrandom.State.Alea;
  state(next: seedrandom.State.Alea): void;
}

export type EntityRandom = StatefulAlea;

/**
 * seedrandom 的 alea state() 只有 getter，传入 state 只是“下次调用时重播种”，
 * 调用方无法读取/写回当前状态。这里用一个闭包包装器提供即时可读写的 state。
 */
/**
 * 用 seed + 可选 alea 内部状态构造随机流。
 *
 * seedrandom 的 alea `.state()` 是只读 getter：向它传 state 只会被静默忽略，
 * 得到的仍是按 seed 重新播种的全新随机流。恢复快照时必须把状态交给工厂，
 * 在构造阶段直接载入，否则回滚/重连后随机序列必然与源端分叉。
 */
export function createAleaWithState(
  seed: string,
  state?: seedrandom.State.Alea,
): seedrandom.StatefulPRNG<seedrandom.State.Alea> {
  return state
    ? seedrandom.alea(seed, { state: { ...state } })
    : seedrandom.alea(seed, { state: true });
}

function createStatefulAlea(seed: string): EntityRandom {
  let generator = createAleaWithState(seed);
  const random = (() => generator()) as EntityRandom;
  random.int32 = () => generator.int32();
  random.double = () => generator.double();
  random.quick = () => generator();
  random.state = ((next?: seedrandom.State.Alea) => {
    if (next !== undefined) {
      generator = createAleaWithState(seed, next);
      return undefined;
    }
    return { ...generator.state() };
  }) as EntityRandom["state"];
  return random;
}

/** 稳定身份派生出独立实体随机流；seed 由战局 seed / 用途 / 实体身份组成。 */
export function createEntityRandom(worldSeed: number, salt: string, identity: string): EntityRandom {
  return createStatefulAlea(`${worldSeed}:${salt}:${identity}`);
}

export function copyRandomState(random: EntityRandom): seedrandom.State.Alea {
  return { ...random.state() };
}

export function restoreRandomState(random: EntityRandom, state: seedrandom.State.Alea): void {
  random.state({ ...state });
}

/** 实体取得稳定 SnapshotId 后调用，确保同类多实例使用独立随机流。 */
export function reseedEntityRandom(
  random: EntityRandom,
  worldSeed: number,
  salt: string,
  identity: string,
): void {
  restoreRandomState(random, createEntityRandom(worldSeed, salt, identity).state());
}
