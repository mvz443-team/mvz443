import type { Goods } from "../../../types/goods";
import { ATDispenser, Chapter2Plants, PumpkinWan } from "./cards";
import { Cp1Kit, ScarletborderCrystal } from "./kits";
import { EighthSlot, NinthSlot, SeventhSlot } from "./slots";

export * from "./cards";
export * from "./kits";
export * from "./slots";

export function newGoodLists(): Goods[] {
  return [
    new SeventhSlot(),
    new EighthSlot(),
    new Cp1Kit(),
    new ScarletborderCrystal(),
    new PumpkinWan(),
    new ATDispenser(),
    new NinthSlot(),
    new Chapter2Plants(),
  ];
}

export default function NewGoodLists(): Goods[] {
  return newGoodLists();
}
