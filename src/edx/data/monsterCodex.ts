import { MonsterLibrary } from "../../game/managers/library/MonsterLibrary";
import type { MonsterModel } from "../../game/models/MonsterModel";
import { MediumMonsterModel } from "../../game/models/monster/MediumMonsterModel";
import type { DamageKind, EquipmentDef } from "../../game/models/equipment/Equipment";
import { BATTLE_GRID_CELL_WIDTH } from "../../constants/gameLayout";

export type EdxLocale = "zh_CN" | "en_US";

/**
 * 僵尸图鉴只保留五类：中型僵尸 / 突变僵尸 / 傀儡 / BOSS / 特殊。
 * 分类与 preset 的继承关系一一对应，不再按“普通、装甲、远程”这类词面切分。
 */
export type MonsterCodexGroup = "medium" | "mutant" | "golem" | "boss" | "special";

export interface LocalizedText {
  zh_CN: string;
  en_US: string;
}

/** 一条技能：只展示名字与描述。 */
export interface MonsterSkill {
  name: LocalizedText;
  description: LocalizedText;
}

export interface MonsterCodexEntry {
  mid: number;
  nameKey: string;
  group: MonsterCodexGroup;
  name: LocalizedText;
  description: LocalizedText;
  skills?: MonsterSkill[];
}

export const MONSTER_GROUP_LABELS: Record<MonsterCodexGroup, LocalizedText> = {
  medium: { zh_CN: "中型僵尸", en_US: "Medium Zombie" },
  mutant: { zh_CN: "突变僵尸", en_US: "Mutant" },
  golem: { zh_CN: "傀儡", en_US: "Golem" },
  boss: { zh_CN: "BOSS", en_US: "Boss" },
  special: { zh_CN: "特殊", en_US: "Special" },
};

const OBSIDIAN_GOLEM_SKILLS: MonsterSkill[] = [
  {
    name: { zh_CN: "黑曜石阵列", en_US: "Obsidian Barrage" },
    description: {
      zh_CN: "在自身所在列逐行砸下黑曜石柱，落地后生成 300 血障碍，并秒杀该格植物。",
      en_US: "Drops obsidian pillars down its own column; each lands as a 300 HP obstacle and instantly kills the plant in that cell.",
    },
  },
  {
    name: { zh_CN: "黑曜石卫队", en_US: "Obsidian Guard" },
    description: {
      zh_CN: "在自身与上下相邻两行各架起 500 血黑曜石墙，并为每行召唤一名盾卫。",
      en_US: "Raises 500 HP obsidian walls on its row and both neighbouring rows, summoning a shield vindicator on each.",
    },
  },
];

const WARDEN_SKILLS: MonsterSkill[] = [
  {
    name: { zh_CN: "声波脉冲", en_US: "Sonic Burst" },
    description: {
      zh_CN: "朝植物方向发射 13 格长激光，命中造成 1000 伤害。",
      en_US: "Fires a 13-cell laser towards the plants for 1000 damage.",
    },
  },
  {
    name: { zh_CN: "遁地伏击", en_US: "Burrow Ambush" },
    description: {
      zh_CN: "高跳落地，对落点 1 格范围造成 180 伤害，并召唤矿工与钢盔矿工。",
      en_US: "Leaps and slams down for 180 damage in a 1-cell area, summoning a miner and a helmet miner.",
    },
  },
];

const CENTIPEDE_SKILLS: MonsterSkill[] = [
  {
    name: { zh_CN: "盾构机", en_US: "Shield Boring Machine" },
    description: {
      zh_CN: "向前冲撞 5 格：主路径上的植物直接秒杀，相邻两行受到 100 伤害。",
      en_US: "Charges 5 cells forward: plants on its lane are killed outright, adjacent lanes take 100.",
    },
  },
  {
    name: { zh_CN: "蜈蚣召唤", en_US: "Centipede Summon" },
    description: {
      zh_CN: "随机挑 3 行各召唤一只幼虫，幼虫碰到植物即秒杀。",
      en_US: "Summons a larva on 3 random lanes; a larva instantly kills any plant it reaches.",
    },
  },
  {
    name: { zh_CN: "矿山爆破", en_US: "Mine Blasting" },
    description: {
      zh_CN: "随机 2 列落下爆破弹，落点 3×3 范围造成 500 伤害。",
      en_US: "Drops bombs on 2 random columns for 500 damage in a 3×3 area.",
    },
  },
  {
    name: { zh_CN: "矿山废石", en_US: "Mine Waste Rock" },
    description: {
      zh_CN: "生命降到 80% / 60% / 40% / 20% 时落下废石，砸中格秒杀并留下 300 血矿石障碍。",
      en_US: "At 80/60/40/20% HP it drops waste rock that kills the hit plant and leaves a 300 HP obstacle.",
    },
  },
];

