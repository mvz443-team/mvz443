import manager from "./manager-generic.mjs";

function isCarrier(plant) {
  return plant?.pid === 6 || plant?.pid === 100;
}

function isShield(plant) {
  return Boolean(plant?.model?.shieldHealth > 0 || plant?.shieldHealth > 0);
}

function isMagicPowder(plant) {
  return plant?.pid === 10;
}

const PlantHelper = {
  IsMorePriorityPlant(prevPlant, newPlant) {
    if (!prevPlant || !newPlant) return false;
    if (prevPlant.pid === newPlant.pid) return false;
    if (isCarrier(prevPlant) && !isCarrier(newPlant)) return true;
    if (isShield(newPlant) && !isShield(prevPlant)) return true;
    if (isMagicPowder(newPlant)) return true;
    return false;
  },
  GetPlantsInGrid(col, row) {
    const map = manager.Instance?.PlantsMap;
    return map?.get(`${col}-${row}`) ?? [];
  },
  isCarrier,
  isShield,
  isMagicPowder,
};

export default PlantHelper;
