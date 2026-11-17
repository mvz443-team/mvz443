// E2E 场景 1：联机大厅 — 两个浏览器上下文各自建房/加入房间后看到彼此的 peer 状态。
// 验收点：roomId 一致、双方 stage=InLobby、peers 均包含两名玩家。

import { test, expect } from 'playwright/test';
import { openGame, openRoom, netState, STAGE, SERVER_ADDRESS } from './helpers.mjs';

test('联机大厅：建房者与第二名玩家互相可见', async ({ browser }) => {
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const saveB = {
      level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
      plants: [], zombies: [], items: [], slotNum: 6, updatedAt: Date.now(),
      online: { username: 'guest', serverAddr: SERVER_ADDRESS, customServers: [] },
    };
    await openGame(pageA, { netDebug: true });
    await openGame(pageB, { netDebug: true, save: saveB });

    const room = await openRoom(pageA, { roomName: 'e2eA', chapterId: 1, stageId: 1 });
    expect(room.roomId).toBeGreaterThanOrEqual(0);
    await openRoom(pageB, { roomId: room.roomId, chapterId: 1, stageId: 1 });

    await expect.poll(async () => (await netState(pageA)).peers?.length ?? 0, { timeout: 20000 }).toBe(2);
    await expect.poll(async () => (await netState(pageB)).peers?.length ?? 0, { timeout: 20000 }).toBe(2);
    expect((await netState(pageA)).stage).toBe(STAGE.InLobby);
    expect((await netState(pageB)).stage).toBe(STAGE.InLobby);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
