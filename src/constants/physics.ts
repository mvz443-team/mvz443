import { BATTLE_GRID_CELL_WIDTH } from "./gameLayout";

export const RAPIER_DEFAULT_TIMESTEP_SECONDS = 1 / 60;
export const LEGACY_BALANCE_FRAME_INTERVAL_MS = 50;

export function getRapierTimestepSeconds(frameIntervalMs = LEGACY_BALANCE_FRAME_INTERVAL_MS): number {
  return frameIntervalMs / 1000;
}

export function getOneGridPerSecondVelocity(): number {
  return getOneGridVelocityForSeconds(1);
}

export function getOneGridVelocityForSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("seconds must be a positive finite number");
  }

  const durationMs = Math.round(seconds * 1000);
  if (durationMs <= 0) {
    throw new Error("seconds is too small to convert to a deterministic millisecond duration");
  }

  return Math.round((BATTLE_GRID_CELL_WIDTH * 1000) / durationMs);
}

// Existing gameplay speeds were tuned while Rapier stepped at its default
// 1/60s timestep inside a 50ms logic frame. Convert those values once so
// Rapier velocities use real units/second after world.timestep is explicit.
export function legacyRapierVelocityToUnitsPerSecond(legacyVelocity: number): number {
  return legacyVelocity * RAPIER_DEFAULT_TIMESTEP_SECONDS * (1000 / LEGACY_BALANCE_FRAME_INTERVAL_MS);
}
