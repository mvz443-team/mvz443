import assert from 'node:assert/strict';
import test from 'node:test';

// 启动时 App 会自动 attach 存档里的服务器，React StrictMode 会重复执行 effect，
// 选关页/设置页也会再次 resume。重复 attach 必须复用进行中的探测，
// 否则第二次 probe() 会返回“上一次探测尚未结束”并把状态打回 offline。

// server_status 用 window.setTimeout/setInterval 做超时与轮询，间接依赖的
// debugFlags 还会读 window.location / 订阅 storage 事件，Node 测试环境需要补最小替身。
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (id) => globalThis.clearInterval(id),
    addEventListener() {},
    removeEventListener() {},
    location: { search: '' },
  };
}

const { ServerStatusMonitor } = await import('./server_status.ts');

function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('同一地址探测中重复 attach 只发一次请求且最终为 connected', async () => {
  const monitor = new ServerStatusMonitor();
  let requests = 0;
  await withFetch(async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, status: 200 };
  }, async () => {
    try {
      await Promise.all([
        monitor.attach('127.0.0.1:28080'),
        monitor.attach('127.0.0.1:28080'),
      ]);
      assert.equal(requests, 1, '同一地址并发 attach 只允许一次探测');
      assert.equal(monitor.getState(), 'connected');
    } finally {
      monitor.disconnect();
    }
  });
});

test('探测失败后状态降级为 offline，但不会抛出打断启动', async () => {
  const monitor = new ServerStatusMonitor();
  await withFetch(async () => {
    throw new Error('ERR_CONNECTION_REFUSED');
  }, async () => {
    try {
      await monitor.attach('127.0.0.1:28080');
      assert.equal(monitor.getState(), 'offline');
    } finally {
      monitor.disconnect();
    }
  });
});
