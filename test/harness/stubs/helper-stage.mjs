const StageHelper = {
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
