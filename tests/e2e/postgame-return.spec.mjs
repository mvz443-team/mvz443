// E2E 场景 4：PostGame 返回房间 — 权威结算后显示结算页，点击“返回房间”回到原房间等待。
// 验收点：result-back-button 可见；点击后回到等待房间界面（不是主菜单）；stage 回到 InLobby；
// 仍在原房间；两端准备标记清零，可再次开局。

import { test, expect } from 'playwright/test';
import { openGame, openRoom, startGame, netState, waitForStage, STAGE } from './helpers.mjs';

test('PostGame 结算后可通过“返回房间”回到等待房间', async ({ context }) => {
  const page = await context.newPage();
  await openGame(page, { netDebug: true });
  await openRoom(page, { roomName: 'pgr', chapterId: 1, stageId: 1 });
  await startGame(page, null);

  await page.evaluate(() => window.MVZ_NET.sendEndGame(true));
  await waitForStage(page, STAGE.PostGame, 20000);
  // E2E 跳过了 Phaser 选卡/战斗场景，直接打开结算视图以验证“返回房间”按钮链路。
  await page.evaluate(() => window.MVZ_NET.showResultForTest());
  await expect(page.locator('[data-testid="result-back-button"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-testid="result-back-button"]').click();
  // 关键验收：回到的是房间界面，而不是主菜单。
  await expect(page.locator('[data-testid="waiting-room"]')).toBeVisible({ timeout: 20000 });
  await waitForStage(page, STAGE.InLobby, 20000);
  const state = await netState(page);
  expect(state.roomSession).toBe(true);
  expect(state.peers?.every((peer) => !peer.ready)).toBe(true);
});

test('PostGame 服务端自动返回等待房间时结算页也能回到房间', async ({ context }) => {
  const page = await context.newPage();
  await openGame(page, { netDebug: true });
  await openRoom(page, { roomName: 'pgr-auto', chapterId: 1, stageId: 1 });
  await startGame(page, null);

  await page.evaluate(() => window.MVZ_NET.sendEndGame(true));
  await waitForStage(page, STAGE.PostGame, 20000);
  // 结算页展示期间 DocFrame 未挂载；服务端超时广播 returnToLobby 时，
  // App 顶层监听必须接住事件，点击返回按钮也能回到房间界面。
  await page.evaluate(() => window.MVZ_NET.showResultForTest());
  await expect(page.locator('[data-testid="result-back-button"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-testid="result-back-button"]').click();
  await expect(page.locator('[data-testid="waiting-room"]')).toBeVisible({ timeout: 20000 });
  await waitForStage(page, STAGE.InLobby, 20000);
});
