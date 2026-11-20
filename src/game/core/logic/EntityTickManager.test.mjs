import assert from 'node:assert/strict';
import test from 'node:test';

// 炉子等实体的首个定时器 targetFrame = 创建帧 + 固定偏移。
// 如果创建被 DeferredManager 推迟到下一帧，仍必须以“触发创建的操作帧”
// 为起点，否则两端同一操作会得到不同的 targetFrame，从该帧起分叉。

const {
  EntityTickManager,
  updateAllTickManagers,
  setAuthoritativeFrame,
  withTickFrame,
} = await import('./EntityTickManager.ts');
const { invokeTickEventCallback } = await import('./TickEvents.ts');

function makeTicker() {
  return new EntityTickManager({ handleTickEvent() {} });
}

test('权威帧推进后创建的实体以权威帧为起点', () => {
  updateAllTickManagers(215, 50);
  setAuthoritativeFrame(215);
  const ticker = makeTicker();
  const handle = ticker.schedule('FurnaceGenerate', 25_000, { startAt: 7_500, loop: true });
  assert.equal(handle.targetFrame, 215 + 350);
});

test('延迟创建仍锚定注册 deferred 时的帧', () => {
  // 消费 frame 215 时注册创建，但实际 flush 可能拖到 ticker 已到 216。
  updateAllTickManagers(215, 50);
  setAuthoritativeFrame(215);

  const ticker = withTickFrame(215, () => {
    updateAllTickManagers(216, 50);
    return makeTicker();
  });
  const handle = ticker.schedule('FurnaceGenerate', 25_000, { startAt: 7_500, loop: true });
  assert.equal(handle.targetFrame, 215 + 350, '不得以延迟执行时的 ticker 帧为起点');
});

test('不同帧创建的同一 preset 必须得到不同 targetFrame', () => {
  const at212 = withTickFrame(212, () => makeTicker());
  const at215 = withTickFrame(215, () => makeTicker());
  const first = at212.schedule('FurnaceGenerate', 25_000, { startAt: 7_500, loop: true });
  const second = at215.schedule('FurnaceGenerate', 25_000, { startAt: 7_500, loop: true });
  assert.equal(second.targetFrame - first.targetFrame, 3);
});

test('同一帧内实体 timer 按稳定 ownerId 顺序触发', () => {
  const fired = [];
  const { managerA, managerB } = withTickFrame(0, () => {
    const managerB = new EntityTickManager({
      handleTickEvent(eventName) { fired.push(`b:${eventName}`); },
    });
    const managerA = new EntityTickManager({
      handleTickEvent(eventName) { fired.push(`a:${eventName}`); },
    });
    managerB.setOwnerId('plant:2:0:2:0');
    managerA.setOwnerId('plant:1:1:2:0');
    // Set 的插入顺序是 b -> a；必须按 ownerId 排序成 a -> b。
    managerB.schedule('tick', 1);
    managerA.schedule('tick', 1);
    return { managerA, managerB };
  });
  updateAllTickManagers(1, 50);

  assert.deepEqual(fired, ['a:tick', 'b:tick']);
  managerA.dispose();
  managerB.dispose();
});

test('重连恢复：TimerTriggered 改用本机重建句柄，不跨实体误派发', () => {
  const fired = [];
  const makeEntity = (tag) => {
    const ticker = withTickFrame(0, () => new EntityTickManager({ handleTickEvent() {} }));
    ticker.setOwnerId(`plant:0:${tag}:1:0`);
    ticker.addEvent({ callback: () => fired.push(tag), delay: 1000, startAt: 800, repeat: -1 });
    return ticker;
  };

  const source = makeEntity('source');
  const captured = source.capture();
  const sourceHandle = captured[0].args;
  assert.match(String(sourceHandle), /^callback:/);

  // 模拟页面刷新重连：同一实体在新进程重建，onCreate 重新注册了新闭包，
  // 其回调句柄与源端不同。
  const rebuilt = makeEntity('rebuilt');
  const rebuiltHandle = rebuilt.capture()[0].args;
  assert.notEqual(rebuiltHandle, sourceHandle);

  const report = { ok: true, restored: [], missing: [], errors: [] };
  rebuilt.restore(captured, { frameId: 0, mode: 'rebuild', report });

  const restored = rebuilt.capture();
  assert.equal(restored[0].args, rebuiltHandle, '必须沿用本机重建后的回调句柄');
  assert.equal(invokeTickEventCallback(restored[0].args), true);
  assert.deepEqual(fired, ['rebuilt'], '恢复的定时器不得执行源端/其他实体的闭包');
  assert.deepEqual(report.missing, []);

  source.dispose();
  rebuilt.dispose();
});

test('重连恢复：没有本机对应注册的 TimerTriggered 计时器必须丢弃', () => {
  const ticker = withTickFrame(0, () => new EntityTickManager({ handleTickEvent() {} }));
  ticker.setOwnerId('plant:9:9:1:0');
  const report = { ok: true, restored: [], missing: [], errors: [] };
  ticker.restore(
    [{
      id: 7,
      targetFrame: 10,
      repeat: 0,
      interval: 4,
      group: 'plant:9:9:1:0',
      kind: 'TimerTriggered',
      args: 'callback:999999',
    }],
    { frameId: 0, mode: 'rebuild', report },
  );

  assert.equal(ticker.capture().length, 0, '无法解析的源端回调句柄不得恢复');
  assert.ok(report.missing.includes('timer.callback:7'));
  ticker.dispose();
});

test('同进程回滚：已触发删除的 TimerTriggered 计时器仍可恢复', () => {
  const ticker = withTickFrame(0, () => new EntityTickManager({ handleTickEvent() {} }));
  ticker.setOwnerId('plant:0:5:1:0');
  ticker.addEvent({ callback: () => {}, delay: 200, startAt: 0, repeat: 0 });
  const captured = ticker.capture();
  assert.equal(captured.length, 1);

  // 到点后一次性计时器被删除。
  updateAllTickManagers(4, 50);
  assert.equal(ticker.capture().length, 0);

  // 同进程回滚到该帧之前：句柄仍属于本实例，必须恢复，不能当成跨进程句柄丢弃。
  const report = { ok: true, restored: [], missing: [], errors: [] };
  ticker.restore(captured, { frameId: 0, mode: 'in-place', report });
  const restored = ticker.capture();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].args, captured[0].args);
  assert.deepEqual(report.missing, []);
  ticker.dispose();
});
