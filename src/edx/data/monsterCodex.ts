import { MonsterLibrary } from "../../game/managers/library/MonsterLibrary";
import type { MonsterModel } from "../../game/models/MonsterModel";
import { Faction } from "../../game/models/Enum";
import { BATTLE_GRID_CELL_WIDTH } from "../../constants/gameLayout";

export type EdxLocale = "zh_CN" | "en_US";

export type MonsterCodexGroup =
  | "zombie"
  | "armored"
  | "ranged"
  | "special"
  | "water"
  | "flying"
  | "summon"
  | "elite"
  | "boss";

export interface LocalizedText {
  zh_CN: string;
  en_US: string;
}

export interface MonsterCodexEntry {
  mid: number;
  nameKey: string;
  group: MonsterCodexGroup;
  name: LocalizedText;
  description: LocalizedText;
}

export const MONSTER_GROUP_LABELS: Record<MonsterCodexGroup, LocalizedText> = {
  zombie: { zh_CN: "普通僵尸", en_US: "Zombie" },
  armored: { zh_CN: "装甲僵尸", en_US: "Armored" },
  ranged: { zh_CN: "远程", en_US: "Ranged" },
  special: { zh_CN: "特殊", en_US: "Special" },
  water: { zh_CN: "水生", en_US: "Water" },
  flying: { zh_CN: "飞行", en_US: "Flying" },
  summon: { zh_CN: "召唤物", en_US: "Summoned" },
  elite: { zh_CN: "精英", en_US: "Elite" },
  boss: { zh_CN: "BOSS", en_US: "Boss" },
};

/**
 * 僵尸图鉴条目。
 *
 * 名称/描述写在图鉴自己的数据里：`MonsterModel` 只有 `nameKey`（程序标识，
 * 不是可翻译文案），战斗里也从不展示怪物名字，所以这里补齐展示用的文案。
 * 数值（血量/速度/伤害/间隔/等级）不写死，统一从 Model 读，避免与实际平衡脱节。
 */
