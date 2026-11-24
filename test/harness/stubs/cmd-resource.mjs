import TickerManager from "../../../src/game/managers/combat/TickerManager.ts";
import {
  RESOURCE_GAIN_DELAY_MS,
  RESOURCE_ADD_ENERGY_TIMER,
  RESOURCE_ADD_STARSHARD_TIMER,
  splitEnergyAmount,
} from "../../../src/game/utils/cmd/ResourceTiming.ts";
import { SfxCmd } from "./cmd-sfx.mjs";
import { GainEnergySfx } from "../../../src/game/sfx/energy/GainEnergySfx.ts";
import { GainStarShardSfx } from "../../../src/game/sfx/star/GainStarShardSfx.ts";

const calls = [];

/** 测试替身资源命令：动画配置记录到 anims，到账由真实 TickerManager 驱动。 */
const ResourceCmd = {
  calls,
  anims: [],
  AddEnergyToAll(amount) { calls.push({ kind: "energy", amount }); },
  AddStarshardToAll(amount) { calls.push({ kind: "starshard", amount }); },
  AddEnergyToAllWithAnim(amount, sfxCfg) {
    this.anims.push({ kind: "energy", amount, sfxCfg });
    const origin = sfxCfg?.origin ?? {};
    const sizes = sfxCfg?.energySize ? [sfxCfg.energySize] : splitEnergyAmount(amount);
    for (const size of sizes) {
      SfxCmd.Create(GainEnergySfx, {
        x: origin.x ?? 0, y: origin.y ?? 0, size, totalDurationMs: RESOURCE_GAIN_DELAY_MS,
      });
    }
    TickerManager.Instance.delayedCall({
      delay: RESOURCE_GAIN_DELAY_MS,
      callback: () => this.AddEnergyToAll(amount),
      snapshot: { kind: RESOURCE_ADD_ENERGY_TIMER, args: { amount } },
    });
  },
  AddStarshardToAllWithAnim(amount, sfxCfg) {
    this.anims.push({ kind: "starshard", amount, sfxCfg });
    const origin = sfxCfg?.origin ?? {};
    for (let i = 0; i < Math.max(1, amount); i++) {
      SfxCmd.Create(GainStarShardSfx, {
        x: origin.x ?? 0, y: origin.y ?? 0, amount: 1, totalDurationMs: RESOURCE_GAIN_DELAY_MS,
      });
    }
    TickerManager.Instance.delayedCall({
      delay: RESOURCE_GAIN_DELAY_MS,
      callback: () => this.AddStarshardToAll(amount),
      snapshot: { kind: RESOURCE_ADD_STARSHARD_TIMER, args: { amount } },
    });
  },
  creditEnergy(amount) { this.AddEnergyToAll(amount); },
  creditStarshard(amount) { this.AddStarshardToAll(amount); },
  reset() {
    calls.length = 0;
    this.anims.length = 0;
    // 跨局清理：防止上一局未到账的 timer 在新局触发。
    TickerManager.Instance.removeTimersByKind(RESOURCE_ADD_ENERGY_TIMER);
    TickerManager.Instance.removeTimersByKind(RESOURCE_ADD_STARSHARD_TIMER);
    TickerManager.Instance.Reset();
  },
};

export default ResourceCmd;
