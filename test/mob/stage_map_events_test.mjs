import test from "node:test";
import assert from "node:assert/strict";
import stage9, {
  STAGE9_COLLAPSE_CELLS,
  STAGE9_COLLAPSE_WATER_DELAY_MS,
  STAGE9_COLLAPSE_WAVE,
  STAGE9_LIGHT_FLICKER_COUNT,
  STAGE9_LIGHTS_OUT_WAVE,
} from "../../src/game/stages/chapter1/stage9.ts";

/**
 * 描述（ch9 地图事件脚本 / stage9.ts）：
 *   - 第 22 波：第 2,3,5,6 行（1-based）的第 3,4,6,7,8 列（1-based）崩塌成水路；
 *     表现（collapse 标记 + 崩塌动画）立即触发，权威水格由可恢复计时器延迟 600ms 改写；
 *   - 第 36 波：光照闪烁 3 次后取消地图光照（dayOrNight -> night）并停止自动产能；
 *   - 事件由权威波次回调驱动，必须幂等（回滚重放会重复触发），标记通过 ctx 读写。
 *
 * 验收路径：
 *   用测试替身 ctx 驱动 stage9.script.onWaveStart / syncView，记录格子、标记与副作用调用。
 *
 * 预期结果：
 *   collapse cells 20 个，行 [1,2,4,5]、列 [2,3,5,6,7]；
 *   第 22 波置 collapse 标记、播放崩塌、调度延迟 600ms 的变水格（不立即改格子）；重复触发不再调度；
 *   第 36 波置 lightsOut、dayOrNight=false、停产能、闪烁 3 次；
 *   syncView 按 collapse 标记重建水面覆盖层。
 *
 * 为什么：
 *   关卡逻辑集中在脚本里，管理器只做通用调度；标记进快照保证回滚/重连一致，
 *   脚本幂等保证重放不重复生效；逻辑变水格用可恢复计时器，避免 desync。
 */

function makeCtx(initialFlags = {}) {
  const flags = { collapse: false, collapseWater: false, lightsOut: false, ...initialFlags };
  const calls = {
    waterCells: [],
    scheduledWater: null,
    collapseVisual: null,
    flicker: null,
    day: null,
    stopEnergy: 0,
    waterTiles: null,
  };
  const ctx = {
    stageId: 9,
    rows: 7,
    cols: 9,
    giftPlant() {},
    fillRowWater() {},
    setCellWater(col, row) { calls.waterCells.push(`${col}-${row}`); },
    scheduleCellWater(cells, delayMs) { calls.scheduledWater = { cells, delayMs }; },
    addDarkOverlay() {},
    setDayOrNight(day) { calls.day = day; },
    stopAutoEnergy() { calls.stopEnergy += 1; },
    registerBossHooks() {},
    playCollapseVisual(cells) { calls.collapseVisual = cells; },
    playLightFlicker(count) { calls.flicker = count; },
    syncWaterTiles(cells, visible) { calls.waterTiles = { cells, visible }; },
    getFlag(key) { return flags[key]; },
    setFlag(key, value) { flags[key] = value; },
  };
  return { ctx, flags, calls };
}

test("崩塌格子集合：4 行 × 5 列 = 20 格，0-based 且确定", () => {
  assert.equal(STAGE9_COLLAPSE_WAVE, 22);
  assert.equal(STAGE9_LIGHTS_OUT_WAVE, 36);
  assert.equal(STAGE9_LIGHT_FLICKER_COUNT, 3);

  assert.equal(STAGE9_COLLAPSE_CELLS.length, 20);
  const rows = [...new Set(STAGE9_COLLAPSE_CELLS.map((c) => c.row))].sort((a, b) => a - b);
  const cols = [...new Set(STAGE9_COLLAPSE_CELLS.map((c) => c.col))].sort((a, b) => a - b);
  assert.deepEqual(rows, [1, 2, 4, 5]);
  assert.deepEqual(cols, [2, 3, 5, 6, 7]);
  const keys = new Set(STAGE9_COLLAPSE_CELLS.map((c) => `${c.col}-${c.row}`));
  assert.equal(keys.size, STAGE9_COLLAPSE_CELLS.length);
});

test("第 22 波：置 collapse 标记、播放崩塌、调度 600ms 后变水格，且幂等", () => {
  const { ctx, flags, calls } = makeCtx();
  stage9.script.onWaveStart(ctx, 22);
  assert.equal(flags.collapse, true);
  // 表现立即触发，但逻辑格子不立即改（由可恢复 timer 延迟驱动）。
  assert.equal(calls.waterCells.length, 0, "不应立即改格子");
  assert.ok(calls.collapseVisual, "应播放崩塌表现");
  assert.equal(calls.scheduledWater?.delayMs, STAGE9_COLLAPSE_WATER_DELAY_MS);
  assert.equal(calls.scheduledWater?.delayMs, 600);
  assert.equal(calls.scheduledWater?.cells.length, 20);
  assert.deepEqual(calls.scheduledWater?.cells, [...STAGE9_COLLAPSE_CELLS]);

  // 幂等：重复触发不再调度。
  stage9.script.onWaveStart(ctx, 22);
  assert.equal(calls.scheduledWater?.cells.length, 20, "重复触发不应再次调度变水格");
  assert.equal(calls.waterCells.length, 0);
});

test("第 36 波：置 lightsOut、切夜晚、停产能、闪烁 3 次，且幂等", () => {
  const { ctx, flags, calls } = makeCtx();
  stage9.script.onWaveStart(ctx, 36);
  assert.equal(flags.lightsOut, true);
  assert.equal(calls.day, false, "应切到夜晚");
  assert.equal(calls.stopEnergy, 1);
  assert.equal(calls.flicker, 3);

  stage9.script.onWaveStart(ctx, 36);
  assert.equal(calls.stopEnergy, 1, "重复触发不应再次停产能");
});

test("syncView 按 collapse 标记重建/回收水面覆盖层", () => {
  const collapsed = makeCtx({ collapse: true });
  stage9.script.syncView(collapsed.ctx);
  assert.equal(collapsed.calls.waterTiles?.visible, true);
  assert.equal(collapsed.calls.waterTiles?.cells.length, 20);

  const before = makeCtx({ collapse: false });
  stage9.script.syncView(before.ctx);
  assert.equal(before.calls.waterTiles?.visible, false);
});

test("onCombatStart 注册 boss 钩子", () => {
  let registered = null;
  const { ctx } = makeCtx();
  ctx.registerBossHooks = (hooks) => { registered = hooks; };
  stage9.script.onCombatStart(ctx);
  assert.ok(registered && typeof registered.onSpawn === "function", "应注册 onSpawn 钩子");
});
