// E2E 场景 3：重连放弃 — 断线后 UI 显示重连徽标；达到放弃条件后展示关闭 Toast 并退出在线状态。
// 重连次数/退避策略由 ReconnectController 单元测试覆盖，这里验证 UI 链路。

import { test, expect } from 'playwright/test';
import { openGame, openRoom, startGame, netState } from './helpers.mjs';

test('重连中止后展示关闭提示并退出在线状态', async ({ context }) => {
  const page = await context.newPage();
  await openGame(page, { netDebug: true });
  const room = await openRoom(page, { roomName: 'giveup', chapterId: 1, stageId: 1 });
  expect(room.roomId).toBeGreaterThanOrEqual(0);
  await startGame(page, null);

  await page.evaluate(() => window.MVZ_NET.dropSocketForTest());
  await expect(page.locator('[data-testid="reconnect-badge"]')).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => window.MVZ_NET.forceGiveUpForTest('重连次数已达上限'));
  await expect(page.locator('[data-testid="network-toast"][data-kind="closed"]')).toBeVisible({ timeout: 15000 });
  const state = await netState(page);
  expect(state.reconnecting).toBe(false);
  expect(state.online).toBe(false);
});
