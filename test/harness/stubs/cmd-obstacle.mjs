const calls = [];

const ObstacleCmd = {
  calls,
  createInGrid(oid, scene, col, row, config) {
    calls.push({ oid, scene, col, row, config: { ...config } });
  },
  reset() { calls.length = 0; },
};

export default ObstacleCmd;
