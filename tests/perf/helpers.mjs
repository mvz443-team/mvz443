// 性能测试辅助：真实浏览器、固定场景、统一指标采集。
// 每个 case 都从同样的 seed/关卡/卡组/实体布局开始；只测负载差异，不测随机性。

import { expect } from 'playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 28090);
export const SERVER_ADDRESS = `localhost:${SERVER_PORT}`;
export const STAGE = { InLobby: 0x20, Preparing: 0x21, Loading: 0x22, InGame: 0x23, PostGame: 0x24 };
export const SAVE_DB = 'MVZ443';
export const SAVE_STORE = 'gameProgress';
export const LOADOUT = [{ pid: 1, level: 1 }];

// 固定成本高负载场景：3 行 × 每格 1 植物，超过总数若干僵尸，持续发射的子弹。
// 坐标/编号全部写死，确保每次运行的初始场景一致。
export const STRESS_SCENE = {
  plants: [
    { pid: 1, level: 1, col: 1, row: 0 }, { pid: 1, level: 1, col: 2, row: 0 },
    { pid: 1, level: 1, col: 3, row: 0 }, { pid: 1, level: 1, col: 4, row: 0 },
    { pid: 1, level: 1, col: 1, row: 1 }, { pid: 1, level: 1, col: 2, row: 1 },
    { pid: 1, level: 1, col: 3, row: 1 }, { pid: 1, level: 1, col: 4, row: 1 },
    { pid: 1, level: 1, col: 1, row: 2 }, { pid: 1, level: 1, col: 2, row: 2 },
    { pid: 1, level: 1, col: 3, row: 2 }, { pid: 1, level: 1, col: 4, row: 2 },
  ],
  zombies: Array.from({ length: 36 }, (_, i) => ({
    mid: 1,
    col: 12 + (i % 3),
    row: i % 3,
    wave: 0,
  })),
  projectiles: Array.from({ length: 48 }, (_, i) => ({
    x: 80 + (i % 12) * 48,
    row: i % 3,
    damage: 1,
    maxDistance: 5000,
  })),
};

export const DEFAULT_SAVE = {
  level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
  plants: [{ pid: 1, level: 1 }, { pid: 2, level: 1 }, { pid: 3, level: 1 }, { pid: 4, level: 1 }, { pid: 18, level: 1 }],
  zombies: [],
  items: [],
  slotNum: 6,
  updatedAt: Date.now(),
  online: { username: 'perf', serverAddr: SERVER_ADDRESS, customServers: [SERVER_ADDRESS] },
};

async function injectSave(page, save) {
  await page.addInitScript(({ dbName, storeName, data }) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put({ ...data, id: 1 });
      tx.oncomplete = () => db.close();
    };
  }, { dbName: SAVE_DB, storeName: SAVE_STORE, data: save });
}

