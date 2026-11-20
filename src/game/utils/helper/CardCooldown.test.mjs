import assert from 'node:assert/strict';
import test from 'node:test';

// 帧推导冷却回归：冷却只由权威帧与当前帧决定，不逐帧递减、不进入快照。
const {
  cooldownDurationFrames,
  computeCooldownEndFrame,
  cooldownLeftMsAt,
  cooldownEndFrameFromProfile,
} = await import('./CardCooldown.ts');

const INTERVAL = 50;

test('冷却时长换算成整数帧并向上取整', () => {
  assert.equal(cooldownDurationFrames(6000, INTERVAL), 120);
  assert.equal(cooldownDurationFrames(575, INTERVAL), 12);
  assert.equal(cooldownDurationFrames(0, INTERVAL), 0);
  assert.equal(cooldownDurationFrames(-10, INTERVAL), 0);
  assert.equal(cooldownDurationFrames(1000, 0), 0);
});

test('种植权威帧决定冷却结束帧', () => {
  // 权威帧 200 种下 6s 冷却的卡，结束帧 320。
  assert.equal(computeCooldownEndFrame(200, 6000, INTERVAL), 320);
  // 权威帧即当前帧时剩余满冷却；过了 3 帧已冷却 150ms。
  assert.equal(cooldownLeftMsAt(320, 200, INTERVAL), 6000);
  assert.equal(cooldownLeftMsAt(320, 203, INTERVAL), 5850);
  // 到结束帧及之后就绪，不会为负。
  assert.equal(cooldownLeftMsAt(320, 320, INTERVAL), 0);
  assert.equal(cooldownLeftMsAt(320, 999, INTERVAL), 0);
});

test('点击预演期间按已过帧数扣减（权威帧落后于当前帧）', () => {
  // 权威帧 200 种下 4s 冷却，客户端在帧 206 才看到权威结果。
  const endFrame = computeCooldownEndFrame(200, 4000, INTERVAL);
  // 已经过去 6 帧 = 300ms，剩余 3700ms，而不是重新从 4000ms 开始。
  assert.equal(cooldownLeftMsAt(endFrame, 206, INTERVAL), 3700);
});

test('服务端 profile 的 leftMs 能反推结束帧', () => {
  // profile 在帧 300 上报剩余 1500ms → 结束帧 330。
  assert.equal(cooldownEndFrameFromProfile(300, 1500, INTERVAL), 330);
  assert.equal(cooldownLeftMsAt(330, 300, INTERVAL), 1500);
  assert.equal(cooldownLeftMsAt(330, 315, INTERVAL), 750);
});

test('回滚后用同一个权威帧重建得到相同冷却', () => {
  // 连续运行：帧 120 种植；回滚到帧 110 后重放同一操作，权威帧仍是 120。
  const plantFrame = 120;
  const totalMs = 3000;
  const endFrame = computeCooldownEndFrame(plantFrame, totalMs, INTERVAL);
  const continuous = cooldownLeftMsAt(endFrame, 130, INTERVAL);
  const afterReplay = cooldownLeftMsAt(
    computeCooldownEndFrame(plantFrame, totalMs, INTERVAL),
    130,
    INTERVAL,
  );
  assert.equal(continuous, afterReplay);
  // 3s = 60 帧，当前帧比种植帧晚 10 帧，还剩 50 帧 = 2500ms。
  assert.equal(continuous, 2500);
});
