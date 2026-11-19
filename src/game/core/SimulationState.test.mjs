import assert from 'node:assert/strict';
import test from 'node:test';

const core = await import('./SimulationState.ts');

const {
  StateRegistry,
  HashWriter,
  fnv1a32,
  fnv1a64,
  canonicalize,
  hashSimulationState,
  serializeSimulationState,
  deserializeSimulationState,
} = core;

function baseState(overrides = {}) {
  return {
    version: core.SIMULATION_STATE_VERSION,
    seed: 12345,
    frameId: 20,
    values: { 'combat.dayOrNight': true, resources: { 'energy:100': 150 } },
    timers: {
      ticker: [{ id: 7, targetFrame: 88, repeat: -1, interval: 4, group: 'entity_1' }],
    },
    prngs: [{ name: 'mob.alea', seed: '12345', state: { c: 1, s0: 0.1, s1: 0.2, s2: 0.3 } }],
    entities: [{
      kind: 'monster', id: 'entity_1', col: 3, row: 2, x: 12.5, y: 7.25,
      hp: 480, maxHp: 500, speed: 1.25,
      flags: { isFrozen: false, attackTimer: 6 },
      timers: [{ id: 7, targetFrame: 88, repeat: -1, interval: 4, group: 'entity_1' }],
      extra: {},
    }],
    physics: null,
    ...overrides,
  };
}

test('FNV 向量稳定，32/64 位哈希均为定长十六进制', () => {
  assert.equal(fnv1a32(new TextEncoder().encode('a')), 'e40c292c');
  assert.equal(fnv1a64(new TextEncoder().encode('a')).length, 16);
});

test('HashWriter 按 IEEE-754 位模式区分 -0 与 0，且不受对象键顺序影响', () => {
  const a = new HashWriter().value({ hp: 100, speed: 1.5 }).toBytes();
  const b = new HashWriter().value({ speed: 1.5, hp: 100 }).toBytes();
  assert.deepEqual([...a], [...b]);
  const positive = new HashWriter().f64(0).toBytes();
  const negative = new HashWriter().f64(-0).toBytes();
  assert.notDeepEqual([...positive], [...negative]);
});

test('同一逻辑状态在键顺序不同的情况下哈希一致', () => {
  const stateA = baseState();
  const stateB = baseState({
    values: { resources: { 'energy:100': 150 }, 'combat.dayOrNight': true },
    entities: [{
      ...stateA.entities[0],
      flags: { attackTimer: 6, isFrozen: false },
    }],
  });
  assert.deepEqual(hashSimulationState(stateA), hashSimulationState(stateB));
});

test('跨端哈希剔除表现消费游标、物理句柄与视觉事件队列', () => {
  const first = baseState({
    values: {
      'combat.dayOrNight': true,
      resources: { 'energy:100': 150 },
      'logic.events': { frame: 20, nextEventId: 1, events: [] },
      'ticker.frameInterval': 50,
    },
    entities: [{
      ...baseState().entities[0],
      flags: { isFrozen: false, attackTimer: 6, lastConsumedEventId: 3 },
      model: { visualFrameUntilFrame: 20, visualFrameValue: 1 },
      extra: { lastConsumedEventId: 3, rigidBodyHandle: 11, hasRigidBody: true },
    }],
  });
  const second = baseState({
    values: {
      'combat.dayOrNight': true,
      resources: { 'energy:100': 150 },
      'logic.events': {
        frame: 20,
        nextEventId: 99,
        events: [{ frame: 20, eventId: 98, type: 'sfx', sourceId: 'entity_1', data: null }],
      },
      // 固定常量即便被不同构建写成不同值，也不应影响跨端判定。
      'ticker.frameInterval': 999,
    },
    // 本机卡槽冷却/输入预演天然不同，不能进入跨端哈希。
    localValues: { cardpile: { cards: [{ pid: 1, leftMs: 1234 }] } },
    entities: [{
      ...baseState().entities[0],
      flags: { isFrozen: false, attackTimer: 6, lastConsumedEventId: 98 },
      model: { visualFrameUntilFrame: 999, visualFrameValue: 0 },
      extra: { lastConsumedEventId: 98, rigidBodyHandle: 42, hasRigidBody: false },
    }],
  });

  assert.equal(hashSimulationState(first).h64, hashSimulationState(second).h64);

  const modelChanged = baseState({
    values: {
      'combat.dayOrNight': true,
      resources: { 'energy:100': 150 },
      'logic.events': { frame: 20, nextEventId: 1, events: [] },
      'ticker.frameInterval': 50,
    },
    entities: [{
      ...baseState().entities[0],
      flags: { isFrozen: false, attackTimer: 7, lastConsumedEventId: 3 },
      extra: { lastConsumedEventId: 3, rigidBodyHandle: 11, hasRigidBody: true },
    }],
  });
  assert.notEqual(
    hashSimulationState(first).h64,
    hashSimulationState(modelChanged).h64,
    '真正影响战斗的 Model 字段仍必须进入哈希',
  );
});

test('TimerTriggered 的本机回调句柄不参与哈希，语义参数仍参与', () => {
  const timer = (args, kind = 'TimerTriggered') => ({
    id: 1,
    targetFrame: 24,
    repeat: -1,
    interval: 20,
    group: 'plant:0:0:1',
    kind,
    args,
  });
  const withTimer = (entry) => baseState({
    timers: { ticker: [] },
    entities: [{ ...baseState().entities[0], timers: [entry] }],
  });

  const handleA = withTimer(timer('callback:1'));
  const handleB = withTimer(timer('callback:99'));
  assert.equal(
    hashSimulationState(handleA).h64,
    hashSimulationState(handleB).h64,
    'callback:N 只是本机注册表句柄，不应导致跨端分叉',
  );

  const semanticA = withTimer(timer({ row: 1 }, 'FurnaceGenerate'));
  const semanticB = withTimer(timer({ row: 2 }, 'FurnaceGenerate'));
  assert.notEqual(
    hashSimulationState(semanticA).h64,
    hashSimulationState(semanticB).h64,
    '真正的逻辑参数必须继续参与哈希',
  );
});

