import { DamageConstants } from "../../../constants/game";
import type { GoodsItem } from "../../../types/goods";

const AllItems: GoodsItem[] = [
  { id: 1, count: 0, nameKey: "gold", iconKey: "gold" },
  { id: 2, count: 0, nameKey: "leather", iconKey: "leather" },
  { id: 3, count: 0, nameKey: "iron", iconKey: "iron" },
  { id: 4, count: 0, nameKey: "obsidian_medal", iconKey: "obsidian_medal" },
  { id: 5, count: 0, nameKey: "echo_shard", iconKey: "echo_shard" },
  { id: 6, count: 0, nameKey: "dragon_ball", iconKey: "dragon_ball" },
  { id: 7, count: 0, nameKey: "mechanical_gear", iconKey: "mechanical_gear" },
  { id: 8, count: 0, nameKey: "tengu_fluff", iconKey: "tengu_fluff" },
  { id: 9, count: 0, nameKey: "optical_lens", iconKey: "optical_lens" },
  { id: 10, count: 0, nameKey: "nixxor_lens", iconKey: "nixxor_lens" },
  { id: 11, count: 0, nameKey: "miracle_omikuji", iconKey: "miracle_omikuji" },
  { id: 4001, count: 0, nameKey: "alchemist_report", iconKey: "paper" },
  { id: DamageConstants.SECKILL, count: 0, nameKey: "scb", iconKey: "scb" },
];

export class ItemsLibrary {
  private static items: Map<number, GoodsItem> = new Map();

  public static Initialize() {
    if (this.items.size > 0) return;

    for (const item of AllItems) {
      this.Register(item);
    }

    console.log(`[ItemsLibrary] Initialized ${this.items.size} items.`);
  }

  private static Register(item: GoodsItem) {
    if (this.items.has(item.id)) {
      console.warn(`[ItemsLibrary] item id ${item.id} is already registered!`);
      return;
    }
    this.items.set(item.id, item);
  }

  public static GetItem(id: number): GoodsItem | undefined {
    this.Initialize();
    return this.items.get(id);
  }

  public static GetAllItems(): GoodsItem[] {
    this.Initialize();
    return Array.from(this.items.values());
  }
}
