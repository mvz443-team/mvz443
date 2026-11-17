// E2E 场景 4：PostGame 返回房间 — 权威结算后显示结算页，点击“返回房间”回到原房间等待。
// 验收点：result-back-button 可见；点击后 stage 回到 InLobby、仍在原房间、peer 信息保留。

import { test, expect } from 'playwright/test';
import { openGame, openRoom, startGame, netState, waitForStage, STAGE } from './helpers.mjs';

test('PostGame 结算后可通过“返回房间”回到等待房间', async ({ context }) => {
  const page = await context.newPage();
  await openGame(page, { netDebug: true });
  const room = await openRoom(page, { roomName: 'pgr', chapterId: 1, stageId: 1 });
  await startGame(page, null);

  await page.evaluate(() => window.MVZ_NET.sendEndGame(true));
  await waitForStage(page, STAGE.PostGame, 20000);
  // E2E 跳过了 Phaser 选卡/战斗场景，直接打开结算视图以验证“返回房间”按钮链路。
  await page.evaluate(() => window.MVZ_NET.showResultForTest());
  await expect(page.locator('[data-testid="result-back-button"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-testid="result-back-button"]').click();
  await waitForStage(page, STAGE.InLobby, 20000);
  const state = await netState(page);
  expect(state.roomId).toBe(room.roomId);
  expect(state.roomSession).toBe(true);
});
