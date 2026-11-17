import assert from 'node:assert/strict';
import test from 'node:test';

// ReconnectController 依赖 window.setTimeout/clearTimeout；Node 环境用 globalThis 兜底。
globalThis.window ??= globalThis;

const { ReconnectController } = await import('./reconnect_controller.ts');

function makeController(overrides = {}) {
  const attempts = [];
  const giveUps = [];
  const connects = [];
  const controller = new ReconnectController({
    baseUrl: () => 'wss://localhost:28090/ws',
    buildReconnectUrl: () => 'wss://localhost:28090/ws?reconnect=1',
    onAttempt: (attempt, delay) => attempts.push({ attempt, delay }),
    onGiveUp: (reason) => giveUps.push(reason),
    baseDelayMs: 10,
    maxDelayMs: 40,
    maxAttempts: 3,
    ...overrides,
  });
  controller.setConnectHandler((url) => connects.push(url));
  return { controller, attempts, giveUps, connects };
}

test('连续失败时退避按 2 的幂增长并受上限约束', async () => {
  const { controller, attempts, connects } = makeController({ maxAttempts: 4, maxDelayMs: 35 });
  for (let i = 0; i < 4; i += 1) {
    assert.equal(controller.schedule(), true);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.deepEqual(attempts.map((item) => item.delay), [10, 20, 35, 35]);
  assert.equal(connects.length, 4);
});

test('达到最大次数后放弃并触发 onGiveUp', async () => {
  const { controller, giveUps } = makeController({ maxAttempts: 2 });
  assert.equal(controller.schedule(), true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(controller.schedule(), true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(controller.schedule(), false);
  assert.deepEqual(giveUps, ['网络中断，重连超时']);
});

test('无法构造重连 URL 时放弃', async () => {
  const { controller, giveUps, connects } = makeController({ buildReconnectUrl: () => null });
  assert.equal(controller.schedule(), true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(connects.length, 0);
  assert.deepEqual(giveUps, ['无法构造重连地址']);
});

test('markConnected 清零退避次数，cancel 阻止待执行重连', async () => {
  const { controller, connects } = makeController({ baseDelayMs: 30 });
  assert.equal(controller.schedule(), true);
  controller.cancel();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(connects.length, 0);
  assert.equal(controller.isReconnecting(), false);
  assert.equal(controller.getAttempt(), 0);
  assert.equal(controller.schedule(), true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(connects.length, 1);
  controller.markConnected();
  assert.equal(controller.getAttempt(), 0);
  assert.equal(controller.isReconnecting(), false);
});
