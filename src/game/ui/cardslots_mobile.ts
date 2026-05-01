import type { Game } from "../scenes/Game";
import { PositionManager } from "../managers/view/PositionManager";
import ResourceManager from "../managers/combat/ResourceManager";
import CardpileManager from "../managers/combat/CardpileManager";
import PlantsManager from "../managers/combat/PlantsManager";
import { PlantLibrary } from "../managers/library/PlantLibrary";
import {
  drawChromePanel,
  EnergyPanelView,
  PlantCardView,
  ToolButtonView,
} from "./cardslots";

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
    const layout = PositionManager.Instance.getSceneChromeLayout("mobile");
    const leftLane = layout.mobileLeftCardSlot;
    const rightLane = layout.mobileRightCardSlot;
    this.panels.push(drawChromePanel(this.scene, leftLane.x, leftLane.y, leftLane.width, leftLane.height));
    this.panels.push(drawChromePanel(this.scene, rightLane.x, rightLane.y, rightLane.width, rightLane.height));

    const pad = 0;
    const gap = 5;
    const mainPlants = this.scene.params.plants.slice(0, 9);
    const extraPlants = this.scene.params.plants.slice(9);

    const rightCardWidth = rightLane.width;
    const energyHeight = Math.max(42, Math.min(58, rightLane.height * 0.1));
    const rightCardHeight = Math.max(
      38,
      Math.min(58, (rightLane.height - pad * 2 - energyHeight - gap - gap * Math.max(0, mainPlants.length - 1)) / Math.max(1, mainPlants.length)),
    );

    this.energyPanel = new EnergyPanelView(
      this.scene,
      rightLane.x,
      rightLane.y,
      rightCardWidth,
      energyHeight,
      true,
    );

    let rightY = rightLane.y + energyHeight + gap;
    for (const plant of mainPlants) {
      const model = PlantLibrary.GetModel(plant.pid);
      if (!model) {
        continue;
      }
      this.cards.push(new PlantCardView({
        scene: this.scene,
        x: rightLane.x,
        y: rightY,
        width: rightCardWidth,
        height: rightCardHeight,
        plantModel: model,
        level: plant.level,
        orientation: "mobile",
        disableWhenExpensive: true,
      }));
      rightY += rightCardHeight + gap;
    }

    const leftCardWidth = leftLane.width;
    const leftItemCount = Math.max(1, extraPlants.length + 1);
    const leftCardHeight = Math.max(
      38,
      Math.min(58, (leftLane.height - pad * 2 - gap * Math.max(0, leftItemCount - 1)) / leftItemCount),
    );
    let leftY = leftLane.y;

    this.pickaxe = new ToolButtonView(
      this.scene,
      leftLane.x,
      leftY,
      leftCardWidth,
      leftCardHeight,
      "text",
    );
    leftY += leftCardHeight + gap;

    for (const plant of extraPlants) {
      const model = PlantLibrary.GetModel(plant.pid);
      if (!model) {
        continue;
      }
      this.cards.push(new PlantCardView({
        scene: this.scene,
        x: leftLane.x,
        y: leftY,
        width: leftCardWidth,
        height: leftCardHeight,
        plantModel: model,
        level: plant.level,
        orientation: "mobile",
        disableWhenExpensive: true,
      }));
      leftY += leftCardHeight + gap;
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