const MUTANT_SKILLS: MonsterSkill[] = [
  {
    name: { zh_CN: "蓄力重击", en_US: "Charged Smash" },
    description: {
      zh_CN: "锁定目标后蓄力 1.5 秒，命中时对目标格内所有植物造成 5500 伤害，随后收招 1.5 秒。",
      en_US: "Winds up for 1.5s, then deals 5500 damage to every plant in the target cell, followed by a 1.5s recovery.",
    },
  },
];

const BALLOON_TNT_CLONE_SKILLS: MonsterSkill[] = [
  {
    name: { zh_CN: "自爆", en_US: "Self Destruct" },
    description: {
      zh_CN: "碰到第一个僵尸或飞到最右列时自爆，对 3×3 范围造成与本体相同的爆炸伤害。",
      en_US: "Explodes on the first zombie it touches or at the last column, dealing its explosion damage in a 3×3 area.",
    },
  },
];

/**
 * 僵尸图鉴条目。
 *
 * 名称/描述写在图鉴自己的数据里：`MonsterModel` 只有 `nameKey`（程序标识，
 * 不是可翻译文案），战斗里也从不展示怪物名字，所以这里补齐展示用的文案。
 * 数值不写死，统一从 Model / 装备定义读，避免与平衡脱节。
 */
