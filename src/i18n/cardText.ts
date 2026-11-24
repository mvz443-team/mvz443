import { cardKey } from './keys';

/**
 * 卡片文案分区。
 *
 * 旧版把「简介 / 技能 / 故事 / 升级说明 / 进阶」全部塞在一个 `*_description` 里，
 * 图鉴和背包需要按区块分别展示，因此统一拆成下面几段：
 * - brief：基础机制说明；
 * - starshards：星之碎片技能；
 * - story：背景故事；
 * - upgradeBrief：升级总述；
 * - advance：某个等级解锁的进阶效果（蓝色提示）。
 */
export type CardTextPart = 'brief' | 'starshards' | 'story' | 'upgrade_brief';

/** `name_dispenser` → `dispenser`；未知前缀原样返回。 */
export function cardBaseName(nameKey: string): string {
  return nameKey.startsWith('name_') ? nameKey.slice('name_'.length) : nameKey;
}

export const cardTextKey = {
  brief: (base: string) => cardKey(`${base}_brief`),
  starshards: (base: string) => cardKey(`${base}_starshards`),
  story: (base: string) => cardKey(`${base}_story`),
  upgradeBrief: (base: string) => cardKey(`${base}_upgrade_brief`),
  advance: (base: string, level: number) => cardKey(`${base}_advance-${level}`),
};