const ENTRIES: MonsterCodexEntry[] = [
  {
    mid: 1,
    nameKey: "Zombie",
    group: "zombie",
    name: { zh_CN: "僵尸", en_US: "Zombie" },
    description: {
      zh_CN: "最基础的怪物。血量 300，每 0.2 秒造成 20 点伤害，走得慢但数量永远不缺。",
      en_US: "The baseline monster: 300 HP, 20 damage every 0.2s. Slow, but never in short supply.",
    },
  },
  {
    mid: 2,
    nameKey: "CapZombie",
    group: "armored",
    name: { zh_CN: "皮革帽僵尸", en_US: "Leather Cap Zombie" },
    description: {
      zh_CN: "戴着 370 血皮革帽。帽子先替本体挨打，破碎后剩余伤害才会进入本体。",
      en_US: "Wears a 370 HP leather cap that soaks damage first; only the overflow reaches the body.",
    },
  },
  {
    mid: 3,
    nameKey: "HelmetZombie",
    group: "armored",
    name: { zh_CN: "钢盔僵尸", en_US: "Steel Helmet Zombie" },
    description: {
      zh_CN: "额外 1100 血钢盔，按 1:1 吸收伤害；钢盔破碎后溢出伤害才结算到本体。",
      en_US: "An extra 1100 HP steel helmet absorbs damage 1:1 and passes the overflow through when it breaks.",
    },
  },
  {
    mid: 4,
    nameKey: "MinerZombie",
    group: "zombie",
    name: { zh_CN: "矿工僵尸", en_US: "Miner Zombie" },
    description: {
      zh_CN: "手持镐子的近战单位，单次 60 点伤害，攻击时镐子会挥动。",
      en_US: "A pickaxe-wielding melee unit: 60 damage per swing.",
    },
  },
  {
    mid: 5,
    nameKey: "MinerHelmetZombie",
    group: "armored",
    name: { zh_CN: "钢盔矿工僵尸", en_US: "Helmet Miner Zombie" },
    description: {
      zh_CN: "钢盔与镐子的组合：1100 血护甲加上 60 点单次伤害。",
      en_US: "Steel helmet plus pickaxe: 1100 HP of armour and 60 damage per swing.",
    },
  },
  {
    mid: 6,
    nameKey: "Skeleton",
    group: "zombie",
    name: { zh_CN: "骷髅", en_US: "Skeleton" },
    description: {
      zh_CN: "比僵尸更脆弱的近战单位，250 血、20 点伤害，躯体随血量进入破损阶段。",
      en_US: "A frailer melee unit: 250 HP, 20 damage, with staged body damage.",
    },
  },
  {
    mid: 7,
    nameKey: "SkeletonBow",
    group: "ranged",
    name: { zh_CN: "骷髅弓箭手", en_US: "Skeleton Archer" },
    description: {
      zh_CN: "每 3.5 秒检查一次前方视线，有目标就射出 70 伤害的箭，之后收招 0.35 秒。",
      en_US: "Checks the lane every 3.5s and fires a 70 damage arrow, then recovers for 0.35s.",
    },
  },
  {
    mid: 8,
    nameKey: "StickZombie",
    group: "special",
    name: { zh_CN: "手杖僵尸", en_US: "Cane Zombie" },
    description: {
      zh_CN: "起跳型怪物：前方 0.7 格出现植物时用手杖飞过 1.4 格，可以直接跳过第一道防线。",
      en_US: "Vaults 1.4 cells with its cane whenever a plant appears 0.7 cells ahead, skipping the front line.",
    },
  },
  {
    mid: 9,
    nameKey: "Evoker",
    group: "summon",
    name: { zh_CN: "唤魔者", en_US: "Evoker" },
    description: {
      zh_CN: "周期性在自身前后左右各召唤 1 名卫道士，召唤完成后原地停顿 3 秒。",
      en_US: "Summons a vindicator on each of its four sides, then stands still for 3s.",
    },
  },
  {
    mid: 10,
    nameKey: "Vindicator",
    group: "zombie",
    name: { zh_CN: "卫道士", en_US: "Vindicator" },
    description: {
      zh_CN: "持斧近战单位，360 血、32 点伤害，攻击间隔 0.2 秒。",
      en_US: "Axe melee unit: 360 HP, 32 damage every 0.2s.",
    },
  },
  {
    mid: 11,
    nameKey: "VindicatorSolider",
    group: "armored",
    name: { zh_CN: "盾卫", en_US: "Shield Vindicator" },
    description: {
      zh_CN: "1000 血铁盾减伤 50%，只格挡迎面飞来的子弹；破盾那一次伤害按完整值结算。",
      en_US: "A 1000 HP shield halves damage and blocks incoming bullets only; the breaking hit lands in full.",
    },
  },
  {
    mid: 12,
    nameKey: "ObsidianGolem",
    group: "boss",
    name: { zh_CN: "黑曜石傀儡", en_US: "Obsidian Golem" },
    description: {
      zh_CN: "BOSS。先召唤小怪，再交替使用岩柱与守卫：岩柱落地生成 300 血黑曜石障碍，守卫技能为自己与上下行架起 500 血护墙。",
      en_US: "Boss. Summons minions, then alternates pillars (300 HP obsidian obstacles) and guards (500 HP walls on three lanes).",
    },
  },
  {
    mid: 13,
    nameKey: "Warden",
    group: "boss",
    name: { zh_CN: "监守者", en_US: "Warden" },
    description: {
      zh_CN: "BOSS。技能 1 是 13 格长、1000 伤害的激光；技能 2 高跳落地，对 1 格范围造成 180 伤害并召唤矿工。每轮结束钻地换列。",
      en_US: "Boss. Skill 1 is a 13-cell, 1000 damage laser; skill 2 leap-slams for 180 and summons miners. Burrows to a new column each round.",
    },
  },
  {
    mid: 14,
    nameKey: "TurtleZombie",
    group: "armored",
    name: { zh_CN: "龟壳僵尸", en_US: "Turtle Shell Zombie" },
    description: {
      zh_CN: "370 血龟壳减伤 50%；龟壳破碎后移动速度翻倍，且只加速一次。",
      en_US: "A 370 HP shell halves damage; when it breaks the zombie doubles its speed once.",
    },
  },
  {
    mid: 15,
    nameKey: "Mutant",
    group: "elite",
    name: { zh_CN: "变异体", en_US: "Mutant" },
    description: {
      zh_CN: "蓄力 1.5 秒后对目标格造成 5500 点范围伤害；同格的所有植物会一起进入攻击队列。",
      en_US: "Charges for 1.5s, then deals 5500 area damage to the target cell, hitting every plant in it.",
    },
  },
  {
    mid: 16,
    nameKey: "TurtleSkeletonBow",
    group: "ranged",
    name: { zh_CN: "龟壳弓手", en_US: "Turtle Shell Archer" },
    description: {
      zh_CN: "每 2 秒射出 50 伤害的箭；375 血龟壳破碎后提速，并连射 5 发 90 伤害的箭。",
      en_US: "Fires a 50 damage arrow every 2s; once its 375 HP shell breaks it speeds up and bursts 5 arrows of 90.",
    },
  },
  {
    mid: 17,
    nameKey: "Centipede",
    group: "boss",
    name: { zh_CN: "蜈蚣", en_US: "Centipede" },
    description: {
      zh_CN: "BOSS。6 秒技能循环：冲撞 5 格（主路径秒杀、邻行 100 伤害）、随机 3 行召唤幼虫、随机 2 列 3x3 爆破 500 伤害；血量 80/60/40/20% 时额外落石。",
      en_US: "Boss. 6s loop: 5-cell charge (instant kill on path, 100 on neighbours), summon larvae on 3 lanes, 3x3 blasts of 500 on 2 columns; rockfalls at 80/60/40/20% HP.",
    },
  },
  {
    mid: 18,
    nameKey: "CentipedeMinion",
    group: "summon",
    name: { zh_CN: "蜈蚣幼虫", en_US: "Centipede Larva" },
    description: {
      zh_CN: "不进行普通近战：接触到的植物会被直接秒杀。",
      en_US: "Skips normal melee: any plant it reaches is instantly killed.",
    },
  },
  {
    mid: 19,
    nameKey: "BalloonZombie",
    group: "flying",
    name: { zh_CN: "气球僵尸", en_US: "Balloon Zombie" },
    description: {
      zh_CN: "飞行单位，3 个气球组成的载具只有 1 点血：子弹打爆气球即迫降，本体不掉血；激光与爆炸会同时伤到本体。",
      en_US: "Flying unit whose balloon vehicle has 1 HP: bullets pop it and force a landing without hurting the body, while lasers and explosions hit both.",
    },
  },
  {
    mid: 20,
    nameKey: "BalloonCapZombie",
    group: "flying",
    name: { zh_CN: "气球皮革帽僵尸", en_US: "Balloon Cap Zombie" },
    description: {
      zh_CN: "气球载具加 370 血皮革帽：子弹被载具吃掉，激光/爆炸会同时结算载具与本体。",
      en_US: "Balloon vehicle plus a 370 HP leather cap: bullets are eaten by the vehicle, lasers and explosions hit both layers.",
    },
  },
  {
    mid: 21,
    nameKey: "BalloonTntClone",
    group: "summon",
    name: { zh_CN: "气球TNT分身", en_US: "Balloon TNT Clone" },
    description: {
      zh_CN: "星之碎片召唤物（己方阵营）：持续向右飞行，碰到第一个怪物或飞到最右列时爆炸。",
      en_US: "A star-shard summon on the player side: flies right and explodes on the first monster or at the last column.",
    },
  },
  {
    mid: 22,
    nameKey: "BoatZombie",
    group: "water",
    name: { zh_CN: "木船僵尸", en_US: "Boat Zombie" },
    description: {
      zh_CN: "只在水面行出现，数值与普通僵尸一致，额外挂一条木船；船没了就会在水里持续溺亡。",
      en_US: "Water lanes only. Same stats as a normal zombie plus a boat; without it the rider drowns.",
    },
  },
  {
    mid: 23,
    nameKey: "BoatCapZombie",
    group: "water",
    name: { zh_CN: "木船皮革帽僵尸", en_US: "Boat Cap Zombie" },
    description: {
      zh_CN: "木船加皮革帽的水生版本，只能刷在水面行。",
      en_US: "Water variant with a boat and a leather cap. Water lanes only.",
    },
  },
  {
    mid: 24,
    nameKey: "BoatHelmetZombie",
    group: "water",
    name: { zh_CN: "木船钢盔僵尸", en_US: "Boat Helmet Zombie" },
    description: {
      zh_CN: "木船加 1100 血钢盔的水生版本，只能刷在水面行。",
      en_US: "Water variant with a boat and a 1100 HP steel helmet. Water lanes only.",
    },
  },
  {
    mid: 25,
    nameKey: "BoatTurtleZombie",
    group: "water",
    name: { zh_CN: "木船龟壳僵尸", en_US: "Boat Turtle Zombie" },
    description: {
      zh_CN: "木船加龟壳的水生版本，只能刷在水面行。",
      en_US: "Water variant with a boat and a turtle shell. Water lanes only.",
    },
  },
  {
    mid: 26,
    nameKey: "BoatSkeletonBowZombie",
    group: "water",
    name: { zh_CN: "木船骷髅弓手", en_US: "Boat Skeleton Archer" },
    description: {
      zh_CN: "木船加弓箭的水生版本，隔着水面也能射箭。",
      en_US: "Water variant with a boat and a bow: it shoots across the water.",
    },
  },
  {
    mid: 27,
    nameKey: "DivingZombie",
    group: "water",
    name: { zh_CN: "潜水僵尸", en_US: "Diving Zombie" },
    description: {
      zh_CN: "非攻击时半潜在水下（tiny），普通子弹打不到，只有带 tiny 触及能力的弹药能命中；开始攻击后会抬起身子。",
      en_US: "Submerged (tiny) while idle, so ordinary bullets miss; only shots with tiny reach can hit. Surfaces while attacking.",
    },
  },
  {
    mid: 28,
    nameKey: "DolphinRiderZombie",
    group: "water",
    name: { zh_CN: "海豚骑士僵尸", en_US: "Dolphin Rider Zombie" },
    description: {
      zh_CN: "坐骑海豚有 250 血并优先承伤，子弹/激光由海豚吸收；海豚破碎后骑手以普通速度前进并溺水。",
      en_US: "A 250 HP dolphin mount soaks bullets and lasers first; once it breaks the rider continues at normal speed and drowns.",
    },
  },
];

