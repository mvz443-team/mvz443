import { BaseManager } from "../BaseManager";
import type { Game } from "../../scenes/Game";
import { MineCartStandEntity } from "../../presets/bullet/minecart";
import { PositionManager } from "../view/PositionManager";
import MobManager from "./MobManager";
import TickerManager from "./TickerManager";

type TileItemKind = "minecart";

type TileItemSlot = {
  kind: TileItemKind;
  row: number;
};

export default class TileItemManager extends BaseManager {
  private static _instance: TileItemManager;

  protected scene: Game | null = null;
  private readonly slotsByRow: Map<number, TileItemSlot> = new Map();
  private readonly minecartLostWaveByRow: Map<number, number> = new Map();
  private currentWaveId = -1;
  private offNewWave: (() => void) | null = null;

  private static readonly MINECART_COL = -1.2;
  private static readonly MINECART_ROW_SPAWN_DELAY_MS = 140;

  public static get Instance(): TileItemManager {
    if (!this._instance) {
      this._instance = new TileItemManager();
    }
    return this._instance;
  }

  public Load(): void {
    this.offNewWave = MobManager.Instance.EventBus.on("onNewWave", this.handleNewWave);
  }

  public Reset(): void {
    this.offNewWave?.();
    this.offNewWave = null;
    this.slotsByRow.clear();
    this.minecartLostWaveByRow.clear();
    this.currentWaveId = -1;
    this.scene = null;
  }

  public recordMinecartLost(row: number): void {
    if (!this.slotsByRow.has(row)) {
      return;
    }
    this.slotsByRow.delete(row);
    if (!this.minecartLostWaveByRow.has(row)) {
      this.minecartLostWaveByRow.set(row, this.currentWaveId);
    }
  }

  public getMinecartLostWaveByRow(): ReadonlyMap<number, number> {
    return this.minecartLostWaveByRow;
  }

  /** 地块道具状态（影响后续出怪行选择）。 */
  public CaptureTileItemState(): Record<string, unknown> {
    return {
      currentWaveId: this.currentWaveId,
      slots: [...this.slotsByRow.values()]
        .map((slot) => ({ row: slot.row, kind: slot.kind }))
        .sort((a, b) => a.row - b.row),
      lost: [...this.minecartLostWaveByRow.entries()]
        .map(([row, waveId]) => ({ row, waveId }))
        .sort((a, b) => a.row - b.row),
    };
  }

  public RestoreTileItemState(state: Record<string, unknown>): void {
    this.currentWaveId = Number(state.currentWaveId) || -1;
    this.slotsByRow.clear();
    const slots = Array.isArray(state.slots) ? (state.slots as Array<{ row: number; kind: string }>) : [];
    for (const slot of slots) {
      this.slotsByRow.set(Number(slot.row), { kind: "minecart", row: Number(slot.row) });
    }
    this.minecartLostWaveByRow.clear();
    const lost = Array.isArray(state.lost) ? (state.lost as Array<{ row: number; waveId: number }>) : [];
    for (const entry of lost) {
      this.minecartLostWaveByRow.set(Number(entry.row), Number(entry.waveId));
    }
  }

  private readonly handleNewWave = (waveId: number) => {
    this.currentWaveId = waveId;
    if (waveId === 0) {
      this.spawnInitialMinecarts();
    }
  };

  private spawnInitialMinecarts(): void {
    if (!this.scene) {
      return;
    }

    const rowCount = PositionManager.Instance.Row_Number;
    for (let row = 0; row < rowCount; row++) {
      this.spawnMinecart(row, row * TileItemManager.MINECART_ROW_SPAWN_DELAY_MS);
    }
  }

  private spawnMinecart(row: number, delay: number): void {
    if (!this.scene) {
      return;
    }

    const scene = this.scene;
    const position = PositionManager.Instance.getGridCenter(TileItemManager.MINECART_COL, row);
    this.slotsByRow.set(row, { kind: "minecart", row });

    TickerManager.Instance.delayedCall({
      delay,
      callback: () => {
        if (!this.scene || this.slotsByRow.get(row)?.kind !== "minecart") {
          return;
        }

        new MineCartStandEntity(scene, position.x, row, {
          onLost: (lostRow) => this.recordMinecartLost(lostRow),
        });
      },
    });
  }
}
