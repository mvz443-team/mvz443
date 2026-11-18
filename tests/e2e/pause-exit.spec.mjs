// E2E：对局中确认退出 —— 永离房间、取消房间、直接回主菜单，不能重连。
// 验收点：联机暂停菜单不暂停模拟、倍速锁定；二次确认提示无法重连；
// 退出方 online/roomSession=false 且回到主菜单；房间被销毁（/user-room 查不到席位）；
// 另一方收到 roomClosed 且状态被清空。

import { test, expect } from 'playwright/test';
import {
  openGame, openRoom, netState, waitForStage, STAGE, SERVER_ADDRESS,
} from './helpers.mjs';

// 服务端使用自签证书，Node 侧 fetch 需要放行。
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const GUEST_SAVE = {
  level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
  plants: [{ pid: 1, level: 1 }, { pid: 2, level: 1 }, { pid: 3, level: 1 }, { pid: 4, level: 1 }, { pid: 18, level: 1 }],
  zombies: [],
  items: [],
  slotNum: 6,
  updatedAt: Date.now(),
  online: { username: 'quit-guest', serverAddr: SERVER_ADDRESS, customServers: [] },
};

async function startDuel(browser, roomName) {
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const owner = await contextA.newPage();
  const guest = await contextB.newPage();
  await openGame(owner, { netDebug: true });
  await openGame(guest, { netDebug: true, save: GUEST_SAVE });
  const room = await openRoom(owner, { roomName, chapterId: 1, stageId: 1, username: 'quit-owner' });
  await openRoom(guest, { roomId: room.roomId, chapterId: 1, stageId: 1, username: 'quit-guest' });
  await owner.evaluate(() => window.MVZ_NET.chooseStage(1, 1));
  await waitForStage(owner, STAGE.Preparing);
  await waitForStage(guest, STAGE.Preparing);
  const loadout = [{ pid: 1, level: 1 }];
  await owner.evaluate((cards) => window.MVZ_NET.confirmLoadout(cards, 1, 1), loadout);
  await guest.evaluate((cards) => window.MVZ_NET.confirmLoadout(cards, 1, 1), loadout);
  await waitForStage(owner, STAGE.InGame);
  await waitForStage(guest, STAGE.InGame);
  return { contextA, contextB, owner, guest };
}

test('联机暂停菜单：打开后模拟继续、倍速锁定', async ({ browser }) => {
  const { contextA, contextB, owner } = await startDuel(browser, 'pause-view');
  try {
    const before = await netState(owner);
    expect(await owner.evaluate(() => window.MVZ_NET.toggleOnlinePauseMenu())).toBe(true);

    // 菜单显示，但模型没有暂停，场景时钟保持 1x。
    await expect.poll(async () => owner.evaluate(() => window.MVZ_NET.getGameRuntime()), { timeout: 5000 })
      .toMatchObject({ paused: false, timeScale: 1, pauseMenu: { visible: true } });
    // 游戏仍在推进：权威帧号继续增长。
    await expect.poll(async () => (await netState(owner)).frameId, { timeout: 10000 }).toBeGreaterThan(before.frameId);

    // 即使绕过灰显 UI 直接调用快捷切换，联机也不会变速。
    expect(await owner.evaluate(() => window.MVZ_NET.toggleTimeSpeedForTest())).toBe(false);
    await expect.poll(async () => owner.evaluate(() => window.MVZ_NET.getGameRuntime()), { timeout: 5000 })
      .toMatchObject({ paused: false, timeScale: 1, pauseMenu: { visible: true } });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('对局中确认退出：取消房间、不能重连、对方收到房间关闭', async ({ browser }) => {
  const { contextA, contextB, owner, guest } = await startDuel(browser, 'quit-test');
  try {
    // 退出入口是暂停菜单里的真实二次确认（联机提示无法重连）。
    expect(await owner.evaluate(() => window.MVZ_NET.toggleOnlinePauseMenu())).toBe(true);
    expect(await owner.evaluate(() => window.MVZ_NET.requestPauseMenuExit())).toBe(true);
    const dialog = owner.getByRole('dialog');
    await expect(dialog).toContainText('退出后房间将被取消，你无法重连');
    await dialog.getByRole('button', { name: '退出游戏' }).click();

    // 退出方：永久离房 + 取消房间 + 回主菜单（不显示结算页）。
    await expect.poll(async () => (await netState(owner))?.online, { timeout: 20000 }).toBe(false);
    const ownerState = await netState(owner);
    expect(ownerState.roomSession).toBe(false);
    await expect(owner.getByText('暂停', { exact: false })).toBeHidden().catch(() => {});
    await expect(owner.locator('#app')).toBeVisible();

    // 房间被取消：服务端的席位查询不再返回任何玩家，无法重连。
    await expect.poll(async () => {
      try {
        const res = await fetch(`https://${SERVER_ADDRESS}/user-room?user=tester`);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }, { timeout: 20000 }).toBeFalsy();

    // 对方：房间关闭，在线状态被清空且显示 Toast。
    await expect.poll(async () => (await netState(guest))?.online, { timeout: 20000 }).toBe(false);
    const guestState = await netState(guest);
    expect(guestState.roomSession).toBe(false);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
