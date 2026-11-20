/**
 * 卡槽冷却的纯计算规则。
 *
 * 冷却剩余时间只取决于「权威种植帧」和当前逻辑帧：
 *   leftMs = max(0, cooldownEndFrame - currentFrame) * frameIntervalMs
 *   cooldownEndFrame = 种植权威帧 + ceil(totalMs / frameIntervalMs)
 *
 * 这样卡片冷却不需要在每一帧递减、也不需要进入回滚快照；回滚后只要用权威
 * 种植帧重建 cooldownEndFrame 即可得到与连续运行完全一致的冷却进度。
 */

/** 总冷却时长换算成整数逻辑帧数。 */
export function cooldownDurationFrames(totalMs: number, frameIntervalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return 0;
  return Math.ceil(totalMs / frameIntervalMs);
}

/** 给定权威种植帧，算出冷却结束帧。 */
export function computeCooldownEndFrame(
  plantFrame: number,
  totalMs: number,
  frameIntervalMs: number,
): number {
  const frame = Number.isFinite(plantFrame) ? Math.max(0, Math.trunc(plantFrame)) : 0;
  return frame + cooldownDurationFrames(totalMs, frameIntervalMs);
}

/** 给定冷却结束帧和当前逻辑帧，算出剩余毫秒数（不会为负）。 */
export function cooldownLeftMsAt(
  cooldownEndFrame: number,
  currentFrame: number,
  frameIntervalMs: number,
): number {
  const end = Number.isFinite(cooldownEndFrame) ? Math.trunc(cooldownEndFrame) : 0;
  const current = Number.isFinite(currentFrame) ? Math.trunc(currentFrame) : 0;
  const interval = Number.isFinite(frameIntervalMs) ? Math.max(0, frameIntervalMs) : 0;
  return Math.max(0, end - current) * interval;
}

/** 由服务端 profile 的 leftMs 与 profile 帧号反推冷却结束帧。 */
export function cooldownEndFrameFromProfile(
  profileFrame: number,
  leftMs: number,
  frameIntervalMs: number,
): number {
  const frame = Number.isFinite(profileFrame) ? Math.max(0, Math.trunc(profileFrame)) : 0;
  const remaining = Number.isFinite(leftMs) ? Math.max(0, leftMs) : 0;
  return frame + cooldownDurationFrames(remaining, frameIntervalMs);
}
