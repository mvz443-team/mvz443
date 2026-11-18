// E2E 场景：房间固定座位与准备状态同步。
// 验收点：
//   1. 建房者固定坐 0 号、后来者坐 1 号；两端看到的座位号一致；
//   2. 房主离开后剩下的玩家自动成为房主，新玩家补到空出来的 0 号位；
//   3. 等待房间里其他成员未准备时房主无法“开始”；准备后可推进到选卡；
//   4. 选卡阶段有人退出会回到等待房间，并清空所有人的准备状态。

import { test, expect } from 'playwright/test';
import { openGame, openRoom, netState, waitForStage, STAGE, SERVER_ADDRESS } from './helpers.mjs';

const GUEST_SAVE = {
  level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
  plants: [], zombies: [], items: [], slotNum: 6, updatedAt: Date.now(),
  online: { username: 'seat-guest', serverAddr: SERVER_ADDRESS, customServers: [] },
};
const THIRD_SAVE = {
  ...GUEST_SAVE,
  online: { username: 'seat-third', serverAddr: SERVER_ADDRESS, customServers: [] },
};

async function waitForPeerCount(page, count, timeout = 20000) {
  await expect.poll(async () => (await netState(page))?.peers?.length ?? 0,
    { timeout, intervals: [100, 200, 500] }).toBe(count);
}

function seats(state) {
  return Object.fromEntries((state.peers ?? []).map((peer) => [peer.id, peer.seat]));
}

test('固定座位：建房者 0 号、后来者 1 号，房主离开后新玩家补 0 号', async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext({ ignoreHTTPSErrors: true }),
    browser.newContext({ ignoreHTTPSErrors: true }),
    browser.newContext({ ignoreHTTPSErrors: true }),
  ]);
  const [owner, guest, third] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await openGame(owner, { netDebug: true });
    await openGame(guest, { netDebug: true, save: GUEST_SAVE });
    await openGame(third, { netDebug: true, save: THIRD_SAVE });

    const room = await openRoom(owner, { roomName: 'seats', chapterId: 1, stageId: 1, username: 'seat-owner' });
    await openRoom(guest, { roomId: room.roomId, chapterId: 1, stageId: 1, username: 'seat-guest' });
    await waitForPeerCount(owner, 2);
    await waitForPeerCount(guest, 2);

    const ownerState = await netState(owner);
    const guestState = await netState(guest);
    expect(seats(ownerState)).toEqual(seats(guestState));
    expect(seats(ownerState)[ownerState.myId]).toBe(0);
    expect(seats(ownerState)[guestState.myId]).toBe(1);
    expect(ownerState.lordId).toBe(ownerState.myId);

    // 房主退出：剩下的玩家自动成为房主，仍坐 1 号位。
    await owner.evaluate(() => window.MVZ_NET.closeRoom());
    await waitForPeerCount(guest, 1);
    const afterOwnerLeft = await netState(guest);
    expect(afterOwnerLeft.lordId).toBe(afterOwnerLeft.myId);
    expect(seats(afterOwnerLeft)[afterOwnerLeft.myId]).toBe(1);

    // 新玩家补到空出来的 0 号位；房主身份不变。
    await openRoom(third, { roomId: room.roomId, chapterId: 1, stageId: 1, username: 'seat-third' });
    await waitForPeerCount(guest, 2);
    await waitForPeerCount(third, 2);
    const thirdState = await netState(third);
    expect(seats(thirdState)[thirdState.myId]).toBe(0);
    expect(seats(thirdState)[afterOwnerLeft.myId]).toBe(1);
    expect(thirdState.lordId).toBe(afterOwnerLeft.myId);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('房主开始需其他成员准备，成员退出后清空准备状态', async ({ browser }) => {
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const owner = await contextA.newPage();
  const guest = await contextB.newPage();
  try {
    await openGame(owner, { netDebug: true });
    await openGame(guest, { netDebug: true, save: GUEST_SAVE });
    const room = await openRoom(owner, { roomName: 'ready-reset', chapterId: 1, stageId: 1, username: 'ready-owner' });
    await openRoom(guest, { roomId: room.roomId, chapterId: 1, stageId: 1, username: 'ready-guest' });
    await waitForPeerCount(owner, 2);

    // 其他成员未准备时房主点“开始”不生效。
    await owner.evaluate(() => window.MVZ_NET.chooseStage(1, 1));
    await owner.waitForTimeout(500);
    expect((await netState(owner))?.stage).toBe(STAGE.InLobby);

    // 其他成员准备后房主才能推进到选卡阶段。
    await guest.evaluate(() => window.MVZ_NET.sendReady(true));
    await expect.poll(async () => {
      const state = await netState(owner);
      return state?.peers?.some((peer) => peer.id !== state.myId && peer.ready) ?? false;
    }, { timeout: 20000, intervals: [100, 200, 500] }).toBe(true);
    await owner.evaluate(() => window.MVZ_NET.chooseStage(1, 1));
    await waitForStage(owner, STAGE.Preparing);
    await waitForStage(guest, STAGE.Preparing);

    // 选卡阶段有人退出：回到等待房间，且所有人的准备标记清零。
    await guest.evaluate(() => window.MVZ_NET.closeRoom());
    await waitForStage(owner, STAGE.InLobby);
    await waitForPeerCount(owner, 1);
    const state = await netState(owner);
    expect(state.peers?.every((peer) => !peer.ready)).toBe(true);

    // 准备状态清空后可以再次开始。
    await owner.evaluate(() => window.MVZ_NET.chooseStage(1, 1));
    await waitForStage(owner, STAGE.Preparing);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
