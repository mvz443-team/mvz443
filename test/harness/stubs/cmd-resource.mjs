const calls = [];

const ResourceCmd = {
  calls,
  AddEnergyToAll(amount) { calls.push({ kind: "energy", amount }); },
  AddStarshardToAll(amount) { calls.push({ kind: "starshard", amount }); },
  reset() { calls.length = 0; },
};

export default ResourceCmd;
