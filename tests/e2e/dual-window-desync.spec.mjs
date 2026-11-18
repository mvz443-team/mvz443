// E2E 场景：两个隔离浏览器上下文（等价两个无痕窗口）真实联机对战。
// 这是 sim-debug 纯逻辑测试之外的浏览器级验收：真实 Phaser 场景 + Rapier 物理 +
// 真实 DOM/帧循环 + 真实 WebSocket 服务端，验证：
//   1. 双方能建房/加入/准备/加载，进入同一 InGame 战局；
//   2. 权威帧在两端同步推进（frameId 对齐）；
//   3. 双方执行同一批权威操作后，确定性状态哈希在同一帧完全一致（无分叉）。
// 该用例能捕捉 sim 测不到的问题：浏览器后台节流、渲染帧写回物理、事件总线串位、
// 首字节路由误判、checkpoint 后重连冻结、结束结果矛盾等。

import { test, expect } from 'playwright/test';
import {
  openGame, openRoom, netState, waitForStage, waitForMatchingHashFrame, simHash, STAGE, SERVER_ADDRESS,
} from './helpers.mjs';

// 每个 context 都是独立的存储分区，语义等同“两个无痕窗口”。
// 一份使用默认解锁存档，另一份显式注入，确保两端卡组/关卡一致。
const GUEST_SAVE = {
  level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
  plants: [{ pid: 1, level: 1 }, { pid: 2, level: 1 }, { pid: 3, level: 1 }, { pid: 4, level: 1 }, { pid: 18, level: 1 }],
  zombies: [],
  items: [],
  slotNum: 6,
  updatedAt: Date.now(),
  online: { username: 'desync-checker', serverAddr: SERVER_ADDRESS, customServers: [] },
};

test('双无痕窗口联机：同帧权威操作的确定性状态哈希一致', async ({ browser }) => {
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const owner = await contextA.newPage();
  const guest = await contextB.newPage();
  try {
    await openGame(owner, { netDebug: true });
    await openGame(guest, { netDebug: true, save: GUEST_SAVE });

    // 建房 → 加入 → 选图。之后用 confirmLoadout 走真实 UI 的“确认/准备”路径，
    // 它会同时设置 GameParams（Phaser 挂载的前提）与发送带 loadout 的 ready。
    const room = await openRoom(owner, { roomName: 'dual-window', chapterId: 1, stageId: 1 });
    expect(room.roomId).toBeGreaterThanOrEqual(0);
    await openRoom(guest, { roomId: room.roomId, chapterId: 1, stageId: 1 });
    await expect.poll(async () => (await netState(owner)).peers?.length ?? 0, { timeout: 20000 }).toBe(2);
    await owner.evaluate(() => window.MVZ_NET.chooseStage(1, 1));
    await waitForStage(owner, STAGE.Preparing);
    await waitForStage(guest, STAGE.Preparing);
    const loadout = [{ pid: 1, level: 1 }];
    await owner.evaluate((cards) => window.MVZ_NET.confirmLoadout(cards, 1, 1), loadout);
    await guest.evaluate((cards) => window.MVZ_NET.confirmLoadout(cards, 1, 1), loadout);
    await waitForStage(owner, STAGE.Loading);
    await waitForStage(guest, STAGE.Loading);
    await expect.poll(async () => (await netState(owner)).peers?.every((p) => p.ready) ?? false, { timeout: 20000 }).toBe(true);
    await owner.evaluate(() => window.MVZ_NET.sendLoaded(true));
    await guest.evaluate(() => window.MVZ_NET.sendLoaded(true));
    await waitForStage(owner, STAGE.InGame);
    await waitForStage(guest, STAGE.InGame);
    // stage=InGame 只是 onlineStateManager 标记；必须等 Phaser Game 场景挂载，
    // SyncManager.Load() 才会把 recvQueue 绑到 BackendWS，权威帧才开始被消费。
    await expect.poll(async () => owner.locator('#game-container canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);
    await expect.poll(async () => guest.locator('#game-container canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);

    // 第一处一致性：开局后双方应自然推进到同一权威帧并采样到相同哈希。
    const atStart = await waitForMatchingHashFrame(owner, guest);
    expect(atStart.a).toBe(atStart.b);

    // 双方各执行一次真实种植（同一权威帧只会落地一次，两端顺序由服务端统一）。
    // 用不同格子避免服务端同帧同格去重吞掉其中一个操作。
    await owner.evaluate(() => window.MVZ_NET.plantAt(1, 1, 1, 0));
    await guest.evaluate(() => window.MVZ_NET.plantAt(1, 1, 7, 0));

    // 操作落地后再次比对：若任一端预测提前改了 Model、timer 起点不同、PRNG 串位、
    // 或渲染写回物理，哈希都会在后续采样点分叉。
    const afterOps = await waitForMatchingHashFrame(owner, guest, 30000, atStart.frameId);
    expect(afterOps.a).toBe(afterOps.b);

    // 帧推进本身也要对齐：两端权威帧号不应相差超过 1（网络抖动允许一帧差）。
    const [fA, fB] = await Promise.all([
      netState(owner).then((s) => s.frameId),
      netState(guest).then((s) => s.frameId),
    ]);
    expect(Math.abs(fA - fB)).toBeLessThanOrEqual(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
