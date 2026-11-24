import type { Game } from "../scenes/Game";
import ResourceManager from "../managers/combat/ResourceManager";
import CardpileManager from "../managers/combat/CardpileManager";
import PlantsManager from "../managers/combat/PlantsManager";
import { PositionManager } from "../managers/view/PositionManager";
import {
  createCardSlotsController,
  drawChromePanel,
  EnergyPanelView,
  getPcLayout,
  updateCardSlotsSelection,
  type CardSlotsController,
} from "./cardSlotWidgets";
import {
  getMobileCardSlotChromeLayout,
} from "../../constants/cardSlotLayout";
import { getMobileSideBarLayout } from "./mobileSideBarLayout";

export class CardSlots {
  private readonly scene: Game;
  private readonly deviceType: string;
  private readonly panels: Phaser.GameObjects.Graphics[] = [];
  private readonly unsubs: Array<() => void> = [];
  private energyPanel: EnergyPanelView | null = null;
  private controller: CardSlotsController | null = null;
  private cardCount = 0;

  constructor(scene: Game) {
    this.scene = scene;
    this.deviceType = scene.params.deviceType ?? "pc";
    this.rebuild();
    this.bindEvents();
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  public destroy = () => {
    for (const unsubscribe of this.unsubs.splice(0)) unsubscribe();
    this.clearLayout();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  };

  private clearLayout() {
    for (const panel of this.panels.splice(0)) {
      this.scene.unregisterCardBandObject(panel);
      panel.destroy();
    }
    this.energyPanel?.destroy();
    this.energyPanel = null;
    if (this.controller) {
      for (const card of this.controller.cards) card.destroy();
      this.controller.pickaxe?.destroy();
      this.controller = null;
    }
  }

  private rebuild() {
    const chrome = PositionManager.Instance.getSceneChromeLayout(this.deviceType);
    this.clearLayout();
    this.cardCount = this.scene.params.plants.length;
    if (this.deviceType === "mobile") {
      const layout = getMobileSideBarLayout();
      const cardSection = {
        x: layout.bounds.x,
        y: layout.bounds.y + layout.cardSection.y,
        width: layout.cardSection.width,
        height: layout.cardSection.height,
      };
      const slotLayout = getMobileCardSlotChromeLayout(cardSection, this.cardCount);
      this.panels.push(drawChromePanel(this.scene, layout.bounds.x, layout.bounds.y, layout.bounds.width, layout.bounds.height));
      this.energyPanel = new EnergyPanelView(
        this.scene,
        slotLayout.energy.x,
        slotLayout.energy.y,
        slotLayout.energy.width,
        slotLayout.energy.height,
      );
      this.controller = createCardSlotsController(this.scene, slotLayout);
      this.pullCurrentState();
      return;
    }
    const pcLayout = getPcLayout(this.deviceType, this.cardCount);
    this.panels.push(drawChromePanel(this.scene, chrome.topCardSlot.x, chrome.topCardSlot.y, chrome.topCardSlot.width, chrome.topCardSlot.height));
    this.energyPanel = new EnergyPanelView(this.scene, pcLayout.energy.x, pcLayout.energy.y, pcLayout.energy.width, pcLayout.energy.height);
    this.controller = createCardSlotsController(this.scene, pcLayout);
    this.pullCurrentState();
  }

  /**
   * 新挂载的控件默认显示 0 能量/满冷却；开局事件通常早于 UI 创建，
   * 必须主动拉取一次当前权威值，否则要等第一次资源变化才会刷新。
   */
  private pullCurrentState() {
    const energy = ResourceManager.Instance.getDisplayEnergy("mine");
    this.energyPanel?.setEnergy(energy);
    const cooldownStatus = CardpileManager.Instance.GetDisplayCooldownStatus();
    for (const card of this.controller?.cards ?? []) {
      card.setEnergy(energy);
      const status = cooldownStatus.get(card.pid);
      if (status) card.setCooldown(status.hasReloaded, status.leftPercent);
    }
  }

  /** 调试/E2E：能量面板当前显示的文本（未挂载时 null）。 */
  public getDisplayedEnergyText(): string | null {
    return this.energyPanel?.getEnergyText() ?? null;
  }

  private syncCardCount() {
    if (this.scene.params.plants.length !== this.cardCount) this.rebuild();
  }

  private bindEvents() {
    this.pullCurrentState();
    this.unsubs.push(ResourceManager.Instance.Eventbus.on("onEnergyUpdate", () => {
      const energy = ResourceManager.Instance.getDisplayEnergy("mine");
      this.energyPanel?.setEnergy(energy);
      for (const card of this.controller?.cards ?? []) card.setEnergy(energy);
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onCooldownStatus", (status) => {
      for (const card of this.controller?.cards ?? []) {
        const cardStatus = status.get(card.pid);
        if (cardStatus) card.setCooldown(cardStatus.hasReloaded, cardStatus.leftPercent);
      }
    }));
    for (const event of ["onChosenCard", "onChosenPickaxe", "onChosenStarShards", "onCancelChosen"] as const) {
      this.unsubs.push(CardpileManager.Instance.EventBus.on(event, () => {
        this.syncCardCount();
        if (this.controller) updateCardSlotsSelection(this.controller);
      }));
    }
    this.unsubs.push(PlantsManager.Instance.EventBus.on("onEnergyInsufficient", () => {
      this.energyPanel?.flashInsufficient();
    }));
  }
}
