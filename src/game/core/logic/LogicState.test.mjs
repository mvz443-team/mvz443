import assert from 'node:assert/strict';
import test from 'node:test';

const { createLogicState, getLogicHandle } = await import('./LogicState.ts');
const { makeSchedule, consumeDue, isDue, startCooldown, cooldownReady } = await import('./FrameCounter.ts');
const { LogicWorld } = await import('./LogicWorld.ts');
const { LogicEventQueue } = await import('./LogicEvents.ts');
const { fnv1a64, HashWriter } = await import('../SimulationState.ts');

test('普通字段写入自动进 Undo Log，回滚无需任何 reg 声明', () => {
  const state = createLogicState({ hp: 100, level: 1, frozen: false });
  const handle = getLogicHandle(state);

  state.hp -= 20;
  state.level = 3;
  assert.deepEqual(handle.snapshot(), { hp: 80, level: 3, frozen: false });

  handle.setFrame(10);
  state.hp = 5;
  state.frozen = true;
  handle.setFrame(11);
  state.hp = 1;

  handle.rollbackTo(9);
  assert.deepEqual(handle.snapshot(), { hp: 80, level: 3, frozen: false });
  assert.equal(handle.frame, 9);
});

test('嵌套对象与数组变更同样可回滚', () => {
  const state = createLogicState({ buffs: { slow: 0 }, targets: [] });
  const handle = getLogicHandle(state);

  handle.setFrame(1);
  state.buffs.slow = 30;
  state.targets.push('mob:1', 'mob:2');
  assert.deepEqual(handle.snapshot(), { buffs: { slow: 30 }, targets: ['mob:1', 'mob:2'] });

  handle.setFrame(2);
  state.buffs.slow = 10;
  state.targets.splice(0, 1);

  handle.rollbackTo(1);
  assert.deepEqual(handle.snapshot(), { buffs: { slow: 30 }, targets: ['mob:1', 'mob:2'] });
});

test('非确定性值直接拒绝，表现层对象无法混进 Model', () => {
  const state = createLogicState({ hp: 10 });
  assert.throws(() => { state.hp = () => 1; }, /确定性数据/);
  assert.throws(() => { state.hp = { sprite: new Date() }; }, /确定性数据/);
});

test('帧计数器是纯数字状态，随回滚一起复原且没有回调', () => {
  const state = createLogicState({ schedule: makeSchedule(0, 3, -1), target: startCooldown(0, 5) });
  const handle = getLogicHandle(state);

  for (let frame = 1; frame <= 7; frame++) {
    handle.setFrame(frame);
    if (isDue(state.schedule, frame) && consumeDue(state.schedule, frame)) {
      state.target = startCooldown(frame, 5);
    }
  }
  assert.equal(state.schedule.nextFrame, 9);
  assert.equal(state.target, 11);
  assert.equal(cooldownReady(state.target, 7), false);

  handle.rollbackTo(4);
  assert.equal(state.schedule.nextFrame, 6);
  assert.equal(state.target, 8);
  assert.equal(cooldownReady(state.target, 4), false);
});

test('LogicWorld 回滚撤销对象生命周期与 id 序号，像从未生成过一样', () => {
  const world = new LogicWorld();
  world.step();
  const first = world.spawn('projectile', { x: 10, damage: 5 });
  world.step();
  world.emit('Fire', first.id);
  const second = world.spawn('projectile', { x: 20, damage: 5 });
  assert.equal(first.id, 'projectile:1');
  assert.equal(second.id, 'projectile:2');

  world.rollbackTo(0);
  assert.equal(world.active().length, 0);
  assert.equal(world.allEvents().length, 0);
  assert.equal(world.frame, 0);

  world.step();
  const replay = world.spawn('projectile', { x: 20, damage: 5 });
  assert.equal(replay.id, 'projectile:1');
  assert.equal(world.get(second.id), undefined);
});

test('全量快照恢复与连续运行哈希一致；回滚后重放哈希也一致', () => {
  const hashOf = (value) => {
    const writer = new HashWriter();
    writer.value(value);
    return fnv1a64(writer.toBytes());
  };
  const tick = (world, frame) => {
    world.step();
    if (frame === 3) world.spawn('plant', { hp: 100, cooldown: 0 });
    if (frame === 5) world.spawn('mob', { hp: 60, x: 900 });
    for (const entity of world.active()) {
      if (entity.kind === 'plant') entity.state.cooldown += 1;
    }
  };

  const baseline = new LogicWorld();
  let snapshotAt8;
  for (let frame = 1; frame <= 12; frame++) {
    tick(baseline, frame);
    if (frame === 8) snapshotAt8 = baseline.capture();
  }
  const expected = hashOf(baseline.capture());

  const replay = new LogicWorld();
  replay.restore(snapshotAt8);
  for (let frame = 9; frame <= 12; frame++) tick(replay, frame);
  assert.equal(hashOf(replay.capture()), expected);

  const rolledBack = new LogicWorld();
  for (let frame = 1; frame <= 12; frame++) tick(rolledBack, frame);
  rolledBack.rollbackTo(8);
  assert.equal(hashOf(rolledBack.capture()), hashOf(snapshotAt8));
});

test('一次性事件按 eventId 去重，回滚时连同序号一起撤销', () => {
  const queue = new LogicEventQueue();
  queue.setFrame(10);
  queue.emit('Fire', 'plant:1');
  queue.setFrame(11);
  queue.emit('Fire', 'plant:1');
  queue.emit('Hit', 'plant:1');

  assert.deepEqual(queue.consume(0, 'plant:1').map((event) => event.eventId), [1, 2, 3]);
  assert.deepEqual(queue.consume(2, 'plant:1').map((event) => event.eventId), [3]);

  const snapshot = queue.snapshot();
  queue.rollbackTo(10);
  assert.deepEqual(queue.all().map((event) => event.eventId), [1]);
  queue.restore(snapshot);
  assert.deepEqual(queue.all().map((event) => event.eventId), [1, 2, 3]);
});
