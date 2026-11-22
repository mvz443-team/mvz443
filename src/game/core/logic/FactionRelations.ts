/**
 * 阵营与敌对关系的唯一判定入口。
 *
 * 约束（见 AGENTS.md 第 9 节 desync 自查）：
 * - 本文件是零依赖纯函数，不引用 Phaser / Rapier / Manager，可在 Node 下直接测试。
 * - 所有"谁打谁"的判定必须走 `isHostile()`，禁止散落 `=== Faction.PLANT/ZOMBIE` 裸分支。
 * - 阵营读取统一走 `effectiveFaction()`：Entity 访问器与 Model 字段等价，
 *   `charmedBy` 是未来诱惑预留的临时覆盖字段（写入前必须先进 Model 快照）。
 */

import { Faction } from "../../models/Enum";

/** 合法阵营值；用于过滤快照里可能残留的脏数据。 */
export function isFaction(value: unknown): value is Faction {
  return value === Faction.PLANT
    || value === Faction.ZOMBIE
    || value === Faction.NEUTRAL
    || value === Faction.PLAYER1
    || value === Faction.PLAYER2;
}

/**
 * 读取有效阵营。
 *
 * 优先顺序：`charmedBy`（未来诱惑的临时归属）> `faction`（稳定归属）。
 * 传入实体或 Model 均可；Entity 侧的同名访问器会转发到 Model。
 * 任一级拿不到合法阵营时返回 null，调用方必须按"非敌对"处理。
 */
export function effectiveFaction(source: unknown): Faction | null {
  if (source === null || source === undefined) return null;
  if (typeof source === "number") return isFaction(source) ? source : null;
  if (typeof source !== "object") return null;

  const holder = source as { faction?: unknown; charmedBy?: unknown; model?: unknown };
  const model = holder.model && typeof holder.model === "object"
    ? holder.model as { faction?: unknown; charmedBy?: unknown }
    : null;

  const charm = holder.charmedBy ?? model?.charmedBy;
  if (isFaction(charm)) return charm;

  const faction = holder.faction ?? model?.faction;
  return isFaction(faction) ? faction : null;
}

/**
 * 唯一敌对判定入口：双方有效阵营不同即为敌对。
 *
 * 该口径覆盖三种现状：
 * - PvE：PLANT(植物/友方召唤物) 与 ZOMBIE(出怪/墓碑) 互为敌人；
 * - PvP 预留：PLAYER1 与 PLAYER2 互为敌人，且都与 NEUTRAL(公共出怪) 互为敌人；
 * - NEUTRAL 之间不互殴（同阵营）。
 *
 * 任何一方阵营无效时返回 false，避免快照重建期缺字段造成误伤。
 */
export function isHostile(a: unknown, b: unknown): boolean {
  const left = effectiveFaction(a);
  const right = effectiveFaction(b);
  if (left === null || right === null) return false;
  return left !== right;
}
