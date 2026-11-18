// Playwright E2E 公共辅助：
// - 通过 cookie 注入联机服务器地址（settings_ctx 从 cookie 读取）
// - 通过 IndexedDB 注入存档：解锁首关首图、设置联机昵称
// - 统一打开前端页面并等待关键 DOM 状态

import { expect } from 'playwright/test';

export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 28090);
export const SERVER_ADDRESS = `localhost:${SERVER_PORT}`;
export const STAGE = { InLobby: 0x20, Preparing: 0x21, Loading: 0x22, InGame: 0x23, PostGame: 0x24 };

const SAVE_DB = 'MVZ443';
const SAVE_STORE = 'gameProgress';

/** 默认解锁第 1 章第 1 关，避免测试依赖玩家历史进度。注意 Dexie 存储格式与 serializeGameProgress 一致。 */
export const DEFAULT_SAVE = {
  level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
  plants: [{ pid: 1, level: 1 }, { pid: 2, level: 1 }, { pid: 3, level: 1 }, { pid: 4, level: 1 }, { pid: 18, level: 1 }],
  zombies: [],
  items: [],
  slotNum: 6,
  updatedAt: Date.now(),
  online: { username: 'tester', serverAddr: SERVER_ADDRESS, customServers: [SERVER_ADDRESS] },
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

export async function openGame(page, { path = '/', save = DEFAULT_SAVE, netDebug = true } = {}) {
  if (save) await injectSave(page, save);
  await page.context().addCookies([{
    name: 'linkOptions',
    value: JSON.stringify({ baseUrl: SERVER_ADDRESS, key: '' }),
    url: (process.env.E2E_BASE_URL ?? `http://127.0.0.1:${Number(process.env.E2E_FRONTEND_PORT ?? 8080)}`),
  }]);
  const query = new URLSearchParams({ netDebug: '1', serverAddr: SERVER_ADDRESS });
  await page.goto(`${path}?${query.toString()}`);
  await expect(page.locator('#app')).toBeVisible({ timeout: 30000 });
}

export async function netState(page) {
  return page.evaluate(() => globalThis.MVZ_NET?.getState() ?? null);
}

export async function waitForNet(page, predicate, timeoutMs = 20000) {
  await expect.poll(async () => netState(page), { timeout: timeoutMs, intervals: [100, 200, 500] })
    .toMatchObject(predicate);
}

export async function waitForStage(page, stage, timeoutMs = 20000) {
  await expect.poll(async () => (await netState(page))?.stage, { timeout: timeoutMs, intervals: [100, 200, 500] })
    .toBe(stage);
}

/** 读取最近一次确定性状态采样（hash+frameId），由 MVZ_NET.getSimulationHash 暴露。 */
export async function simHash(page) {
  return page.evaluate(() => window.MVZ_NET?.getSimulationHash?.() ?? null);
}

/** 等待两端在“同一权威帧”都采样到哈希，返回该采样，用于跨端一致性断言。 */
export async function waitForMatchingHashFrame(pageA, pageB, timeoutMs = 30000, minFrameId = 0) {
  let matched = null;
  await expect.poll(async () => {
    const [a, b] = await Promise.all([simHash(pageA), simHash(pageB)]);
    if (a && b && a.frameId === b.frameId && a.frameId > minFrameId) {
      matched = { frameId: a.frameId, a: a.hash, b: b.hash };
      return true;
    }
    return false;
  }, { timeout: timeoutMs, intervals: [100, 200, 500] }).toBe(true);
  return matched;
}

/** 通过调试钩子建房/加入房间，并等待进入等待房间阶段。 */
export async function openRoom(page, options = {}, timeoutMs = 20000) {
  const started = await page.evaluate((opts) => window.MVZ_NET.openRoom(opts), options);
  expect(started, `openRoom 启动失败，opts=${JSON.stringify(options)}`).toBe(true);
  await expect.poll(async () => (await netState(page))?.roomId, { timeout: timeoutMs, intervals: [100, 200, 500] })
    .toBeGreaterThanOrEqual(0);
  await waitForStage(page, STAGE.InLobby, timeoutMs);
  const state = await netState(page);
  return { roomId: state.roomId ?? null, myId: state.myId ?? null };
}

/** 通过调试钩子完成准备 → 选图 → 加载，进入 InGame。 */
export async function startGame(owner, guest, { chapterId = 1, stageId = 1 } = {}, timeoutMs = 30000) {
  await owner.evaluate((id) => window.MVZ_NET.chooseStage(id[0], id[1]), [chapterId, stageId]);
  await waitForStage(owner, STAGE.Preparing, timeoutMs);
  if (guest) await waitForStage(guest, STAGE.Preparing, timeoutMs);
  for (const page of guest ? [owner, guest] : [owner]) {
    await page.evaluate(() => window.MVZ_NET.sendReady(true));
  }
  await waitForStage(owner, STAGE.Loading, timeoutMs);
  if (guest) await waitForStage(guest, STAGE.Loading, timeoutMs);
  for (const page of guest ? [owner, guest] : [owner]) {
    await page.evaluate(() => window.MVZ_NET.sendLoaded(true));
  }
  await waitForStage(owner, STAGE.InGame, timeoutMs);
  if (guest) await waitForStage(guest, STAGE.InGame, timeoutMs);
}
