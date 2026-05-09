import type seedrandom from "seedrandom";
import type { StageScript, Wave } from "../../../types/stage";
import { GroundOnlyZombie, SkyOnlyZombie, WaterOnlyZombie } from "./PlantHelper";

export type SpawnMonsterEntry = {
  mid: number;
};

export type RowPropertyRatioGetter = (row: number, type: "ground" | "water" | "void") => number;
export type MonsterCarryStarShardsGetter = (mid: number) => boolean;

export type MobSpawnPlan = {
  totalMonsters: SpawnMonsterEntry[];
  carryingMonsterIndexes: Set<number>;
  rowWeights: number[];
  activeRows: number[];
  interval: number;
};

export type SelectSpawnRowContext = {
  wave: Wave;
  stageScript: StageScript;
  rowWeights: number[];
  activeRows: number[];
  currentWaveId: number;
  minecartLostWaveByRow: ReadonlyMap<number, number>;
  mid: number;
  rowCount: number;
  rng: seedrandom.PRNG;
  rowPropertyRatio: RowPropertyRatioGetter;
};

export type SelectSpawnRowResult = {
  row: number;
  rowWeights: number[];
};

const ROW_WEIGHT_RECOVERY_RATE = 0.1;
const ROW_WEIGHT_HIT_PUNISH = 0.3;
const MIN_ROW_WEIGHT = 0.1;
const MINECART_PROTECTION_FADE_WAVES = 10;
const MINECART_MIN_PROTECTION_REDUCTION = 0.3;

namespace MobHelper {
  export function createSpawnPlan(ctx: {
    wave: Wave;
    stageScript: StageScript;
    rowCount: number;
    rng: seedrandom.PRNG;
    canCarryStarShards: MonsterCarryStarShardsGetter;
  }): MobSpawnPlan {
    const totalMonsters = shuffleArray(collectWaveMonsters(ctx.wave), ctx.rng);
    const carryingMonsterIndexes = selectStarShardCarriers({
      totalMonsters,
      starShards: ctx.wave.starShards,
      canCarryStarShards: ctx.canCarryStarShards,
      rng: ctx.rng,
    });
    const { rowWeights, activeRows } = createInitialRowWeights({
      wave: ctx.wave,
      stageScript: ctx.stageScript,
      rowCount: ctx.rowCount,
      rng: ctx.rng,
    });

    return {
      totalMonsters,
      carryingMonsterIndexes,
      rowWeights,
      activeRows,
      interval: calculateSpawnInterval(ctx.wave, totalMonsters.length),
    };
  }

  export function selectSpawnRow(ctx: SelectSpawnRowContext): SelectSpawnRowResult {
    const protectedRowWeights =
      shouldUseMinecartProtection(ctx.wave)
        ? applyMinecartLossProtection({
          rowWeights: ctx.rowWeights,
          currentWaveId: ctx.currentWaveId,
          minecartLostWaveByRow: ctx.minecartLostWaveByRow,
        })
        : ctx.rowWeights;

    const row = weightedRandomRow({
      weights: protectedRowWeights,
      mid: ctx.mid,
      rowCount: ctx.rowCount,
      rng: ctx.rng,
      rowPropertyRatio: ctx.rowPropertyRatio,
    });

    const rowWeights = updateRowWeightsAfterSpawn({
      rowWeights: ctx.rowWeights,
      wave: ctx.wave,
      activeRows: ctx.activeRows,
      selectedRow: row,
    });

    return { row, rowWeights };
  }

  export function collectWaveMonsters(wave: Wave): SpawnMonsterEntry[] {
    const totalMonsters: SpawnMonsterEntry[] = [];
    wave.monsters.forEach(monster => {
      for (let i = 0; i < monster.count; i++) {
        totalMonsters.push({ mid: monster.mid });
      }
    });
    return totalMonsters;
  }

  export function shuffleArray<T>(array: T[], rng: seedrandom.PRNG): T[] {
    const shuffledArray = [...array];

    for (let i = shuffledArray.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
    }

    return shuffledArray;
  }

