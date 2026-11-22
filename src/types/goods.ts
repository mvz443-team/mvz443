import type { GameManager, GameProgress } from "../context/save_ctx";
import { ItemsLibrary } from "../game/managers/library/ItemsLibrary";
import { commonKey, stuffKey } from "../i18n/keys";
import { publicAssetUrl } from "../utils/browser";

export interface GoodsItem {
  id: number;
  count: number;
  nameKey?: string;
  iconKey?: string;
  descriptionKey?: string;
}

const GOODS_ITEM_ICON_DIR = "/assets/card/items";
const UNKNOWN_GOODS_ITEM_ICON_KEY = `${GOODS_ITEM_ICON_DIR}/unknown.svg`;

export function hydrateGoodsItem(item: GoodsItem): GoodsItem {
  const libraryItem = ItemsLibrary.GetItem(item.id);
  if (!libraryItem) return item;
  return {
    ...libraryItem,
    ...item,
    nameKey: item.nameKey ?? libraryItem.nameKey,
    iconKey: item.iconKey ?? libraryItem.iconKey,
    descriptionKey: item.descriptionKey ?? libraryItem.descriptionKey,
  };
}

export function goodsItemResourceKey(item: GoodsItem): string | undefined {
  const hydratedItem = hydrateGoodsItem(item);
  return hydratedItem.descriptionKey ?? hydratedItem.nameKey;
}

export function goodsItemName(
  item: GoodsItem,
  translate: (key: string, params?: Record<string, string>) => string,
): string {
  const resourceKey = hydrateGoodsItem(item).nameKey;
  return translate(resourceKey ? stuffKey(resourceKey) : commonKey("unknown"));
}

export function goodsItemIconKey(item: GoodsItem): string {
  const iconKey = hydrateGoodsItem(item).iconKey;
  if (!iconKey) return publicAssetUrl(UNKNOWN_GOODS_ITEM_ICON_KEY);
  const assetPath = iconKey.startsWith("/") || iconKey.includes("/")
    ? iconKey
    : `${GOODS_ITEM_ICON_DIR}/${iconKey}${iconKey.includes(".") ? "" : ".svg"}`;
  return publicAssetUrl(assetPath);
}

export function unknownGoodsItemIconKey(): string {
  return publicAssetUrl(UNKNOWN_GOODS_ITEM_ICON_KEY);
}

export interface GoodsPrice {
  items: GoodsItem[];
}

/** 商店分类：前三类为主分类，dev 作为独立的小分类。 */
export type ShopCategory = 'material' | 'card' | 'upgrade' | 'dev';

export interface GoodsConditionLevel {
  type: 'level';
  levelId: number;
  chapterId: number;
  met: boolean;
}

export interface GoodsConditionSlots {
  type: 'slots';
  required: number;
  current: number;
  met: boolean;
}

export interface GoodsConditionGold {
  type: 'gold';
  required: number;
  current: number;
  met: boolean;
}

export interface GoodsConditionMaterial {
  type: 'material';
  items: Array<{ item: GoodsItem; current: number; required: number }>;
  met: boolean;
}

/** 可展示的购买条件；UI 逐行显示未满足项。 */
export type GoodsCondition =
  | GoodsConditionLevel
  | GoodsConditionSlots
  | GoodsConditionGold
  | GoodsConditionMaterial;

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
  public abstract readonly category: ShopCategory;

  public abstract getPrice(saveCtx: GoodsSaveCtx): GoodsPrice;

  public hasBought(saveCtx: GoodsSaveCtx): boolean {
    return saveCtx.purchasedIds.has(this.id);
  }

  public canAfford(saveCtx: GoodsSaveCtx): boolean {
    return this.getPriceConditions(saveCtx).every((condition) => condition.met);
  }

  /** 解锁条件 + 价格条件，顺序稳定，便于 UI 逐行展示。 */
  public getConditions(saveCtx: GoodsSaveCtx): GoodsCondition[] {
    return [...this.getUnlockConditions(saveCtx), ...this.getPriceConditions(saveCtx)];
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

  /** 子类只需声明自己的解锁条件；isUnlocked 由条件统一推导。 */
  protected getUnlockConditions(_saveCtx: GoodsSaveCtx): GoodsCondition[] {
    return [];
  }

  protected levelCondition(saveCtx: GoodsSaveCtx, levelId: number, chapterId: number = 1): GoodsConditionLevel {
    return {
      type: 'level',
      levelId,
      chapterId,
      met: saveCtx.gameManager.isLevelUnlocked(levelId, chapterId),
    };
  }

  protected slotCountCondition(saveCtx: GoodsSaveCtx, required: number): GoodsConditionSlots {
    const current = saveCtx.gameProgress.slotNum;
    return { type: 'slots', required, current, met: current === required };
  }

  protected getPriceConditions(saveCtx: GoodsSaveCtx): GoodsCondition[] {
    const priceItems = this.getPrice(saveCtx).items;
    const conditions: GoodsCondition[] = [];

    const goldItem = priceItems.find((item) => item.id === 1);
    if (goldItem) {
      const current = saveCtx.gameProgress.items.get(1)?.count ?? 0;
      conditions.push({ type: 'gold', required: goldItem.count, current, met: current >= goldItem.count });
    }

    const materialItems = priceItems.filter((item) => item.id !== 1 && item.count > 0);
    if (materialItems.length > 0) {
      const items = materialItems.map((item) => ({
        item,
        current: saveCtx.gameProgress.items.get(item.id)?.count ?? 0,
        required: item.count,
      }));
      conditions.push({ type: 'material', items, met: items.every((entry) => entry.current >= entry.required) });
    }

    return conditions;
  }

  protected isUnlocked(saveCtx: GoodsSaveCtx): boolean {
    return this.getUnlockConditions(saveCtx).every((condition) => condition.met);
  }

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
