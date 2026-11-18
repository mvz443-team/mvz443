// E2E：页面刷新后的联机重连。
// 验收点：刷新后从主页“开始游戏 → 重连”进入 Preloader/Game 场景，
// 不再出现 “no game params”；服务端用持久化的 profile/关卡/seed 重建战局，
// 并通过在线玩家的备用快照恢复状态。

import { test, expect } from 'playwright/test';
import {
  openGame, openRoom, netState, waitForStage, simHash, STAGE, SERVER_ADDRESS,
} from './helpers.mjs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const OWNER_SAVE = {
  level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
  plants: [{ pid: 1, level: 1 }, { pid: 2, level: 1 }, { pid: 3, level: 1 }, { pid: 4, level: 1 }, { pid: 18, level: 1 }],
  zombies: [],
  items: [],
  slotNum: 6,
  updatedAt: Date.now(),
  online: { username: 'refresh-owner', serverAddr: SERVER_ADDRESS, customServers: [] },
};

const GUEST_SAVE = {
  ...OWNER_SAVE,
  online: { username: 'refresh-guest', serverAddr: SERVER_ADDRESS, customServers: [] },
};

test('刷新页面后重连能重建 GameParams 并进入战局', async ({ browser }) => {
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const owner = await contextA.newPage();
  const guest = await contextB.newPage();
  try {
    await openGame(owner, { netDebug: true, save: OWNER_SAVE });
    await openGame(guest, { netDebug: true, save: GUEST_SAVE });
    const room = await openRoom(owner, { roomName: 'refresh', chapterId: 1, stageId: 1, username: 'refresh-owner' });
    await openRoom(guest, { roomId: room.roomId, chapterId: 1, stageId: 1, username: 'refresh-guest' });

    // 用真实 loadout 进入战局，保证 Phaser 运行并产生权威帧与快照。
    await owner.evaluate(() => window.MVZ_NET.chooseStage(1, 1));
    await waitForStage(owner, STAGE.Preparing);
    await waitForStage(guest, STAGE.Preparing);
    const loadout = [{ pid: 1, level: 1 }];
    await owner.evaluate((cards) => window.MVZ_NET.confirmLoadout(cards, 1, 1), loadout);
    await guest.evaluate((cards) => window.MVZ_NET.confirmLoadout(cards, 1, 1), loadout);
    await waitForStage(owner, STAGE.InGame);
    await waitForStage(guest, STAGE.InGame);
    await expect.poll(async () => simHash(owner), { timeout: 20000 }).not.toBeNull();

    // 开局能量面板必须立即显示权威值，而不是等第一次收获后才刷新。
    await expect.poll(
      async () => owner.evaluate(() => window.MVZ_NET.getGameRuntime().energyText),
      { timeout: 15000 },
    ).not.toBeNull();
    const ownerRuntime = await owner.evaluate(() => window.MVZ_NET.getGameRuntime());
    expect(ownerRuntime.energyText).toBe(String(ownerRuntime.energy));

    // 刷新前先种植，让能量与卡槽冷却偏离初始值；重连后必须恢复而不是重置。
    await guest.evaluate(() => window.MVZ_NET.plantAt(1, 1, 7, 0));
    await expect.poll(
      async () => (await guest.evaluate(() => window.MVZ_NET.getGameRuntime())).energy,
      { timeout: 15000 },
    ).toBeLessThan(100);
    const beforeReconnect = await guest.evaluate(() => window.MVZ_NET.getGameRuntime());
    const cooldownBefore = beforeReconnect.cardpile.find((card) => card.pid === 1)?.leftMs ?? 0;
    expect(cooldownBefore).toBeGreaterThan(0);

    // 模拟刷新：新进程丢失本地 GameParams，只能依赖服务端 profile。
    await guest.reload();
    await expect(guest.locator('#app')).toBeVisible({ timeout: 30000 });
    // 等待 Dexie 存档加载完成，避免在联机配置就绪前点击“开始游戏”。
    await guest.waitForTimeout(1500);
    // E2E 的 IndexedDB 注入与 Dexie 初始化存在时序差异，显式写入联机配置，
    // 与真实用户存档中的 online 字段等价。
    await guest.evaluate((config) => window.MVZ_NET.setOnlineConfigForTest(config), {
      username: 'refresh-guest',
      serverAddr: SERVER_ADDRESS,
    });
    await guest.getByRole('button', { name: '开始游戏', exact: true }).first().click();
    const dialog = guest.getByRole('dialog');
    await expect(dialog).toContainText('发现未结束的房间', { timeout: 20000 });
    await dialog.getByRole('button', { name: '重连', exact: true }).last().click();

    // 重连后应进入 InGame，并挂载 Phaser 场景。
    await expect.poll(async () => (await netState(guest))?.online, { timeout: 30000 }).toBe(true);
    await waitForStage(guest, STAGE.InGame, 30000);
    await expect.poll(async () => guest.evaluate(() => window.MVZ_NET?.getGameRuntime().timeScale), { timeout: 30000 })
      .not.toBeNull();
    await expect(guest.getByText('no game params')).toHaveCount(0);

    // 快照恢复后客户端继续产出确定性状态采样。
    await expect.poll(async () => simHash(guest), { timeout: 30000 }).not.toBeNull();

    // 资源 profile：刷新前的能量不得归零，卡槽冷却必须继续倒计时而不是卡死。
    await expect.poll(
      async () => (await guest.evaluate(() => window.MVZ_NET.getGameRuntime())).energy,
      { timeout: 20000 },
    ).toBeGreaterThanOrEqual(beforeReconnect.energy);
    await expect.poll(async () => {
      const runtime = await guest.evaluate(() => window.MVZ_NET.getGameRuntime());
      const cooldown = runtime.cardpile.find((card) => card.pid === 1);
      if (!cooldown || cooldown.totalMs <= 0) return 'missing';
      if (cooldown.leftMs === 0) return 'ready';
      return cooldown.leftMs < cooldownBefore ? 'cooling' : `stuck:${cooldown.leftMs}`;
    }, { timeout: 20000 }).toMatch(/cooling|ready/);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
