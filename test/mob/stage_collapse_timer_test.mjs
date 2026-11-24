import test from "node:test";
import assert from "node:assert/strict";
import TickerManager from "../../src/game/managers/combat/TickerManager.ts";

/**
 * 描述（ch9 崩塌逻辑水格计时器 / 可恢复性）：
 *   崩塌表现（crop 土地颤抖 + 塌陷）与权威水格拆成两个独立事件：表现立即触发，
 *   逻辑变水格由 TickerManager 的带 snapshot timer 延迟 600ms 触发。该 timer 必须
 *   进快照/哈希，并能在 checkpoint rebuild 后按 kind + 纯 JSON args 重建回调，
 *   从而回滚/重连/跨进程都不会丢失或重复触发。
 *
 * 验收路径：
 *   1) 用 registerTimerFactory 注册 "preset.stageCollapseWater" 工厂，工厂从 args 重建回调；
 *   2) delayedCall 注册 timer，断言 GetTimerStates 含 kind + JSON args；
 *   3) 导出 timer 状态 -> RestoreTimerStates(rebuild) -> 断言回调按原参数被重建；
 *   4) 推进帧到目标帧，断言回调恰好触发一次、参数正确。
 *
 * 预期结果：
 *   timer 快照 kind/args 完整；rebuild 后回调恢复；到点触发一次且参数一致。
 *
 * 为什么：
 *   TickerManager 的 timer 状态参与 SimulationState 快照与哈希；工厂重建是
 *   `preset.autoEnergyStart` 等已验证的成熟链路。崩塌逻辑水格复用它即可保证 desync 安全。
 */

const KIND = "preset.stageCollapseWater";
const CELLS = [{ col: 2, row: 1 }, { col: 3, row: 1 }, { col: 5, row: 4 }];

test("崩塌水格 timer：快照含 kind + JSON args，rebuild 后回调按参数恢复", () => {
  const ticker = TickerManager.Instance;
  ticker.Reset();
  ticker.setNextTimerId(1);

  const fired = [];
  // 工厂从 args 捕获格子到闭包（与真实 PresetEventManager.applyStageCollapseWater 一致），
  // 因为 rebuild 不恢复运行时 args 数组，arg 必须编进回调闭包。
  ticker.registerTimerFactory(KIND, (args) => {
    if (!Array.isArray(args)) return null;
    const cells = args;
    return { callback: () => fired.push({ cells, tick: ticker.currentFrame }) };
  });

  const timer = ticker.delayedCall({
    delay: 600,
    callback: () => fired.push({ cells: CELLS, tick: ticker.currentFrame }),
    snapshot: { kind: KIND, args: CELLS },
  });

  const states = ticker.GetTimerStates();
  const snap = states.find((s) => s.id === timer.id);
  assert.ok(snap, "timer 必须进快照");
  assert.equal(snap.kind, KIND);
  assert.deepEqual(snap.args, CELLS, "args 必须是 JSON 安全且参与哈希的纯数据");
  assert.equal(snap.targetFrame, Math.ceil(600 / ticker.frameInterval) + 0);

  // 模拟 checkpoint rebuild：清空后用快照重建。
  const report = { ok: true, restored: [], missing: [], errors: [] };
  ticker.RestoreTimerStates(states, {
    mode: "rebuild",
    frameId: 0,
    nextTimerId: timer.id + 1,
    report,
  });
  assert.equal(report.missing.length, 0, "rebuild 不应丢失 timer");
  assert.ok(report.restored.some((r) => r.includes(KIND)), "应通过工厂重建");

  // 推进到目标帧后回调触发一次，参数正确。
  const target = snap.targetFrame;
  for (let i = 0; i < target; i++) ticker.Update();
  assert.equal(fired.length, 1, "回调应恰好触发一次");
  assert.deepEqual(fired[0].cells, CELLS);

  ticker.Reset();
});

test("崩塌水格 timer：回滚到触发前会删除快照后新增的 timer", () => {
  const ticker = TickerManager.Instance;
  ticker.Reset();
  ticker.setNextTimerId(1);

  ticker.registerTimerFactory(KIND, (args) => {
    if (!Array.isArray(args)) return null;
    return { callback: () => {} };
  });
  ticker.delayedCall({
    delay: 600,
    callback: () => {},
    snapshot: { kind: KIND, args: CELLS },
  });

  const before = ticker.GetTimerStates();
  // 推进几帧后新建一个 timer（模拟快照之后的分支操作）。
  ticker.Update();
  ticker.Update();
  ticker.delayedCall({ delay: 600, callback: () => {}, snapshot: { kind: KIND, args: CELLS } });
  assert.equal(ticker.GetTimerStates().length, 2);

  const report = { ok: true, restored: [], missing: [], errors: [] };
  ticker.RestoreTimerStates(before, {
    mode: "in-place",
    frameId: 0,
    nextTimerId: 2,
    report,
  });
  assert.equal(ticker.GetTimerStates().length, 1, "快照之后新建的 timer 必须被回滚删除");
  assert.equal(ticker.currentFrame, 0);

  ticker.Reset();
});
