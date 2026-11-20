const calls = [];
let randomState = 20261117;

const MobCmd = {
  calls,
  Spawn(mid, scene, col, row, waveID, callback) {
    calls.push({ kind: "spawn", mid, scene, col, row, waveID, callback });
  },
  DamagePlantsArea(centerCol, centerRow, radiusX, radiusY, damage) {
    calls.push({ kind: "damageArea", centerCol, centerRow, radiusX, radiusY, damage });
  },
  DamagePlantsInCells(cells, damage) {
    calls.push({ kind: "damageCells", cells: cells.map((cell) => ({ ...cell })), damage });
  },
  EmitBossHealth(entity) {
    calls.push({ kind: "bossHealth", health: entity.currentHealth, maxHealth: entity.maxHealth });
  },
  AnnounceBossSkill(scene, bossKey, skillKey, durationMs = 2000) {
    calls.push({ kind: "announce", bossKey, skillKey, durationMs });
  },
  DeterministicRandom(min = 0, max = 1) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return min + (randomState / 0x100000000) * (max - min);
  },
  reset(seed = 20261117) {
    calls.length = 0;
    randomState = seed >>> 0;
  },
};

export default MobCmd;
