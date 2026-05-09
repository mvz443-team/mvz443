import { DamageConstants } from "../../../../constants/game";
import { Goods } from "../../../../types/goods";
import type { GoodsPrice, GoodsSaveCtx } from "../../../../types/goods";

export class PumpkinWan extends Goods {
  public override readonly id = 4;
  public override readonly nameKey = "name_pumpkin_wan";
  public override readonly iconKey = "/assets/card/plant/pumpkin_wan.png";
  public override readonly descriptionKey = "pumpkin_wan_shop_description";

  public override hasBought(saveCtx: GoodsSaveCtx): boolean {
    return super.hasBought(saveCtx) || this.hasPlant(saveCtx, 11);
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [
        { id: 1, count: 600, nameKey: "gold", iconKey: "gold" },
        { id: 2, count: 5, nameKey: "leather", iconKey: "leather" },
        { id: 3, count: 5, nameKey: "iron", iconKey: "iron" },
      ],
    };
  }

  protected override isUnlocked(saveCtx: GoodsSaveCtx): boolean {
    return saveCtx.gameManager.isLevelUnlocked(5);
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    saveCtx.gameManager.recordPlantEncounter(11);
  }
}

export class ATDispenser extends Goods {
  public override readonly id = 5;
  public override readonly nameKey = "name_at_dispenser";
  public override readonly iconKey = "/assets/card/plant/at_dispenser.png";
  public override readonly descriptionKey = "at_dispenser_shop_description";

  public override hasBought(saveCtx: GoodsSaveCtx): boolean {
    return super.hasBought(saveCtx) || this.hasPlant(saveCtx, 14);
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [
        { id: 1, count: 800, nameKey: "gold", iconKey: "gold" },
        { id: 3, count: 10, nameKey: "iron", iconKey: "iron" },
      ],
    };
  }

  protected override isUnlocked(saveCtx: GoodsSaveCtx): boolean {
    return saveCtx.gameManager.isLevelUnlocked(7);
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    saveCtx.gameManager.recordPlantEncounter(14);
  }
}

export class Chapter2Plants extends Goods {
  private readonly plantIds = [15, 16, 17];

  public override readonly id = 7;
  public override readonly nameKey = "name_chapter2_plants";
  public override readonly iconKey = "/assets/card/plant/elastic_putin.png";
  public override readonly descriptionKey = "chapter2_plants_description";

  public override hasBought(saveCtx: GoodsSaveCtx): boolean {
    return super.hasBought(saveCtx) || this.hasAnyPlant(saveCtx, this.plantIds);
  }

  public override getPrice(_saveCtx: GoodsSaveCtx): GoodsPrice {
    return {
      items: [{ id: DamageConstants.SECKILL, count: 1, nameKey: "scb", iconKey: "scb" }],
    };
  }

  protected override isUnlocked(saveCtx: GoodsSaveCtx): boolean {
    return saveCtx.gameManager.isLevelUnlocked(6);
  }

  protected override onBought(saveCtx: GoodsSaveCtx): void {
    this.plantIds.forEach((pid) => saveCtx.gameManager.recordPlantEncounter(pid));
  }
}
