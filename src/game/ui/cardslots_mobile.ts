import DepthHelper from "../utils/helper/DepthHelper";
import type { Game } from "../scenes/Game";
import ResourceManager from "../managers/combat/ResourceManager";
import CardpileManager from "../managers/combat/CardpileManager";
import PlantsManager from "../managers/combat/PlantsManager";
import { PlantLibrary } from "../managers/library/PlantLibrary";
import {
  EnergyPanelView,
  PlantCardView,
  ToolButtonView,
  UI_CHROME_DEPTH,
} from "./cardslots";
import { getMobileSideBarLayout } from "./mobileSideBarLayout";

type ItemSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class MobileCardSlots {
  private readonly scene: Game;
  private readonly cards: PlantCardView[] = [];
  private readonly panels: Phaser.GameObjects.Graphics[] = [];
  private readonly unsubs: Array<() => void> = [];
  private energyPanel: EnergyPanelView | null = null;
  private pickaxe: ToolButtonView | null = null;

  constructor(scene: Game) {
    this.scene = scene;
    this.create();
    this.bindEvents();
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  public destroy = () => {
    for (const unsub of this.unsubs.splice(0)) {
      unsub();
    }
    for (const card of this.cards.splice(0)) {
      card.destroy();
    }
    for (const panel of this.panels.splice(0)) {
      panel.destroy();
    }
    this.energyPanel?.destroy();
    this.energyPanel = null;
    this.pickaxe?.destroy();
    this.pickaxe = null;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  };

  private create() {
    const layout = getMobileSideBarLayout();
    const bounds = layout.bounds;
    const cardSection = layout.cardSection;
    const pad = layout.padding;
    const gap = Math.max(3, Math.round(layout.laneGap));
    const itemGap = Math.max(3, Math.round(cardSection.height * 0.018));
    const rowCount = Math.max(2, Math.ceil((this.scene.params.plants.length + 2) / 3));
    const itemHeight = Math.max(
      28,
      Math.min(58, (cardSection.height - pad * 2 - itemGap * Math.max(0, rowCount - 1)) / rowCount),
    );
    const energyHeight = itemHeight;
    const lanes = [0, 1, 2].map((lane) => bounds.x + pad + lane * (layout.laneWidth + gap));
    const sectionTop = bounds.y + cardSection.y + pad;
    const sectionBottom = bounds.y + cardSection.y + cardSection.height - pad;

    const laneGraphics = this.scene.add.graphics().setDepth(DepthHelper.UI.chromeLane());
    laneGraphics.lineStyle(1, 0x111111, 0.55);
    laneGraphics.lineBetween(lanes[1] - gap / 2, bounds.y + cardSection.y + 4, lanes[1] - gap / 2, bounds.y + cardSection.y + cardSection.height - 4);
    laneGraphics.lineBetween(lanes[2] - gap / 2, bounds.y + cardSection.y + 4, lanes[2] - gap / 2, bounds.y + cardSection.y + cardSection.height - 4);
    this.panels.push(laneGraphics);

    this.energyPanel = new EnergyPanelView(
      this.scene,
      lanes[2],
      sectionTop,
      layout.laneWidth,
      energyHeight,
      true,
    );

    const slots: ItemSlot[] = [];
    for (let row = 0; row < rowCount; row += 1) {
      const y = sectionTop + row * (itemHeight + itemGap);
      if (y + itemHeight > sectionBottom + 1) {
        break;
      }

      slots.push({ x: lanes[0], y, width: layout.laneWidth, height: itemHeight });
      slots.push({ x: lanes[1], y, width: layout.laneWidth, height: itemHeight });
      if (row > 0) {
        slots.push({ x: lanes[2], y, width: layout.laneWidth, height: itemHeight });
      }
    }

    const pickaxeSlot = [...slots].reverse().find((slot) => slot.x === lanes[0]);
    const plants = this.scene.params.plants;
    const plantSlots = slots.filter((slot) => slot !== pickaxeSlot);
    plants.forEach((plant, index) => {
      const slot = plantSlots[index];
      if (!slot) {
        return;
      }
      const model = PlantLibrary.GetModel(plant.pid);
      if (!model) {
        return;
      }
      this.cards.push(new PlantCardView({
        scene: this.scene,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        plantModel: model,
        level: plant.level,
        orientation: "mobile",
        disableWhenExpensive: true,
      }));
    });

    if (pickaxeSlot) {
      this.pickaxe = new ToolButtonView(
        this.scene,
        pickaxeSlot.x,
        pickaxeSlot.y,
        pickaxeSlot.width,
        pickaxeSlot.height,
        "image",
      );
    }

    this.updateEnergy(ResourceManager.Instance.getDisplayEnergy("mine"));
    this.updateSelection();
  }

  private bindEvents() {
    this.unsubs.push(ResourceManager.Instance.Eventbus.on("onEnergyUpdate", () => {
      this.updateEnergy(ResourceManager.Instance.getDisplayEnergy("mine"));
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onCooldownStatus", (status) => {
      this.updateCooldown(status);
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenCard", () => this.updateSelection()));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenPickaxe", () => this.updateSelection()));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenStarShards", () => this.updateSelection()));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onCancelChosen", () => this.updateSelection()));
    this.unsubs.push(PlantsManager.Instance.EventBus.on("onEnergyInsufficient", () => {
      this.energyPanel?.flashInsufficient();
    }));
  }

  private updateEnergy(energy: number) {
    this.energyPanel?.setEnergy(energy);
    for (const card of this.cards) {
      card.setEnergy(energy);
    }
  }

  private updateCooldown(status: Map<number, { hasReloaded: boolean; leftPercent: number }>) {
    for (const card of this.cards) {
      const cardStatus = status.get(card.pid);
      if (cardStatus) {
        card.setCooldown(cardStatus.hasReloaded, cardStatus.leftPercent);
      }
    }
  }

  private updateSelection() {
    const choice = CardpileManager.Instance.GetCurrentChoice();
    for (const card of this.cards) {
      card.setSelected(choice.type === "plant" && choice.pid === card.pid);
    }
    this.pickaxe?.setSelected(choice.type === "pickaxe");
  }
}