const ENTRY_BY_MID = new Map<number, MonsterCodexEntry>(ENTRIES.map((entry) => [entry.mid, entry]));

export function getMonsterCodexEntries(): MonsterCodexEntry[] {
  return [...ENTRIES];
}

export function getMonsterCodexEntry(mid: number): MonsterCodexEntry | undefined {
  return ENTRY_BY_MID.get(mid);
}

export function pickLocalized(text: LocalizedText | undefined, locale: string): string {
  if (!text) return "";
  return locale === "en_US" ? text.en_US : text.zh_CN;
}

export function normalizeLocale(locale: string | undefined): EdxLocale {
  return locale === "en_US" ? "en_US" : "zh_CN";
}

/** 图鉴面板展示的数值快照，全部来自 preset Model，避免与平衡表脱节。 */
export interface MonsterStatRow {
  labelKey: "health" | "speed" | "damage" | "interval" | "level" | "rank" | "wave";
  value: string;
}

export function readMonsterStatRows(mid: number, locale: EdxLocale): MonsterStatRow[] {
  const model = MonsterLibrary.GetModel(mid);
  if (!model) return [];
  const rows: MonsterStatRow[] = [
    { labelKey: "health", value: String(model.maxHealth) },
    { labelKey: "speed", value: formatSpeed(model, locale) },
    { labelKey: "damage", value: String(model.getAttackDamage()) },
    { labelKey: "interval", value: `${(model.attackInterval / 1000).toFixed(2)}s` },
    { labelKey: "level", value: `Lv.${model.level}` },
    { labelKey: "rank", value: model.rank },
  ];
  const leastWave = model.leastWaveID;
  if (typeof leastWave === "number" && leastWave > 0) {
    rows.push({ labelKey: "wave", value: String(leastWave) });
  }
  return rows;
}

