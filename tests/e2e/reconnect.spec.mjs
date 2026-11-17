// E2E 场景 2：断线重连 — InGame 中一方断开，UI 显示重连徽标；服务端保留席位并允许自动重连。
// 验收点：reconnect-badge 可见且 attempt >= 1；重连后 online/roomSession 保持、房间席位仍在。

import { test, expect } from 'playwright/test';
import { openGame, openRoom, startGame, netState, waitForStage, STAGE } from './helpers.mjs';

test('InGame 断线后自动重连并保留房间席位', async ({ browser, context }) => {
  const ownerCtx = context;
  const guestCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const owner = await ownerCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    await openGame(owner, { netDebug: true });
    await openGame(guest, { netDebug: true });
    const room = await openRoom(owner, { roomName: 'reconn', chapterId: 1, stageId: 1 });
    await openRoom(guest, { roomId: room.roomId, chapterId: 1, stageId: 1 });
    await startGame(owner, guest);
    await waitForStage(owner, STAGE.InGame);

    await guest.evaluate(() => window.MVZ_NET.dropSocketForTest());
    await expect(guest.locator('[data-testid="reconnect-badge"]')).toBeVisible({ timeout: 20000 });
    const during = await netState(guest);
    expect(during.reconnecting).toBe(true);
    expect(during.reconnectAttempt).toBeGreaterThanOrEqual(1);

    // 重连由 ReconnectController 自动驱动；等待连接恢复。
    await expect.poll(async () => (await netState(guest)).reconnecting, { timeout: 30000 }).toBe(false);
    const after = await netState(guest);
    expect(after.online).toBe(true);
    expect(after.roomSession).toBe(true);
    expect(after.roomId).toBe(room.roomId);
  } finally {
    await guestCtx.close();
  }
});
