import { DamageConstants } from "../../constants/game";

export const SHOP_ITEM_ICON_DIR = "/assets/card/items";

const itemIconMap = new Map<number, string>([
  [1, `${SHOP_ITEM_ICON_DIR}/gold.svg`],
  [2, `${SHOP_ITEM_ICON_DIR}/leather.svg`],
  [3, `${SHOP_ITEM_ICON_DIR}/iron.svg`],
  [4, `${SHOP_ITEM_ICON_DIR}/obsidian_medal.svg`],
  [5, `${SHOP_ITEM_ICON_DIR}/echo_shard.svg`],
  [6, `${SHOP_ITEM_ICON_DIR}/dragon_ball.svg`],
  [7, `${SHOP_ITEM_ICON_DIR}/mechanical_gear.svg`],
  [8, `${SHOP_ITEM_ICON_DIR}/tengu_fluff.svg`],
  [9, `${SHOP_ITEM_ICON_DIR}/optical_lens.svg`],
  [10, `${SHOP_ITEM_ICON_DIR}/nixxor_lens.svg`],
  [11, `${SHOP_ITEM_ICON_DIR}/miracle_omikuji.svg`],
  [4001, `${SHOP_ITEM_ICON_DIR}/paper.svg`],
  [DamageConstants.SECKILL, `${SHOP_ITEM_ICON_DIR}/scb.svg`],
]);

export function getItemIcon(type: number) {
  return itemIconMap.get(type) ?? `${SHOP_ITEM_ICON_DIR}/unknown.svg`;
}
