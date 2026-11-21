// 测试替身：波次生成保持简化，但选行相关纯函数与真实 StageHelper.ts 保持一致，
// 以便 MobHelper 的地形过滤逻辑可以在不加载 MonsterLibrary 的情况下被真实驱动。
const SMOOTH_ROW_COUNT = 6;
const MIN_SMOOTH_FACTOR = 0.01;
const MAX_SMOOTH_FACTOR = 100;
const MIN_POSITIVE_WEIGHT = 1e-6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function weightedRandomRow(weights, rng) {
  const totalWeight = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0);
  if (totalWeight <= 0) return weights.length - 1;
  let randomNum = rng() * totalWeight;
  for (let row = 0; row < weights.length; row++) {
    randomNum -= Math.max(0, weights[row]);
    if (randomNum < 0) return row;
  }
  return weights.length - 1;
}

const StageHelper = {
  createRowPickSmoothingState(rowCount) {
    return {
      lastPicked: Array(rowCount).fill(0),
      secondLastPicked: Array(rowCount).fill(0),
    };
  },

  calculateSmoothRowWeights(weights, smoothingState) {
    const totalWeight = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0);
    if (totalWeight <= 0) return weights.map(() => 0);
    return weights.map((weight, row) => {
      const normalizedWeight = Math.max(0, weight);
      const weightP = normalizedWeight / totalWeight;
      if (weightP < MIN_POSITIVE_WEIGHT) return 0;
      const lastPicked = smoothingState.lastPicked[row] ?? 0;
      const secondLastPicked = smoothingState.secondLastPicked[row] ?? 0;
      const pLast = (SMOOTH_ROW_COUNT * lastPicked * weightP + SMOOTH_ROW_COUNT * weightP - 3) / 4;
      const pSecondLast = (secondLastPicked * weightP + weightP - 1) / 4;
      const smoothFactor = clamp(pLast + pSecondLast, MIN_SMOOTH_FACTOR, MAX_SMOOTH_FACTOR);
      return weightP * smoothFactor;
    });
  },

  insertRowPickEvent(smoothingState, weights, selectedRow) {
    const lastPicked = [...smoothingState.lastPicked];
    const secondLastPicked = [...smoothingState.secondLastPicked];
    for (let row = 0; row < weights.length; row++) {
      if (weights[row] > 0) {
        lastPicked[row] = (lastPicked[row] ?? 0) + 1;
        secondLastPicked[row] = (secondLastPicked[row] ?? 0) + 1;
      }
    }
    if (weights[selectedRow] > 0) {
      secondLastPicked[selectedRow] = lastPicked[selectedRow];
      lastPicked[selectedRow] = 0;
    }
    return { lastPicked, secondLastPicked };
  },

  selectSmoothSpawnRow(ctx) {
    const selectableWeights = ctx.weights.map((weight, row) => {
      if (weight <= 0) return 0;
      if (ctx.canSpawnOnRow && !ctx.canSpawnOnRow(row)) return 0;
      return weight;
    });
    const smoothWeights = StageHelper.calculateSmoothRowWeights(selectableWeights, ctx.smoothingState);
    const row = weightedRandomRow(smoothWeights, ctx.rng);
    return {
      row,
      smoothingState: StageHelper.insertRowPickEvent(ctx.smoothingState, selectableWeights, row),
    };
  },

  generateBossWaveScript(_levelSum, _random, allowedMids, callCount = 0) {
    const mids = allowedMids.length > 0 ? allowedMids : [1];
    const count = 3 + (callCount % 3);
    return Array.from({ length: count }, (_, index) => ({
      mid: mids[index % mids.length],
      count: 1,
    }));
  },
};

export default StageHelper;