  export function selectStarShardCarriers(ctx: {
    totalMonsters: SpawnMonsterEntry[];
    starShards: number;
    canCarryStarShards: MonsterCarryStarShardsGetter;
    rng: seedrandom.PRNG;
  }): Set<number> {
    const carryingMonsters = new Set<number>();
    const candidateIndexes = ctx.totalMonsters
      .map((monster, index) => ({ monster, index }))
      .filter(({ monster }) => ctx.canCarryStarShards(monster.mid))
      .map(({ index }) => index);
    const maxStars = Math.min(ctx.starShards, candidateIndexes.length);

    while (carryingMonsters.size < maxStars) {
      const randomIdx = Math.floor(ctx.rng() * candidateIndexes.length);
      carryingMonsters.add(candidateIndexes[randomIdx]);
    }

    return carryingMonsters;
  }

  export function createInitialRowWeights(ctx: {
    wave: Wave;
    stageScript: StageScript;
    rowCount: number;
    rng: seedrandom.PRNG;
  }): { rowWeights: number[]; activeRows: number[] } {
    void ctx.stageScript;

    let rowWeights: number[];
    let activeRows: number[] = [];
    const rowMax = ctx.rowCount - 1;

    if (ctx.wave.arrangement === 0x02) {
      const minLines = Math.min(ctx.wave.minLine, ctx.rowCount);
      const activeRowCount = minLines + Math.floor(ctx.rng() * (ctx.rowCount - minLines));
      activeRows = Array.from({ length: ctx.rowCount }, (_, i) => i);
      activeRows = shuffleArray(activeRows, ctx.rng).slice(0, activeRowCount);
      rowWeights = Array(rowMax + 1).fill(0);
      activeRows.forEach(row => rowWeights[row] = 1);
    } else {
      rowWeights = Array(rowMax + 1).fill(1);
    }

    return applyExceptLine({
      rowWeights,
      activeRows,
      exceptLine: ctx.wave.exceptLine,
      arrangement: ctx.wave.arrangement,
    });
  }

  export function applyMinecartLossProtection(ctx: {
    rowWeights: number[];
    currentWaveId: number;
    minecartLostWaveByRow: ReadonlyMap<number, number>;
  }): number[] {
    if (ctx.minecartLostWaveByRow.size === 0) {
      return ctx.rowWeights;
    }

    const protectedRows = new Set<number>();
    const adjustedWeights = [...ctx.rowWeights];
    let removedWeight = 0;

    ctx.minecartLostWaveByRow.forEach((lostWaveId, row) => {
      const baseWeight = adjustedWeights[row];
      if (baseWeight === undefined || baseWeight <= 0) {
        return;
      }

      const wavesSinceLost = Math.max(0, ctx.currentWaveId - lostWaveId);
      const fadeRatio = Math.min(wavesSinceLost / MINECART_PROTECTION_FADE_WAVES, 1);
      const reduction = 1 - (1 - MINECART_MIN_PROTECTION_REDUCTION) * fadeRatio;
      const nextWeight = baseWeight * (1 - reduction);

      protectedRows.add(row);
      adjustedWeights[row] = nextWeight;
      removedWeight += baseWeight - nextWeight;
    });

    if (removedWeight <= 0) {
      return adjustedWeights;
    }

    const redistributeRows = adjustedWeights
      .map((weight, row) => ({ row, weight }))
      .filter(({ row, weight }) => weight > 0 && !protectedRows.has(row));
    const fallbackRows = adjustedWeights
      .map((weight, row) => ({ row, weight }))
      .filter(({ weight }) => weight > 0);
    const targets = redistributeRows.length > 0 ? redistributeRows : fallbackRows;

    if (targets.length === 0) {
      return ctx.rowWeights;
    }

    const targetTotalWeight = targets.reduce((acc, { weight }) => acc + weight, 0);
    if (targetTotalWeight <= 0) {
      const bonus = removedWeight / targets.length;
      targets.forEach(({ row }) => {
        adjustedWeights[row] += bonus;
      });
      return adjustedWeights;
    }

    targets.forEach(({ row, weight }) => {
      adjustedWeights[row] += removedWeight * (weight / targetTotalWeight);
    });

    return adjustedWeights;
  }

