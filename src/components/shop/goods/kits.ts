import { DamageConstants } from "../../../constants/game";
import { Goods } from "../../../types/goods";
import type { GoodsPrice, GoodsSaveCtx } from "../../../types/goods";
import { DistributePoints } from "../../../utils/random";

export class Cp1Kit extends Goods {
  public override readonly id = 3;
  public override readonly nameKey = "name_chapter1_kit";
  public override readonly iconKey = "/assets/card/items/chapter1_kit.svg";
  public override readonly descriptionKey = "chapter1_kit_description";

  public override hasBought(_saveCtx: GoodsSaveCtx): boolean {
    return false;
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [{ id: 1, count: 200, nameKey: "gold", iconKey: "gold" }],
    };
  }

  protected override canRepeatPurchase(_saveCtx: GoodsSaveCtx): boolean {
    return true;
  }

  protected override isUnlocked(saveCtx: GoodsSaveCtx): boolean {
    return saveCtx.gameProgress.level.has(3);
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    const points = DistributePoints(2, 3);
    if (points[0] > 0) {
      saveCtx.gameManager.updateItemCount({ id: 2, nameKey: "leather", iconKey: "leather" }, points[0]);
    }
    if (points[1] > 0) {
      saveCtx.gameManager.updateItemCount({ id: 3, nameKey: "iron", iconKey: "iron" }, points[1]);
    }
  }
}

export class ScarletborderCrystal extends Goods {
  public override readonly id = DamageConstants.SECKILL;
  public override readonly nameKey = "name_scarletborder_crystal";
  public override readonly iconKey = "/assets/card/items/scb.svg";
  public override readonly descriptionKey = "scarletborder_crystal_description";

  public override hasBought(_saveCtx: GoodsSaveCtx): boolean {
    return false;
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [{ id: 1, count: 1, nameKey: "gold", iconKey: "gold" }],
    };
  }

  protected override canRepeatPurchase(_saveCtx: GoodsSaveCtx): boolean {
    return true;
  }

  protected override isUnlocked(saveCtx: GoodsSaveCtx): boolean {
    return saveCtx.gameProgress.level.has(5);
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    saveCtx.gameManager.updateItemCount({ id: DamageConstants.SECKILL, nameKey: "scb", iconKey: "scb" }, 1);
  }
}
