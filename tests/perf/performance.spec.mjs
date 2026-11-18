// 固定场景性能基线：单机 mock 房间 vs 两个无痕窗口联机房间。
// 每个 case 都从相同 seed/关卡/卡组/实体布局开始，并采集同样的指标。

import { test } from 'playwright/test';
import {
  openGame, startSinglePlayer, startMultiplayer, injectStressScene, waitForAuthoritativeFrames, measure, writeReport,
} from './helpers.mjs';

const results = {};

test.afterAll(() => {
  writeReport(results);
});

test('性能：真实浏览器单机高负载场景', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await openGame(page);
    await startSinglePlayer(page);
    await injectStressScene(page);
    results['单机-高负载'] = await measure(page, 8000);
  } finally {
    await context.close();
  }
});

test('性能：双无痕窗口联机高负载场景', async ({ browser }) => {
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const owner = await contextA.newPage();
  const guest = await contextB.newPage();
  try {
    await openGame(owner);
    await openGame(guest);
    await startMultiplayer(owner, guest);
    // 与单机场景完全一致，但两端都要注入；否则 perf 注入自身就会造成哈希分叉。
    await Promise.all([injectStressScene(owner), injectStressScene(guest)]);
    await waitForAuthoritativeFrames(owner, guest);
    // 联机取房主端性能指标；guest 同样执行权威帧与物理，用于保持真实双端负载。
    results['联机-高负载(房主端)'] = await measure(owner, 8000);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