/**
 * 速度展示：Model 里的 speed 是“像素/秒”口径的速度值（16 = 5 秒走一格），
 * 图鉴换算成更直观的“每格耗时”。
 */
function formatSpeed(model: MonsterModel, locale: EdxLocale): string {
  const perCellSeconds = model.baseSpeed > 0
    ? BATTLE_GRID_CELL_WIDTH / model.baseSpeed
    : 0;
  if (perCellSeconds <= 0) {
    return locale === "en_US" ? "stationary" : "原地不动";
  }
  return locale === "en_US"
    ? `${perCellSeconds.toFixed(1)}s / cell`
    : `${perCellSeconds.toFixed(1)} 秒 / 格`;
}

/** 体态/机制标签，供图鉴一行摘要展示。 */
export function readMonsterTraits(mid: number, locale: EdxLocale): string[] {
  const model = MonsterLibrary.GetModel(mid);
  if (!model) return [];
  const traits: string[] = [];
  const push = (zh: string, en: string) => traits.push(locale === "en_US" ? en : zh);
  if (model.faction === Faction.PLANT) push("己方召唤物", "Player-side summon");
  if (model.isDefaultFlying) push("飞行", "Flying");
  if (model.isDefaultInVoid) push("虚空", "Void");
  if (model.boatMounted) push("水面载具", "Water mount");
  if (model.habitats?.length && !model.habitats.includes("ground")) push("仅水面", "Water only");
  if (model.damageThresholds.length > 0) push("分阶段破损", "Staged body");
  if (!model.couldCarryStarShards) push("不掉星之碎片", "No star shard drop");
  return traits;
}