  export function weightedRandomRow(ctx: {
    weights: number[];
    mid: number;
    rowCount: number;
    rng: seedrandom.PRNG;
    rowPropertyRatio: RowPropertyRatioGetter;
  }): number {
    const weightsCopy = [...ctx.weights];

    for (let i = 0; i < weightsCopy.length; i++) {
      if (!couldSpawnMonster(i, ctx.mid, ctx.rowPropertyRatio)) {
        weightsCopy[i] = 0;
      }
    }

    const totalWeight = weightsCopy.reduce((acc, w) => acc + w, 0);

    if (totalWeight === 0) {
      const validRows = ctx.weights
        .map((_, index) => index)
        .filter(row => couldSpawnMonster(row, ctx.mid, ctx.rowPropertyRatio));

      if (validRows.length === 0) {
        console.error('No valid rows to spawn monster!');
        return Math.floor(ctx.rng() * ctx.rowCount);
      }
      return validRows[Math.floor(ctx.rng() * validRows.length)];
    }

    let randomNum = ctx.rng() * totalWeight;
    for (let i = 0; i < weightsCopy.length; i++) {
      if (randomNum < weightsCopy[i]) {
        return i;
      }
      randomNum -= weightsCopy[i];
    }
    return weightsCopy.length - 1;
  }

  export function updateRowWeightsAfterSpawn(ctx: {
    rowWeights: number[];
    wave: Wave;
    activeRows: number[];
    selectedRow: number;
  }): number[] {
    const rowWeights = [...ctx.rowWeights];
    const activeRows = ctx.wave.arrangement === 0x02 ? ctx.activeRows : null;

    if (ctx.wave.arrangement === 0x02 && ctx.activeRows.includes(ctx.selectedRow)) {
      rowWeights[ctx.selectedRow] = Math.max(MIN_ROW_WEIGHT, rowWeights[ctx.selectedRow] - ROW_WEIGHT_HIT_PUNISH);
    } else if (ctx.wave.arrangement === 0x01) {
      rowWeights[ctx.selectedRow] = Math.max(MIN_ROW_WEIGHT, rowWeights[ctx.selectedRow] - ROW_WEIGHT_HIT_PUNISH);
    }

    const rebalanced = rebalanceRowWeights(rowWeights, activeRows);
    return applyExceptLine({
      rowWeights: rebalanced,
      activeRows: ctx.activeRows,
      exceptLine: ctx.wave.exceptLine,
      arrangement: ctx.wave.arrangement,
    }).rowWeights;
  }

  export function rebalanceRowWeights(weights: number[], activeRows: number[] | null): number[] {
    const nextWeights = [...weights];
    if (activeRows) {
      activeRows.forEach(row => {
        nextWeights[row] = Math.min(1, nextWeights[row] + ROW_WEIGHT_RECOVERY_RATE);
      });
    } else {
      for (let i = 0; i < nextWeights.length; i++) {
        nextWeights[i] = Math.min(1, nextWeights[i] + ROW_WEIGHT_RECOVERY_RATE);
      }
    }
    return nextWeights;
  }

  export function applyExceptLine(ctx: {
    rowWeights: number[];
    activeRows: number[];
    exceptLine?: number[];
    arrangement: Wave["arrangement"];
  }): { rowWeights: number[]; activeRows: number[] } {
    const exceptLine = ctx.exceptLine ?? [];
    const rowWeights = [...ctx.rowWeights];
    let activeRows = [...ctx.activeRows];

    if (exceptLine.length > 0) {
      if (ctx.arrangement === 0x02) {
        activeRows = activeRows.filter(row => !exceptLine.includes(row));
      }
      exceptLine.forEach(exceptRow => {
        if (exceptRow >= 0 && exceptRow < rowWeights.length) {
          rowWeights[exceptRow] = 0;
        }
      });
    }

    return { rowWeights, activeRows };
  }

  export function calculateSpawnInterval(wave: Wave, monsterCount: number): number {
    if (monsterCount <= 0) {
      return 0;
    }
    return wave.duration * 1000 / monsterCount;
  }

  function shouldUseMinecartProtection(wave: Wave): boolean {
    return wave.flag !== 'elite' && wave.flag !== 'boss';
  }

  function couldSpawnMonster(row: number, mid: number, rowPropertyRatio: RowPropertyRatioGetter): boolean {
    if (GroundOnlyZombie.includes(mid) && rowPropertyRatio(row, 'ground') > 0.6) return false;
    if (WaterOnlyZombie.includes(mid) && rowPropertyRatio(row, 'water') > 0.6) return false;
    if (SkyOnlyZombie.includes(mid) && rowPropertyRatio(row, 'void') > 0.6) return false;
    return true;
  }
}

export default MobHelper;