export async function openGame(page, { netDebug = false } = {}) {
  await injectSave(page, DEFAULT_SAVE);
  await page.context().addCookies([{
    name: 'linkOptions',
    value: JSON.stringify({ baseUrl: SERVER_ADDRESS, key: '' }),
    url: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${Number(process.env.E2E_FRONTEND_PORT ?? 8080)}`,
  }]);
  const query = new URLSearchParams({ perfHarness: '1', serverAddr: SERVER_ADDRESS });
  if (netDebug) query.set('netDebug', '1');
  await page.goto(`/?${query.toString()}`);
  await expect(page.locator('#app')).toBeVisible({ timeout: 30000 });
}

export async function netState(page) {
  return page.evaluate(() => globalThis.MVZ_NET?.getState?.() ?? null);
}

export async function waitForStage(page, stage, timeoutMs = 30000) {
  await expect.poll(async () => (await netState(page))?.stage, { timeout: timeoutMs, intervals: [100, 200, 500] }).toBe(stage);
}

async function waitForCanvas(page) {
  await expect.poll(async () => page.locator('#game-container canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);
}

export async function openRoom(page, options = {}) {
  const started = await page.evaluate((opts) => globalThis.MVZ_NET.openRoom(opts), options);
  expect(started).toBe(true);
  await expect.poll(async () => (await netState(page))?.roomId, { timeout: 30000 }).toBeGreaterThanOrEqual(0);
  await waitForStage(page, STAGE.InLobby);
  return (await netState(page)).roomId;
}

export async function startSinglePlayer(page) {
  await page.evaluate((cards) => globalThis.MVZ_NET.startSinglePlayerForPerf(cards, 1, 1), LOADOUT);
  // mock 房间可能已经由 Preloader 自动完成 playerLoaded；只需等待 InGame。
  await waitForStage(page, STAGE.InGame, 30000);
  await waitForCanvas(page);
}

export async function startMultiplayer(owner, guest) {
  const roomId = await openRoom(owner, { roomName: 'perf-room', chapterId: 1, stageId: 1 });
  await openRoom(guest, { roomId, chapterId: 1, stageId: 1 });
  await expect.poll(async () => (await netState(owner)).peers?.length ?? 0, { timeout: 30000 }).toBe(2);
  // 房主的“开始”需要其他成员先准备。
  await guest.evaluate(() => globalThis.MVZ_NET.sendReady(true));
  await expect.poll(async () => {
    const state = await netState(owner);
    return state?.peers?.some((peer) => peer.id !== state.myId && peer.ready) ?? false;
  }, { timeout: 30000, intervals: [100, 200, 500] }).toBe(true);
  await owner.evaluate(() => globalThis.MVZ_NET.chooseStage(1, 1));
  await waitForStage(owner, STAGE.Preparing);
  await waitForStage(guest, STAGE.Preparing);
  await owner.evaluate((cards) => globalThis.MVZ_NET.confirmLoadout(cards, 1, 1), LOADOUT);
  await guest.evaluate((cards) => globalThis.MVZ_NET.confirmLoadout(cards, 1, 1), LOADOUT);
  await waitForStage(owner, STAGE.Loading);
  await waitForStage(guest, STAGE.Loading);
  await owner.evaluate(() => globalThis.MVZ_NET.sendLoaded(true));
  await guest.evaluate(() => globalThis.MVZ_NET.sendLoaded(true));
  await waitForStage(owner, STAGE.InGame);
  await waitForStage(guest, STAGE.InGame);
  await waitForCanvas(owner);
  await waitForCanvas(guest);
}

/** 两端都必须调用；在权威帧采样窗口前建立完全相同的负载，避免 perf 注入本身造成分叉。 */
export async function injectStressScene(page) {
  await page.evaluate((scene) => globalThis.MVZ_NET.injectPerfScene(scene), STRESS_SCENE);
  // 等 DeferredManager 在下一逻辑帧落地；不要在这里等权威帧推进。
  await page.waitForTimeout(300);
}

/** 注入完成后再确认权威帧已开始，避免把启动空档算进采样窗口。 */
export async function waitForAuthoritativeFrames(...pages) {
  for (const page of pages) {
    await expect.poll(async () => (await netState(page))?.frameId ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
  }
}

/** 采集常用游戏性能指标：FPS/帧时间/长任务/JS heap/CDP TaskDuration。 */
export async function measure(page, durationMs = 8000) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(() => globalThis.MVZ_NET?.resetPerfSampler?.());
  const before = await cdp.send('Performance.getMetrics');
  await page.evaluate((ms) => {
    return new Promise((resolve) => {
      const samples = [];
      let last = performance.now();
      const start = last;
      const observer = typeof PerformanceObserver !== 'undefined'
        ? new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) samples.push({ longTaskMs: entry.duration, at: entry.startTime });
          })
        : null;
      try { observer?.observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
      function tick(now) {
        samples.push({ frameMs: now - last });
        last = now;
        if (now - start >= ms) {
          observer?.disconnect();
          globalThis.__perfSamples = samples;
          resolve(null);
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, durationMs);
  const after = await cdp.send('Performance.getMetrics');
  const samples = await page.evaluate(() => globalThis.__perfSamples ?? []);
  const frameMs = samples.map((s) => s.frameMs).filter((v) => Number.isFinite(v) && v > 0);
  const longTasks = samples.filter((s) => s.longTaskMs).map((s) => s.longTaskMs);
  const metric = (metrics, name) => metrics.metrics.find((m) => m.name === name)?.value ?? 0;
  const netAfter = await netState(page);
  // 性能基线不打开 netDebug；用公开网络状态判断当前帧是否正常推进。
  const desyncState = { state: { offline: (netAfter?.stage ?? 0) === 0 } };
  const counts = await page.evaluate(() => globalThis.MVZ_NET?.getPerfCounts?.() ?? null);
  const sampler = await page.evaluate(() => globalThis.MVZ_NET?.getPerfSampler?.() ?? null);
  const pct = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  const avg = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  await cdp.detach();
  return {
    durationMs,
    rafSamples: frameMs.length,
    fps: avg(frameMs) ? 1000 / avg(frameMs) : null,
    frameTimeAvgMs: avg(frameMs),
    frameTimeP50Ms: pct(frameMs, 0.5),
    frameTimeP95Ms: pct(frameMs, 0.95),
    longTaskCount: longTasks.length,
    longTaskTotalMs: longTasks.reduce((a, b) => a + b, 0),
    jsHeapUsedMB: metric(after, 'JSHeapUsedSize') / 1024 / 1024,
    jsHeapGrowthMB: (metric(after, 'JSHeapUsedSize') - metric(before, 'JSHeapUsedSize')) / 1024 / 1024,
    taskDurationSec: metric(after, 'TaskDuration') - metric(before, 'TaskDuration'),
    layoutCount: metric(after, 'LayoutCount') - metric(before, 'LayoutCount'),
    recalcStyleCount: metric(after, 'RecalcStyleCount') - metric(before, 'RecalcStyleCount'),
    phaserFps: counts?.phaserFps ?? null,
    authoritativeFrame: netAfter?.frameId ?? null,
    stageAfter: netAfter?.stage ?? null,
    inGameAfter: netAfter?.inGame ?? null,
    desyncState,
    sampler,
    entityCounts: counts ? { plants: counts.plants, zombies: counts.zombies, projectiles: counts.projectiles } : null,
  };
}

const REPORT_PATH = resolve(process.cwd(), 'PERFORMANCE_REPORT.md');
const JSON_PATH = resolve(process.cwd(), 'PERFORMANCE_REPORT.json');

export function writeReport(results) {
  const generatedAt = new Date().toISOString();
  const json = { generatedAt, results };
  mkdirSync(dirname(JSON_PATH), { recursive: true });
  writeFileSync(JSON_PATH, JSON.stringify(json, null, 2));
  const rows = Object.entries(results).map(([name, m]) => `| ${name} | ${m.fps?.toFixed(1) ?? '-'} | ${m.phaserFps?.toFixed(1) ?? '-'} | ${m.frameTimeP50Ms?.toFixed(1) ?? '-'} | ${m.frameTimeP95Ms?.toFixed(1) ?? '-'} | ${m.longTaskCount} | ${m.jsHeapUsedMB?.toFixed(1) ?? '-'} | ${m.taskDurationSec?.toFixed(2) ?? '-'} | ${m.authoritativeFrame ?? '-'} | ${m.entityCounts?.plants ?? '-'} / ${m.entityCounts?.zombies ?? '-'} / ${m.entityCounts?.projectiles ?? '-'} |`).join('\n');
  const md = [
    '# 前端性能报告',
    '',
    `生成时间：${generatedAt}`,
    '',
    '运行环境：真实 Chromium（每个上下文等价无痕窗口），桌面 1280x720；单机与联机都使用相同固定场景、固定实体布局，并采样 8 秒。',
    '',
    '| 场景 | rAF FPS | Phaser FPS | 帧时间 p50 (ms) | 帧时间 p95 (ms) | 长任务数 | JS Heap (MB) | TaskDuration (s) | 权威帧 | 植物/僵尸/投射物 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows,
    '',
    '说明：',
    '',
    '- rAF FPS/帧时间来自浏览器 requestAnimationFrame 采样；',
    '- Phaser FPS 来自 game.loop.actualFps，反映渲染循环；',
    '- 长任务来自 PerformanceObserver longtask；',
    '- JS Heap、TaskDuration、LayoutCount、RecalcStyleCount 来自 CDP Performance.getMetrics；',
    '- 权威帧只对联机场景有意义，0 表示该页面未收到权威帧。',
    '',
    '游戏逻辑固定步为 20 FPS（50ms）；因此联机高负载场景的 rAF/Phaser 低帧率需要结合 p95 与长任务判断，50ms 附近的帧间隔并不必然代表渲染卡顿。详细原始数据见 PERFORMANCE_REPORT.json。',
    '',
  ].join('\n');
  writeFileSync(REPORT_PATH, md);
}
