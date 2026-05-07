import type { GameManager, GameProgress } from "../context/save_ctx";
import { commonKey, stuffKey } from "../i18n/keys";

export interface GoodsItem {
  id: number;
  count: number;
  nameKey?: string;
  iconKey?: string;
  descriptionKey?: string;
}

const GOODS_ITEM_ICON_DIR = "/assets/card/items";
const UNKNOWN_GOODS_ITEM_ICON_KEY = `${GOODS_ITEM_ICON_DIR}/unknown.svg`;

export function goodsItemResourceKey(item: GoodsItem): string | undefined {
  return item.descriptionKey ?? item.nameKey;
}

export function goodsItemName(
  item: GoodsItem,
  translate: (key: string, params?: Record<string, string>) => string,
): string {
  const resourceKey = item.nameKey;
  return translate(resourceKey ? stuffKey(resourceKey) : commonKey("unknown"));
}

export function goodsItemIconKey(item: GoodsItem): string {
  if (!item.iconKey) return UNKNOWN_GOODS_ITEM_ICON_KEY;
  if (item.iconKey.startsWith("/") || item.iconKey.includes(".")) {
    return item.iconKey;
  }
  return `${GOODS_ITEM_ICON_DIR}/${item.iconKey}.svg`;
}

export function unknownGoodsItemIconKey(): string {
  return UNKNOWN_GOODS_ITEM_ICON_KEY;
}

export interface GoodsPrice {
  items: GoodsItem[];
}

export interface GoodsSaveCtx {
  gameProgress: GameProgress;
  gameManager: GameManager;
  purchasedIds: Set<number>;
}

export abstract class Goods {
  public abstract readonly id: number;
  public abstract readonly nameKey: string;
  public abstract readonly iconKey: string;
  public abstract readonly descriptionKey: string;

  public abstract getPrice(saveCtx: GoodsSaveCtx): GoodsPrice;

  public hasBought(saveCtx: GoodsSaveCtx): boolean {
    return saveCtx.purchasedIds.has(this.id);
  }

  public canAfford(saveCtx: GoodsSaveCtx): boolean {
    return this.getPrice(saveCtx).items.every((priceItem) => {
      const item = saveCtx.gameProgress.items.get(priceItem.id);
      return (item?.count ?? 0) >= priceItem.count;
    });
  }

  public canPurchaseWithoutPrice(saveCtx: GoodsSaveCtx): boolean {
    if (!this.canRepeatPurchase(saveCtx) && this.hasBought(saveCtx)) {
      return false;
    }

    return this.isUnlocked(saveCtx);
  }

  public canPurchase(saveCtx: GoodsSaveCtx): boolean {
    return this.canPurchaseWithoutPrice(saveCtx) && this.canAfford(saveCtx);
  }

  public afterBought(saveCtx: GoodsSaveCtx): void {
    this.markPurchased(saveCtx);
    this.onBought(saveCtx);
  }

  protected canRepeatPurchase(_saveCtx: GoodsSaveCtx): boolean {
    return false;
  }

  protected abstract isUnlocked(saveCtx: GoodsSaveCtx): boolean;

  protected abstract onBought(saveCtx: GoodsSaveCtx): void;

  protected markPurchased(saveCtx: GoodsSaveCtx): void {
    saveCtx.purchasedIds.add(this.id);
  }

  protected hasPlant(saveCtx: GoodsSaveCtx, pid: number): boolean {
    return saveCtx.gameProgress.plants.some((plant) => plant.pid === pid);
  }

  protected hasAnyPlant(saveCtx: GoodsSaveCtx, pids: number[]): boolean {
    return pids.some((pid) => this.hasPlant(saveCtx, pid));
  }
}
