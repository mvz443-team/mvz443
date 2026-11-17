const calls = [];

export const PlantCmd = {
  calls,
  Create(data, scene, col, row, level) {
    calls.push({ kind: "create", pid: data?.pid, scene, col, row, level });
  },
  SetSleeping(plant, value) {
    calls.push({ kind: "sleeping", plant, value });
    if (plant?.model) plant.model.isSleeping = value;
    else if (plant && "isSleeping" in plant) plant.isSleeping = value;
    plant?.model?.onSleepStateChange?.(plant, value);
  },
  SetHealth(plant, value) {
    calls.push({ kind: "health", plant, value });
    if (plant) plant.currentHealth = value;
  },
  DealDamage(plant, amount, dealer) {
    calls.push({ kind: "damage", plant, amount, dealer });
    plant?.takeDamage?.(amount, dealer);
  },
  reset() { calls.length = 0; },
};
