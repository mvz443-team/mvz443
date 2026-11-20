// E2E 回归：同一页面连续开两局时，上一局的投射物注册表与序号必须清零。
// projectile.seq 参与跨端状态哈希；残留会让新一局第一帧就 desync
// （现场日志：一端 seq=1239 且残留 projectile:1238，另一端 seq=1）。

import { test, expect } from 'playwright/test';
import { openGame, openRoom, netState, waitForStage, startPreparing, STAGE } from './helpers.mjs';

test('对局拆除后投射物序号与残留实体归零', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await openGame(page, { netDebug: true });
    const room = await openRoom(page, { roomName: 'proj-reset', chapterId: 1, stageId: 1 });
    expect(room.roomId).toBeGreaterThanOrEqual(0);
    await startPreparing(page, null);
    await page.evaluate(() => window.MVZ_NET.sendReady(true));
    await waitForStage(page, STAGE.Loading);
    await page.evaluate(() => window.MVZ_NET.sendLoaded(true));
    await waitForStage(page, STAGE.InGame);
    await expect.poll(async () => page.locator('#game-container canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);

    // 通过 Cmd 层注入一枚投射物：序号从 1 变为 2，注册表出现一个实体。
    const injected = await page.evaluate(() => window.MVZ_NET.injectPerfScene({
      plants: [], zombies: [], projectiles: [{ x: 300, row: 0, damage: 1 }],
    }));
    expect(injected).toBe(true);
    await expect.poll(async () => page.evaluate(() => window.MVZ_NET.getPerfCounts()), { timeout: 10000 })
      .toMatchObject({ projectiles: 1, projectileSeq: 2 });

    // 权威结束对局后必须回到干净的跨局状态，否则下一局首帧两端摘要分叉。
    await page.evaluate(() => window.MVZ_NET.sendEndGame(true));
    await expect.poll(async () => page.evaluate(() => window.MVZ_NET.getPerfCounts()), { timeout: 30000 })
      .toMatchObject({ projectiles: 0, projectileSeq: 1 });
    expect((await netState(page))?.stage).not.toBe(STAGE.InGame);
  } finally {
    await context.close();
  }
});
