/**
 * 体态标签（tiny / flying / void）：目标与投射物共用的唯一判定层。
 *
 * 语义：
 * - 目标（怪物 / 植物 / 障碍）：表示"占据哪一层"。
 *   - `tiny`：低矮贴地层，例如睡莲、小发射器、TNT 地雷。
 *   - `flying`：空中层，例如飞行中的气球僵尸、撑杆跳中的手杖僵尸。
 *   - `inVoid`：虚空层，只有虚空投射物能触及。
 * - 投射物 / 射线 / 召唤物：表示"能到达哪一层"。
 *   - 三个布尔值全是"能否触及该层"，未声明表示只能触及普通地面目标。
 *
 * 命中规则只有一条：目标占据的每一层，投射物都必须能到达。
 * 也就是说"能打空中"的投射物同时也能打地面，但"能打低矮"的投射物
 * 不代表它能打普通目标以外的层。
 *
 * 该项目把三个状态放在 `LogicModel` 上，因此：
 * - 判定入口统一为 `canReachBody()` / `readBodyLayers()`；
 * - 状态是普通布尔字段，自动进入快照与哈希；
 * - 植物只需要 `tiny`，不需要额外派生类。
 */

export type BodyLayers = {
  /** 低矮贴地层。 */
  tiny: boolean;
  /** 空中层。 */
  flying: boolean;
  /** 虚空层。 */
  inVoid: boolean;
};

/** 只占据普通地面层（默认目标体态）。 */
export const GROUND_LAYERS: Readonly<BodyLayers> = Object.freeze({
  tiny: false,
  flying: false,
  inVoid: false,
});

/** 能到达全部体态层（爆炸、超杀激光这类"全层"伤害）。 */
export const ALL_BODY_LAYERS: Readonly<BodyLayers> = Object.freeze({
  tiny: true,
  flying: true,
  inVoid: true,
});

/** 用可选字段补全成完整体态；省略的层视为 false。 */
export function bodyLayers(partial: Partial<BodyLayers> | null | undefined): BodyLayers {
  return {
    tiny: partial?.tiny === true,
    flying: partial?.flying === true,
    inVoid: partial?.inVoid === true,
  };
}

/**
 * 命中判定唯一入口：目标占据的每一层，攻击方都必须能到达。
 *
 * 例：目标 flying=true，攻击方 flying=false → 打不到。
 * 例：目标 tiny=false，攻击方 tiny=true → 仍然能打中（多余的触及能力不影响）。
 */
export function canReachBody(reach: BodyLayers, body: BodyLayers): boolean {
  if (body.tiny && !reach.tiny) return false;
  if (body.flying && !reach.flying) return false;
  if (body.inVoid && !reach.inVoid) return false;
  return true;
}

/**
 * 从实体或 Model 读取体态。
 *
 * 实体上的状态全部存在 Model，因此优先读 `target.model`；
 * 没有 Model 的测试替身/纯数据对象会直接读自身字段。
 */
export function readBodyLayers(target: unknown): BodyLayers {
  if (!target || typeof target !== "object") return { ...GROUND_LAYERS };
  const holder = target as { model?: unknown };
  const source = (holder.model && typeof holder.model === "object" ? holder.model : holder) as Partial<BodyLayers>;
  return {
    tiny: source.tiny === true,
    flying: source.flying === true,
    inVoid: source.inVoid === true,
  };
}

/** 人类可读的体态描述，用于日志、文档与断言失败信息。 */
export function describeBodyLayers(layers: BodyLayers): string {
  const names: string[] = [];
  if (layers.tiny) names.push("tiny");
  if (layers.flying) names.push("flying");
  if (layers.inVoid) names.push("void");
  return names.length > 0 ? names.join("+") : "ground";
}
