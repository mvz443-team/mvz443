import fs from "node:fs";
import { MonsterLibrary } from "../../src/game/managers/library/MonsterLibrary.ts";
import { resetSim, spawnMob } from "../harness/sim.mjs";

MonsterLibrary.Initialize();

const SMALL = 10;
const BREAK = 99_999;
const LABELS = { body: "体", mount: "坐骑", head: "头", offHand: "盾", mainHand: "主手" };

function layerState(model) {
  const equipment = model.equipment;
  return {
    body: model.health,
    mount: model.mountHealthMax > 0 ? model.mountHealth : null,
    head: equipment?.head ? equipment.head.health : null,
    offHand: equipment?.offHand ? equipment.offHand.health : null,
    mainHand: equipment?.mainHand ? equipment.mainHand.health : null,
  };
}

function changedLayers(before, after) {
  const changed = [];
  for (const key of ["body", "mount", "head", "offHand", "mainHand"]) {
    if (before[key] !== null && after[key] !== null && before[key] !== after[key]) changed.push(key);
  }
  return changed;
}

function formatPath(changed, kind, amount, before, after) {
  const set = new Set(changed);
  if (set.size === 0) return "无";

  const bodyDead = after?.body === 0;
  const headBroke = before?.head > 0 && after?.head === 0;
  let mountCleanup = false;
  // 非爆炸伤害若把本体打死，坐骑变化来自“整体死亡清理”，不是本次伤害吸收。
  if (bodyDead && set.has("mount") && kind !== "explosion") {
    set.delete("mount");
    mountCleanup = true;
  }

  let path;
  if (set.size === 1) {
    path = LABELS[[...set][0]];
  } else if (set.has("mount") && set.has("body") && !set.has("head") && !set.has("offHand")) {
    path = kind === "explosion" ? "坐骑+体" : "坐骑→体";
  } else if (set.has("offHand") && set.has("body") && !set.has("head") && !set.has("mount")) {
    path = kind === "bullet" && amount === BREAK ? "盾→体" : "盾+体";
  } else if (set.has("head") && set.has("body")) {
    const arrow = headBroke ? "→" : "+";
    if (set.has("mount")) path = `坐骑+头${arrow}体`;
    else if (set.has("offHand")) path = `盾+头${arrow}体`;
    else path = `头${arrow}体`;
  } else {
    const order = ["mount", "offHand", "head", "body", "mainHand"];
    path = order.filter((key) => set.has(key)).map((key) => LABELS[key]).join("+");
  }

  if (bodyDead && path.includes("体")) path = path.replace("体", "体(致死)");
  if (mountCleanup) path += "+坐骑清理";
  return path;
}

function source(kind) {
  if (kind === "melee") return { model: { hitKind: "melee" } };
  const [base, direction] = kind.split("-");
  return {
    model: { hitKind: base },
    rigidBody: { linvel: () => ({ x: direction === "reverse" ? -100 : 100 }) },
  };
}

function describe(model) {
  const equipment = model.definition?.equipment ?? {};
  const mountMax = equipment.mount?.maxHealth
    ?? (model.mountHealthConfig || model.definition?.vehicleHealth || 0);
  const parts = [`体${model.maxHealth}`];
  if (mountMax > 0) parts.push(`坐骑${mountMax}(${model.mountDamagePriority})`);
  if (equipment.head) parts.push(`头${equipment.head.maxHealth}`);
  if (equipment.offHand) parts.push(`盾${equipment.offHand.maxHealth}`);
  if (equipment.mainHand) parts.push(`主手${equipment.mainHand.maxHealth}`);
  const isMedium = typeof model.takeMediumDamage === "function";
  return {
    mid: model.mid,
    name: model.nameKey,
    className: model.constructor.name,
    category: isMedium ? "中型" : "非中型召唤物",
    layers: parts.join(" / "),
    mountPriority: model.mountDamagePriority,
    headDef: equipment.head ?? null,
    offHandDef: equipment.offHand ?? null,
    mainHandDef: equipment.mainHand ?? null,
  };
}

const cases = ["bullet-forward", "bullet-reverse", "laser", "explosion", "melee"];
const models = [...MonsterLibrary.Models.values()].sort((a, b) => a.mid - b.mid);
const rows = [];

for (const model of models) {
  const meta = describe(model);
  const cells = {};
  for (const kind of cases) {
    const small = runCase(model, kind, SMALL);
    const breaking = runCase(model, kind, BREAK);
    cells[kind] = { small, breaking };
  }
  rows.push({ ...meta, cells });
}

function runCase(data, kind, amount) {
  resetSim();
  try {
    const { model, entity } = spawnMob(data, { col: 8, row: 2 });
    const before = layerState(model);
    entity.takeDamage(amount, undefined, source(kind));
    const after = layerState(model);
    const changed = changedLayers(before, after);
    return {
      path: formatPath(changed, kind.split("-")[0], amount, before, after),
      changed,
      before,
      after,
    };
  } catch (error) {
    return { path: `ERR:${error.message}`, changed: [], before: null, after: null };
  }
}

function cell(caseResult) {
  const small = caseResult.small.path;
  const breaking = caseResult.breaking.path;
  return small === breaking ? small : `小:${small} / 大:${breaking}`;
}

const headers = ["MID", "怪物", "类别", "层配置", "bullet 正向", "bullet 反向", "laser", "explosion", "melee"];
const table = [
  `| ${headers.join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => {
    const values = [
      row.mid,
      row.name,
      row.category,
      row.layers,
      cell(row.cells["bullet-forward"]),
      cell(row.cells["bullet-reverse"]),
      cell(row.cells.laser),
      cell(row.cells.explosion),
      cell(row.cells.melee),
    ];
    return `| ${values.join(" | ")} |`;
  }),
].join("\n");

const report = `# Monster Damage Paths\n\n` +
  `- 小伤害: ${SMALL}\n- 破层伤害: ${BREAK}\n` +
  `- 路径按实际掉血层记录；\`+\` 表示同一来源同时命中，\`→\` 表示前层破碎后溢出。\n` +
  `- 主手不参与受击吸收，只记录在层配置中。\n` +
  `- \`BalloonTntClone\` 是星之碎片召唤物，继承 \`PresetMonsterModel\` / \`MonsterEntity\`，不属于中型怪物。\n\n${table}\n`;

fs.mkdirSync("screenshots", { recursive: true });
fs.writeFileSync("screenshots/monster-damage-paths.json", JSON.stringify(rows, null, 2));
fs.writeFileSync("test/monster-damage-paths.md", report);
console.log(report);
console.log(`\nSaved test/monster-damage-paths.md and screenshots/monster-damage-paths.json`);