test('血量 / 移动速度 / 计时器 / PRNG 状态变化都会改变哈希', () => {
  const original = hashSimulationState(baseState()).h64;
  assert.notEqual(hashSimulationState(baseState({
    entities: [{ ...baseState().entities[0], hp: 479 }],
  })).h64, original);
  assert.notEqual(hashSimulationState(baseState({
    entities: [{ ...baseState().entities[0], speed: 1.26 }],
  })).h64, original);
  assert.notEqual(hashSimulationState(baseState({
    timers: { ticker: [{ id: 7, targetFrame: 89, repeat: -1, interval: 4, group: 'entity_1' }] },
  })).h64, original);
  assert.notEqual(hashSimulationState(baseState({
    prngs: [{ name: 'mob.alea', seed: '12345', state: { c: 2, s0: 0.1, s1: 0.2, s2: 0.3 } }],
  })).h64, original);
  assert.notEqual(hashSimulationState(baseState({
    seed: 12346,
  })).h64, original);
});

test('本机专属状态不参与跨端哈希，但仍可进入快照并恢复', () => {
  const registry = new StateRegistry();
  const runtime = { local: 1 };
  registry.registerLocalValue(
    'cardpile',
    () => ({ cards: [{ pid: 1, leftMs: runtime.local }] }),
    (value) => {
      runtime.local = value.cards[0].leftMs;
    },
  );

  const first = registry.capture();
  runtime.local = 2;
  const second = registry.capture();

  assert.notDeepEqual(first.localValues, second.localValues);
  assert.equal(
    registry.hash(first).h64,
    registry.hash(second).h64,
    '本机卡槽等本地状态不应导致跨端哈希分叉',
  );

  runtime.local = 99;
  const report = registry.restore(first);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(runtime.local, 1);
});

test('快照序列化 / 反序列化后哈希保持一致', () => {
  const state = baseState();
  const restored = deserializeSimulationState(serializeSimulationState(state));
  assert.deepEqual(hashSimulationState(restored), hashSimulationState(state));
  assert.throws(
    () => deserializeSimulationState(JSON.stringify({ ...state, version: 99 })),
    /不支持的战局快照版本/,
  );
});

test('注册中心可捕获全部关键状态并完整恢复', () => {
  const registry = new StateRegistry();
  const runtime = {
    seed: 1,
    frame: 0,
    values: { hp: 100, resource: 50 },
    timers: [{ id: 1, targetFrame: 10, repeat: 2, interval: 5, group: 'g' }],
    prng: { c: 1, s0: 0.5 },
    entities: [{ id: 'e-1', hp: 90, speed: 2 }],
  };

  registry.registerSeed(() => runtime.seed, (v) => { runtime.seed = v; });
  registry.registerFrame(() => runtime.frame, (v) => { runtime.frame = v; });
  registry.registerValue('hp', () => runtime.values.hp, (v) => { runtime.values.hp = v; });
  registry.registerValue('resource', () => runtime.values.resource, (v) => { runtime.values.resource = v; });
  registry.registerTimers('ticker', () => runtime.timers, (v) => { runtime.timers = v; });
  registry.registerPrng({
    capture: () => ({ name: 'main', seed: String(runtime.seed), state: runtime.prng }),
    restore: (s) => { runtime.prng = s.state; },
  });
  registry.registerEntities('unit', () => runtime.entities.map((e) => ({
    kind: 'unit', id: e.id, col: 0, row: 0, x: 0, y: 0,
    hp: e.hp, maxHp: 100, speed: e.speed, flags: {}, timers: [], extra: {},
  })), (entities) => {
    entities.forEach((snapshot) => {
      const target = runtime.entities.find((e) => e.id === snapshot.id);
      if (target) {
        target.hp = snapshot.hp;
        target.speed = snapshot.speed;
      }
    });
  });

  const before = registry.capture();
  assert.equal(before.seed, 1);
  assert.equal(before.frameId, 0);
  assert.equal(before.entities[0].hp, 90);
  assert.equal(before.prngs[0].state.c, 1);

  const beforeHash = registry.hash(before).h64;

  runtime.seed = 999;
  runtime.frame = 77;
  runtime.values.hp = 1;
  runtime.values.resource = 0;
  runtime.timers = [];
  runtime.prng = { c: 9, s0: 0.9 };
  runtime.entities[0].hp = 1;

  const report = registry.restore(before);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(runtime, {
    seed: 1,
    frame: 0,
    values: { hp: 100, resource: 50 },
    timers: [{ id: 1, targetFrame: 10, repeat: 2, interval: 5, group: 'g' }],
    prng: { c: 1, s0: 0.5 },
    entities: [{ id: 'e-1', hp: 90, speed: 2 }],
  });
  assert.equal(registry.hash().h64, beforeHash);
});

test('canonicalize 对 NaN / Infinity 输出 null，避免跨端 JSON 差异', () => {
  assert.deepEqual(canonicalize({ a: NaN, b: Infinity, c: -Infinity }), { a: null, b: null, c: null });
});