const ENTRIES: MonsterCodexEntry[] = [
  {
    mid: 1,
    nameKey: "Zombie",
    group: "medium",
    name: { zh_CN: "僵尸", en_US: "Zombie" },
    description: {
      zh_CN: "最基础的怪物。血量 300，每 0.2 秒造成 20 点伤害，走得慢但数量永远不缺。",
      en_US: "The baseline monster: 300 HP, 20 damage every 0.2s. Slow, but never in short supply.",
    },
  },
  {
    mid: 2,
    nameKey: "CapZombie",
    group: "medium",
    name: { zh_CN: "皮革帽僵尸", en_US: "Leather Cap Zombie" },
    description: {
      zh_CN: "戴着 370 血皮革帽。帽子先替本体挨打，破碎后剩余伤害才会进入本体。",
      en_US: "Wears a 370 HP leather cap that soaks damage first; only the overflow reaches the body.",
    },
  },
  {
    mid: 3,
    nameKey: "HelmetZombie",
    group: "medium",
    name: { zh_CN: "钢盔僵尸", en_US: "Steel Helmet Zombie" },
    description: {
      zh_CN: "额外 1100 血钢盔，按 1:1 吸收伤害；钢盔破碎后溢出伤害才结算到本体。",
      en_US: "An extra 1100 HP steel helmet absorbs damage 1:1 and passes the overflow through when it breaks.",
    },
  },
  {
    mid: 4,
    nameKey: "MinerZombie",
    group: "medium",
    name: { zh_CN: "矿工僵尸", en_US: "Miner Zombie" },
    description: {
      zh_CN: "手持镐子的近战单位，单次 60 点伤害，攻击时镐子会挥动。",
      en_US: "A pickaxe-wielding melee unit: 60 damage per swing.",
    },
  },
  {
    mid: 5,
    nameKey: "MinerHelmetZombie",
    group: "medium",
    name: { zh_CN: "钢盔矿工僵尸", en_US: "Helmet Miner Zombie" },
    description: {
      zh_CN: "钢盔与镐子的组合：1100 血护甲加上 60 点单次伤害。",
      en_US: "Steel helmet plus pickaxe: 1100 HP of armour and 60 damage per swing.",
    },
  },
  {
    mid: 6,
    nameKey: "Skeleton",
    group: "medium",
    name: { zh_CN: "骷髅", en_US: "Skeleton" },
    description: {
      zh_CN: "比僵尸更脆弱的近战单位，250 血、20 点伤害，躯体随血量进入破损阶段。",
      en_US: "A frailer melee unit: 250 HP, 20 damage, with staged body damage.",
    },
  },
  {
    mid: 7,
    nameKey: "SkeletonBow",
    group: "medium",
    name: { zh_CN: "骷髅弓箭手", en_US: "Skeleton Archer" },
    description: {
      zh_CN: "每 3.5 秒检查一次前方视线，有目标就射出 70 伤害的箭，之后收招 0.35 秒。",
      en_US: "Checks the lane every 3.5s and fires a 70 damage arrow, then recovers for 0.35s.",
    },
  },
  {
    mid: 8,
    nameKey: "StickZombie",
    group: "medium",
    name: { zh_CN: "手杖僵尸", en_US: "Cane Zombie" },
    description: {
      zh_CN: "起跳型怪物：前方 0.7 格出现植物时用手杖飞过 1.4 格，可以直接跳过第一道防线。",
      en_US: "Vaults 1.4 cells with its cane whenever a plant appears 0.7 cells ahead, skipping the front line.",
    },
  },
  {
    mid: 9,
    nameKey: "Evoker",
    group: "medium",
    name: { zh_CN: "唤魔者", en_US: "Evoker" },
    description: {
      zh_CN: "周期性在自身前后左右各召唤 1 名卫道士，召唤完成后原地停顿 3 秒。",
      en_US: "Summons a vindicator on each of its four sides, then stands still for 3s.",
    },
  },
  {
    mid: 10,
    nameKey: "Vindicator",
    group: "medium",
    name: { zh_CN: "卫道士", en_US: "Vindicator" },
    description: {
      zh_CN: "持斧近战单位，360 血、32 点伤害，攻击间隔 0.2 秒。",
      en_US: "Axe melee unit: 360 HP, 32 damage every 0.2s.",
    },
  },
  {
    mid: 11,
    nameKey: "VindicatorSolider",
    group: "medium",
    name: { zh_CN: "盾卫", en_US: "Shield Vindicator" },
    description: {
      zh_CN: "1000 血铁盾减伤 50%，只格挡迎面飞来的子弹；破盾那一次伤害按完整值结算。",
      en_US: "A 1000 HP shield halves damage and blocks incoming bullets only; the breaking hit lands in full.",
    },
  },
  {
    mid: 12,
    nameKey: "ObsidianGolem",
    group: "golem",
    name: { zh_CN: "黑曜石傀儡", en_US: "Obsidian Golem" },
    description: {
      zh_CN: "先召唤小怪，再交替使用岩柱与守卫；每轮技能结束后跳起换到随机一行。",
      en_US: "Summons minions first, then alternates pillar barrages and guards, hopping to a random row after each cycle.",
    },
    skills: OBSIDIAN_GOLEM_SKILLS,
  },
  {
    mid: 13,
    nameKey: "Warden",
    group: "golem",
    name: { zh_CN: "监守者", en_US: "Warden" },
    description: {
      zh_CN: "两个技能交替释放，每轮结束钻地换到随机一行，并重新开始蓄力。",
      en_US: "Alternates two skills, then burrows to a random row and starts charging again.",
    },
    skills: WARDEN_SKILLS,
  },
  {
    mid: 14,
    nameKey: "TurtleZombie",
    group: "medium",
    name: { zh_CN: "龟壳僵尸", en_US: "Turtle Shell Zombie" },
    description: {
      zh_CN: "370 血龟壳减伤 50%；龟壳破碎后移动速度翻倍，且只加速一次。",
      en_US: "A 370 HP shell halves damage; when it breaks the zombie doubles its speed once.",
    },
  },
  {
    mid: 15,
    nameKey: "Mutant",
    group: "mutant",
    name: { zh_CN: "变异体", en_US: "Mutant" },
    description: {
      zh_CN: "蓄力 1.5 秒后对目标格造成 5500 点范围伤害；同格的所有植物会一起进入攻击队列。",
      en_US: "Charges for 1.5s, then deals 5500 area damage to the target cell, hitting every plant in it.",
    },
    skills: MUTANT_SKILLS,
  },
  {
    mid: 16,
    nameKey: "TurtleSkeletonBow",
    group: "medium",
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
      zh_CN: "6 秒一个技能循环，三个技能不连续重复，每轮结束后弧形钻地换到随机一行。",
      en_US: "A 6s skill loop that never repeats the same skill twice in a row, then arcs to a random row.",
    },
    skills: CENTIPEDE_SKILLS,
  },
  {
    mid: 19,
    nameKey: "BalloonZombie",
    group: "medium",
    name: { zh_CN: "气球僵尸", en_US: "Balloon Zombie" },
    description: {
      zh_CN: "飞行单位，3 个气球组成的载具只有 1 点血：子弹打爆气球即迫降，本体不掉血；激光与爆炸会同时伤到本体。",
      en_US: "Flying unit whose balloon vehicle has 1 HP: bullets pop it and force a landing without hurting the body, while lasers and explosions hit both.",
    },
  },
  {
    mid: 20,
    nameKey: "BalloonCapZombie",
    group: "medium",
    name: { zh_CN: "气球皮革帽僵尸", en_US: "Balloon Cap Zombie" },
    description: {
      zh_CN: "气球载具加 370 血皮革帽：子弹被载具吃掉，激光/爆炸会同时结算载具与本体。",
      en_US: "Balloon vehicle plus a 370 HP leather cap: bullets are eaten by the vehicle, lasers and explosions hit both layers.",
    },
  },
  {
    mid: 21,
    nameKey: "BalloonTntClone",
    group: "special",
    name: { zh_CN: "气球TNT分身", en_US: "Balloon TNT Clone" },
    description: {
      zh_CN: "星之碎片召唤物（己方阵营）：持续向右飞行，碰到第一个怪物或飞到最右列时爆炸。",
      en_US: "A star-shard summon on the player side: flies right and explodes on the first monster or at the last column.",
    },
    skills: BALLOON_TNT_CLONE_SKILLS,
  },
  {
    mid: 22,
    nameKey: "BoatZombie",
    group: "medium",
    name: { zh_CN: "木船僵尸", en_US: "Boat Zombie" },
    description: {
      zh_CN: "只在水面行出现，数值与普通僵尸一致，额外挂一条木船；船没了就会在水里持续溺亡。",
      en_US: "Water lanes only. Same stats as a normal zombie plus a boat; without it the rider drowns.",
    },
  },
  {
    mid: 23,
    nameKey: "BoatCapZombie",
    group: "medium",
    name: { zh_CN: "木船皮革帽僵尸", en_US: "Boat Cap Zombie" },
    description: {
      zh_CN: "木船加皮革帽的水生版本，只能刷在水面行。",
      en_US: "Water variant with a boat and a leather cap. Water lanes only.",
    },
  },
  {
    mid: 24,
    nameKey: "BoatHelmetZombie",
    group: "medium",
    name: { zh_CN: "木船钢盔僵尸", en_US: "Boat Helmet Zombie" },
    description: {
      zh_CN: "木船加 1100 血钢盔的水生版本，只能刷在水面行。",
      en_US: "Water variant with a boat and a 1100 HP steel helmet. Water lanes only.",
    },
  },
  {
    mid: 25,
    nameKey: "BoatTurtleZombie",
    group: "medium",
    name: { zh_CN: "木船龟壳僵尸", en_US: "Boat Turtle Zombie" },
    description: {
      zh_CN: "木船加龟壳的水生版本，只能刷在水面行。",
      en_US: "Water variant with a boat and a turtle shell. Water lanes only.",
    },
  },
  {
    mid: 26,
    nameKey: "BoatSkeletonBowZombie",
    group: "medium",
    name: { zh_CN: "木船骷髅弓手", en_US: "Boat Skeleton Archer" },
    description: {
      zh_CN: "木船加弓箭的水生版本，隔着水面也能射箭。",
      en_US: "Water variant with a boat and a bow: it shoots across the water.",
    },
  },
  {
    mid: 27,
    nameKey: "DivingZombie",
    group: "medium",
    name: { zh_CN: "潜水僵尸", en_US: "Diving Zombie" },
    description: {
      zh_CN: "非攻击时半潜在水下（tiny），普通子弹打不到，只有带 tiny 触及能力的弹药能命中；开始攻击后会抬起身子。",
      en_US: "Submerged (tiny) while idle, so ordinary bullets miss; only shots with tiny reach can hit. Surfaces while attacking.",
    },
  },
  {
    mid: 28,
    nameKey: "DolphinRiderZombie",
    group: "medium",
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

// --- 详情数值 ---------------------------------------------------------------

/** 详情面板里的一行数值；`labelKey` 对应 i18n 的 `edx.stat_${labelKey}`。 */
export type MonsterStatLabelKey =
  | "health"
  | "speed"
  | "base_damage"
  | "interval"
  | "absorb"
  | "attack_bonus"
  | "durability"
  | "block_kinds"
  | "mount_rule";

export interface MonsterStatRow {
  labelKey: MonsterStatLabelKey;
  value: string;
}

/** 详情分区：本体 + 三个手持/头部装备槽 + 坐骑；`key` 对应 `edx.section_${key}`。 */
export type MonsterDetailSectionKey = "body" | "head" | "main_hand" | "off_hand" | "mount";

export interface MonsterDetailSection {
  key: MonsterDetailSectionKey;
  rows: MonsterStatRow[];
}

/** 装备格预览用的槽位定义；null 表示该槽位没有装备。 */
export interface MonsterEquipmentSlots {
  head: EquipmentDef | null;
  mainHand: EquipmentDef | null;
  offHand: EquipmentDef | null;
  mount: EquipmentDef | null;
}

const EMPTY_SLOTS: MonsterEquipmentSlots = {
  head: null,
  mainHand: null,
  offHand: null,
  mount: null,
};

const DAMAGE_KIND_LABELS: Record<DamageKind, LocalizedText> = {
  melee: { zh_CN: "近战", en_US: "melee" },
  bullet: { zh_CN: "子弹", en_US: "bullets" },
  laser: { zh_CN: "激光", en_US: "lasers" },
  explosion: { zh_CN: "爆炸", en_US: "explosions" },
};

const ALL_DAMAGE_KINDS: DamageKind[] = ["melee", "bullet", "laser", "explosion"];

const NONE_LABEL: LocalizedText = { zh_CN: "无", en_US: "none" };

/**
 * 读取装备槽定义。
 * 只有中型僵尸（`MediumMonsterModel`）才有头部/主手/副手/坐骑四槽；
 * 坐骑沿用 `mountDef`，以兼容木船/气球这类旧 `mountHealth / vehicleHealth` 配置。
 */
export function readMonsterEquipmentSlots(mid: number): MonsterEquipmentSlots {
  const model = MonsterLibrary.GetModel(mid);
  if (!model || !(model instanceof MediumMonsterModel)) return EMPTY_SLOTS;
  const defs = model.equipmentDefs;
  return {
    head: defs.head ?? null,
    mainHand: defs.mainHand ?? null,
    offHand: defs.offHand ?? null,
    mount: model.mountDef,
  };
}

/**
 * 按分类读取详情数值：
 * - 中型僵尸：本体（生命/速度/基础伤害/攻击间隔）+ 每个已装备槽位各自的数值；
 * - 突变僵尸：本体四项；
 * - 傀儡 / BOSS：只显示生命；
 * - 特殊：生命与速度。
 */
export function readMonsterDetailSections(
  mid: number,
  group: MonsterCodexGroup,
  locale: EdxLocale,
): MonsterDetailSection[] {
  const model = MonsterLibrary.GetModel(mid);
  if (!model) return [];

  if (group === "medium") {
    const sections: MonsterDetailSection[] = [
      { key: "body", rows: readBodyRows(model, locale) },
    ];
    const slots = readMonsterEquipmentSlots(mid);
    if (slots.head) {
      sections.push({
        key: "head",
        rows: [
          { labelKey: "health", value: String(slots.head.maxHealth) },
          { labelKey: "absorb", value: `${Math.round((slots.head.absorbRatio ?? 1) * 100)}%` },
        ],
      });
    }
    if (slots.mainHand) {
      const weaponDamage = slots.mainHand.weaponDamage ?? 0;
      const rows: MonsterStatRow[] = [];
      // 弓/手杖这类不提供近战加成的武器，不显示“攻击加成 +0”。
      if (weaponDamage > 0) {
        rows.push({ labelKey: "attack_bonus", value: `+${weaponDamage}` });
      }
      rows.push({ labelKey: "durability", value: String(slots.mainHand.maxHealth) });
      sections.push({ key: "main_hand", rows });
    }
    if (slots.offHand) {
      const kinds = slots.offHand.blockHitKinds ?? [];
      sections.push({
        key: "off_hand",
        rows: [
          {
            labelKey: "block_kinds",
            value: kinds.length > 0
              ? kinds.map((kind) => pickLocalized(DAMAGE_KIND_LABELS[kind], locale)).join(" / ")
              : pickLocalized(NONE_LABEL, locale),
          },
          { labelKey: "durability", value: String(slots.offHand.maxHealth) },
        ],
      });
    }
    if (slots.mount) {
      sections.push({
        key: "mount",
        rows: [
          { labelKey: "health", value: String(slots.mount.maxHealth) },
          { labelKey: "speed", value: formatSpeed(model, locale) },
          { labelKey: "mount_rule", value: describeMountRule(slots.mount, locale) },
        ],
      });
    }
    return sections;
  }

  if (group === "mutant") {
    return [{ key: "body", rows: readBodyRows(model, locale) }];
  }

  if (group === "special") {
    return [{
      key: "body",
      rows: [
        { labelKey: "health", value: String(model.maxHealth) },
        { labelKey: "speed", value: formatSpeed(model, locale) },
      ],
    }];
  }

  // 傀儡 / BOSS：只显示生命。
  return [{
    key: "body",
    rows: [{ labelKey: "health", value: String(model.maxHealth) }],
  }];
}

function readBodyRows(model: MonsterModel, locale: EdxLocale): MonsterStatRow[] {
  // 弓手没有有意义的近战数值，展示真实的箭伤害与射击间隔。
  const archer = model as { arrowDamage?: number; arrowInterval?: number };
  const isArcher = typeof archer.arrowDamage === "number" && typeof archer.arrowInterval === "number";
  const damage = isArcher ? archer.arrowDamage! : model.baseAttackDamage;
  const interval = isArcher ? archer.arrowInterval! : model.attackInterval;
  return [
    { labelKey: "health", value: String(model.maxHealth) },
    { labelKey: "speed", value: formatSpeed(model, locale) },
    { labelKey: "base_damage", value: String(damage) },
    { labelKey: "interval", value: `${(interval / 1000).toFixed(2)}s` },
  ];
}

/**
 * 坐骑伤害规则：按 `MediumMonsterModel.takeMediumDamage` 的三条分支翻译成一句话。
 * - absorbHitKinds 且非 rider 优先 → 全部由坐骑承担；
 * - mountPierceHitKinds（默认 explosion）→ 同时伤害坐骑与骑手；
 * - 其余命中类型 → 直击骑手。
 */
function describeMountRule(def: EquipmentDef, locale: EdxLocale): string {
  const zh = locale !== "en_US";
  const term = def.mountKind === "balloon"
    ? (zh ? "载具" : "vehicle")
    : (zh ? "坐骑" : "mount");

  const pierce = def.mountPierceHitKinds ?? ["explosion"];
  const absorb = (def.priority ?? "mount") === "rider"
    ? []
    : (def.absorbHitKinds ?? []).filter((kind) => !pierce.includes(kind));
  const riderOnly = ALL_DAMAGE_KINDS.filter(
    (kind) => !absorb.includes(kind) && !pierce.includes(kind),
  );

  const labels = (kinds: DamageKind[]) =>
    kinds.map((kind) => pickLocalized(DAMAGE_KIND_LABELS[kind], locale)).join(" / ");

  const parts: string[] = [];
  if (absorb.length > 0) {
    parts.push(zh
      ? `${labels(absorb)} 由${term}承担`
      : `${labels(absorb)} hit the ${term} first`);
  }
  if (riderOnly.length > 0) {
    parts.push(zh
      ? `${labels(riderOnly)} 直击骑手`
      : `${labels(riderOnly)} go straight to the rider`);
  }
  if (pierce.length > 0) {
    parts.push(zh
      ? `${labels(pierce)} 同时伤害${term}与骑手`
      : `${labels(pierce)} damage both the ${term} and the rider`);
  }
  return parts.join(zh ? "；" : "; ");
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
