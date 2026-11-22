import { Goods } from "../../../types/goods";
import type { GoodsCondition, GoodsPrice, GoodsSaveCtx } from "../../../types/goods";

export class SeventhSlot extends Goods {
  public override readonly id = 1;
  public override readonly nameKey = "name_slot7";
  public override readonly iconKey = "/assets/card/items/slot7.svg";
  public override readonly descriptionKey = "slot7_description";
  public override readonly category = 'upgrade' as const;

  public override hasBought(saveCtx: GoodsSaveCtx): boolean {
    return super.hasBought(saveCtx) || saveCtx.gameProgress.slotNum >= 7;
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [
        { id: 1, count: 220, nameKey: "gold", iconKey: "gold" },
        { id: 2, count: 1, nameKey: "leather", iconKey: "leather" },
      ],
    };
  }

  protected override getUnlockConditions(saveCtx: GoodsSaveCtx): GoodsCondition[] {
    return [
      this.levelCondition(saveCtx, 4),
      this.slotCountCondition(saveCtx, 6),
    ];
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    saveCtx.gameManager.updateSlotNum(7);
  }
}

export class EighthSlot extends Goods {
  public override readonly id = 2;
  public override readonly nameKey = "name_slot8";
  public override readonly iconKey = "/assets/card/items/slot8.svg";
  public override readonly descriptionKey = "slot8_description";
  public override readonly category = 'upgrade' as const;

  public override hasBought(saveCtx: GoodsSaveCtx): boolean {
    return super.hasBought(saveCtx) || saveCtx.gameProgress.slotNum >= 8;
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [{ id: 1, count: 450, nameKey: "gold", iconKey: "gold" }],
    };
  }

  protected override getUnlockConditions(saveCtx: GoodsSaveCtx): GoodsCondition[] {
    return [
      this.levelCondition(saveCtx, 5),
      this.slotCountCondition(saveCtx, 7),
    ];
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    saveCtx.gameManager.updateSlotNum(8);
  }
}

export class NinthSlot extends Goods {
  public override readonly id = 6;
  public override readonly nameKey = "name_slot9";
  public override readonly iconKey = "/assets/card/items/slot9.svg";
  public override readonly descriptionKey = "slot9_description";
  public override readonly category = 'upgrade' as const;

  public override hasBought(saveCtx: GoodsSaveCtx): boolean {
    return super.hasBought(saveCtx) || saveCtx.gameProgress.slotNum >= 9;
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [{ id: 1, count: 1000, nameKey: "gold", iconKey: "gold" }],
    };
  }

  protected override getUnlockConditions(saveCtx: GoodsSaveCtx): GoodsCondition[] {
    return [
      this.levelCondition(saveCtx, 7),
      this.slotCountCondition(saveCtx, 8),
    ];
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    saveCtx.gameManager.updateSlotNum(9);
  }
}
