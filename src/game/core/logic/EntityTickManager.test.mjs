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
