import type seedrandom from "seedrandom";
import type { StageScript, Wave } from "../../../types/stage";
import { GroundOnlyZombie, SkyOnlyZombie, WaterOnlyZombie } from "./PlantHelper";
import StageHelper from "./StageHelper";

export type SpawnMonsterEntry = {
  mid: number;
};

export type RowPropertyRatioGetter = (row: number, type: "ground" | "water" | "void") => number;
export type MonsterCarryStarShardsGetter = (mid: number) => boolean;

export type MobSpawnPlan = {
  totalMonsters: SpawnMonsterEntry[];
  carryingMonsterIndexes: Set<number>;
  rowWeights: number[];
  rowPickSmoothingState: StageHelper.RowPickSmoothingState;
  interval: number;
};

export type SelectSpawnRowContext = {
  wave: Wave;
  stageScript: StageScript;
  rowWeights: number[];
  rowPickSmoothingState: StageHelper.RowPickSmoothingState;
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
  rowPickSmoothingState: StageHelper.RowPickSmoothingState;
};

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
    const rowWeights = createInitialRowWeights({
      wave: ctx.wave,
      stageScript: ctx.stageScript,
      rowCount: ctx.rowCount,
      rng: ctx.rng,
    });

    return {
      totalMonsters,
      carryingMonsterIndexes,
      rowWeights,
      rowPickSmoothingState: StageHelper.createRowPickSmoothingState(ctx.rowCount),
      interval: calculateSpawnInterval(ctx.wave, totalMonsters.length),
    };
  }

  export function selectSpawnRow(ctx: SelectSpawnRowContext): SelectSpawnRowResult {
    const selectableRowWeights =
      shouldUseMinecartProtection(ctx.wave)
        ? applyMinecartLossProtection({
          rowWeights: ctx.rowWeights,
          currentWaveId: ctx.currentWaveId,
          minecartLostWaveByRow: ctx.minecartLostWaveByRow,
        })
        : ctx.rowWeights;

    const rowResult = StageHelper.selectSmoothSpawnRow({
      weights: selectableRowWeights,
      rng: ctx.rng,
      smoothingState: ctx.rowPickSmoothingState,
      canSpawnOnRow: row => couldSpawnMonster(row, ctx.mid, ctx.rowPropertyRatio),
    });

    return {
      row: rowResult.row,
      rowWeights: ctx.rowWeights,
      rowPickSmoothingState: rowResult.smoothingState,
    };
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
  }): number[] {
    void ctx.stageScript;

    const rowMax = ctx.rowCount - 1;
    const rowWeights = Array(rowMax + 1).fill(1);

    return applyExceptLine({
      rowWeights,
      exceptLine: ctx.wave.exceptLine,
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

  export function applyExceptLine(ctx: {
    rowWeights: number[];
    exceptLine?: number[];
  }): number[] {
    const exceptLine = ctx.exceptLine ?? [];
    const rowWeights = [...ctx.rowWeights];

    if (exceptLine.length > 0) {
      exceptLine.forEach(exceptRow => {
        if (exceptRow >= 0 && exceptRow < rowWeights.length) {
          rowWeights[exceptRow] = 0;
        }
      });
    }

    if (rowWeights.every(weight => weight <= 0)) {
      const fallbackRows = rowWeights
        .map((_, row) => row)
        .filter(row => !exceptLine.includes(row));

      if (fallbackRows.length > 0) {
        fallbackRows.forEach(row => {
          rowWeights[row] = 1;
        });
      }
    }

    return rowWeights;
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
