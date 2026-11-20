import assert from 'node:assert/strict';
import test from 'node:test';

// 跨端一致性哈希回归：本机席位号与本地输入预演不得进入权威快照。
const { StateRegistry } = await import('./SimulationState.ts');
const ResourceManager = (await import('../managers/combat/ResourceManager.ts')).default;
const CardpileManager = (await import('../managers/combat/CardpileManager.ts')).default;

function makeClient({ myId, energyPreview, cardPreview }) {
  const resources = new ResourceManager();
  resources.mineId = myId;
  resources.UpdateEnergy(120, 100);
  resources.UpdateEnergy(80, 101);
  resources.UpdateStarShards(3, 100);
  resources.UpdateStarShards(1, 101);
  resources.ApplyPreviewEnergy(energyPreview, 100);
  resources.ApplyPreviewStarShards(1, 101);

  const cardpile = new CardpileManager();
  // 冷却按权威帧推导，previewPending 属于本机预演，不得进入跨端状态。
  cardpile.cardpileStatus.set(1, { level: 2, cooldownEndFrame: 10, previewPending: Boolean(cardPreview), totalMs: 1000 });
  cardpile.cardpileStatus.set(3, { level: 1, cooldownEndFrame: 5, previewPending: false, totalMs: 800 });

  const registry = new StateRegistry();
  registry.registerValue('resources', () => resources.CaptureCanonicalResourceState());
  registry.registerValue('cardpile', () => cardpile.CaptureCanonicalCardpileState());
  return { registry, resources, cardpile };
}

test('不同 myId 与本地预演值的两端哈希一致', () => {
  const host = makeClient({ myId: 100, energyPreview: -25, cardPreview: 1 });
  const guest = makeClient({ myId: 101, energyPreview: -10, cardPreview: 0 });

  assert.equal(host.registry.hash().h64, guest.registry.hash().h64);
  // 权威冷却数组里不应出现预演字段。
  const canonical = host.cardpile.CaptureCanonicalCardpileState();
  assert.deepEqual(Object.keys(canonical.cards[0]).sort(), ['leftMs', 'level', 'pid', 'totalMs']);
});

test('权威资源变化仍会改变哈希', () => {
  const a = makeClient({ myId: 100, energyPreview: 0, cardPreview: 0 });
  const b = makeClient({ myId: 100, energyPreview: 0, cardPreview: 0 });
  b.resources.UpdateEnergy(1, 100);
  assert.notEqual(a.registry.hash().h64, b.registry.hash().h64);
});

test('恢复 profile 按帧重建冷却且清除本地预演', () => {
  const client = makeClient({ myId: 101, energyPreview: -25, cardPreview: 1 });
  const snapshot = client.resources.GetResourceState();
  client.resources.RestoreResourceState({
    'energy:100': 120,
    'energy:101': 80,
    'star:100': 3,
    'star:101': 1,
  });

  assert.equal(client.resources.mineId, 101);
  assert.equal(client.resources.getDisplayEnergy(100), 120);
  assert.equal(client.resources.getDisplayEnergy(101), 80);

  client.cardpile.RestoreCardpileState({
    cards: [{ pid: 1, level: 2, leftMs: 500, totalMs: 1000 }],
  }, 0);
  assert.equal(client.cardpile.cardpileStatus.get(1).previewPending, false);
  // leftMs=500、帧间隔 50ms → 结束帧 10；当前帧 0 → 剩余 500ms。
  assert.equal(client.cardpile.getCardLeftMs(1), 500);
  assert.ok(Object.keys(snapshot).includes('mineId'));
});
