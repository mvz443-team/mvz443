import test from "node:test";
import assert from "node:assert/strict";
import TickerManager from "../../src/game/managers/combat/TickerManager.ts";
import {
  RESOURCE_GAIN_DELAY_MS,
  RESOURCE_ADD_ENERGY_TIMER,
  RESOURCE_ADD_STARSHARD_TIMER,
  splitEnergyAmount,
} from "../../src/game/utils/cmd/ResourceTiming.ts";

/**
 * 描述（资源延迟到账 / 全局计时器）：
 *   能量/星碎的 WithAnim API 把动画与到账解耦：动画立即播，到账由带 snapshot 的
 *   全局计时器延迟固定 900ms 后调用原 API。能量动画按 100=large/50=medium/25=small
 *   拆分（尽量用大数字），但到账只 delay 一次、加总数量。计时器状态与 args 进
 *   快照/哈希，重连时走工厂按纯 JSON args 重建，保证 desync 安全。
 *
 * 验收路径：
 *   1) 断言能量数值拆分正确（450→large×4+medium，25→small，余数保底）；
 *   2) 注册资源到账 timer 工厂，delayedCall 断言快照 kind/args；
 *   3) rebuild 恢复后到点触发一次、参数正确；
 *   4) 回滚删除快照后新建 timer。
 *
 * 预期结果：
 *   拆分正确；timer 快照含 kind + {amount}；rebuild 后回调按 amount 到账一次；回滚删除新 timer。
 *
 * 为什么：
 *   TickerManager 的 snapshot/工厂重建是 preset.autoEnergy 等已验证链路；
 *   到账逻辑只吃 JSON amount，动画拆分纯表现，二者不共享随机流，跨端一致。
 */

test("能量数值拆分：100=large / 50=medium / 25=small，尽量用大数字", () => {
  assert.deepEqual(splitEnergyAmount(450), ["large", "large", "large", "large", "medium"]);
  assert.deepEqual(splitEnergyAmount(25), ["small"]);
  assert.deepEqual(splitEnergyAmount(100), ["large"]);
  assert.deepEqual(splitEnergyAmount(175), ["large", "medium", "small"]);
  assert.deepEqual(splitEnergyAmount(30), ["small", "small"], "不足 25 的余数按 small 保底");
  assert.deepEqual(splitEnergyAmount(0), []);
});

test("资源到账 timer：快照含 kind + {amount}，rebuild 后到点到账一次", () => {
  const ticker = TickerManager.Instance;
  ticker.Reset();
  ticker.setNextTimerId(1);

  const credited = [];
  ticker.registerTimerFactory(RESOURCE_ADD_ENERGY_TIMER, (args) => {
    const amount = Number(args?.amount);
    if (!Number.isFinite(amount)) return null;
    return { callback: () => credited.push(amount) };
  });

  const timer = ticker.delayedCall({
    delay: RESOURCE_GAIN_DELAY_MS,
    callback: () => credited.push(450),
    snapshot: { kind: RESOURCE_ADD_ENERGY_TIMER, args: { amount: 450 } },
  });

  const states = ticker.GetTimerStates();
  const snap = states.find((s) => s.id === timer.id);
  assert.ok(snap);
  assert.equal(snap.kind, RESOURCE_ADD_ENERGY_TIMER);
  assert.deepEqual(snap.args, { amount: 450 });
  assert.equal(snap.targetFrame, Math.ceil(RESOURCE_GAIN_DELAY_MS / ticker.frameInterval));

  const report = { ok: true, restored: [], missing: [], errors: [] };
  ticker.RestoreTimerStates(states, {
    mode: "rebuild", frameId: 0, nextTimerId: timer.id + 1, report,
  });
  assert.equal(report.missing.length, 0);
  assert.ok(report.restored.some((r) => r.includes(RESOURCE_ADD_ENERGY_TIMER)));

  for (let i = 0; i < snap.targetFrame; i++) ticker.Update();
  assert.deepEqual(credited, [450], "到账一次，且是总数量");

  ticker.Reset();
});

test("回滚到到账前：删除快照之后新建的资源 timer", () => {
  const ticker = TickerManager.Instance;
  ticker.Reset();
  ticker.setNextTimerId(1);

  ticker.registerTimerFactory(RESOURCE_ADD_STARSHARD_TIMER, (args) => {
    const amount = Number(args?.amount);
    if (!Number.isFinite(amount)) return null;
    return { callback: () => {} };
  });
  ticker.delayedCall({
    delay: RESOURCE_GAIN_DELAY_MS,
    callback: () => {},
    snapshot: { kind: RESOURCE_ADD_STARSHARD_TIMER, args: { amount: 1 } },
  });

  const before = ticker.GetTimerStates();
  ticker.Update();
  ticker.delayedCall({
    delay: RESOURCE_GAIN_DELAY_MS,
    callback: () => {},
    snapshot: { kind: RESOURCE_ADD_STARSHARD_TIMER, args: { amount: 1 } },
  });
  assert.equal(ticker.GetTimerStates().length, 2);

  const report = { ok: true, restored: [], missing: [], errors: [] };
  ticker.RestoreTimerStates(before, {
    mode: "in-place", frameId: 0, nextTimerId: 2, report,
  });
  assert.equal(ticker.GetTimerStates().length, 1, "快照之后新建的 timer 必须被回滚删除");

  ticker.Reset();
});
