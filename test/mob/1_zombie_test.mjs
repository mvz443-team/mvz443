import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  makePlantTarget,
  tick,
  getPlantsMap,
  ResourceCmd,
} from "../harness/sim.mjs";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { attackTargetRank } from "../../src/game/models/MonsterModel.ts";
import { snapshotModel } from "../../src/game/core/logic/LogicModel.ts";
import { Faction } from "../../src/game/models/Enum.ts";

/**
 * 描述（Zombie）：
 *   第一章基础僵尸：300 血、20 攻击、200ms 攻击间隔；血量降到 150 以下切换破损躯体；
 *   携带星之碎片时死亡会向全场掉落。
 *   同一格里叠着护盾植物（南瓜护照）和内部植物时，护盾碎了不能无视内部植物继续前进。
 *
 * 验收路径：
 *   1) 读取 Model 的 mid / maxHealth / baseAttackDamage / attackInterval / damageThresholds。
 *   2) 让僵尸攻击 100 血植物，统计 1s 内伤害次数与总伤害。
 *   3) 直接扣血后调用 updateBodyDamageStage，检查 currentStage。
 *   4) addStarShards 后击杀，检查 ResourceCmd 掉落。
 *   5) 同格注册「护盾 + 内部植物」，先打碎护盾，观察 attacking / 后续伤害落点。
 *   6) 直接调用 onAttackTargetDestroyed，模拟护盾被别处打碎时的接力路径。
 *   7) 打乱同格 PlantsMap 数组顺序重跑接力，检查目标与顺序无关。
 *   8) 统计 tickmanager 里的 MonsterAttack 定时器数量，模拟重连后句柄失效。
 *
 * 预期结果：
 *   100 血植物在 1000ms 时被 5 次 ×20 打死；
 *   血量 149 时 currentStage=0；星碎掉落 1 颗；
 *   护盾碎的同一帧 attacking 换成同格内部植物，继续站定输出而不是 startMove；
 *   接力目标恒为「护盾 > 粉尘 > 普通植物 > 承载物」中优先级最高者，与数组顺序无关；
 *   任何时刻只有 1 条 MonsterAttack 循环，重连句柄失效后也能按事件名清掉。
 *
 * 为什么：
 *   beginAttackTimer 使用 schedule(loop) 每 200ms 触发 hurtTarget；
 *   updateBodyDamageStage 对单阈值 [150] 在 health<=150 时置 stage=0；
 *   zombieDie 调用 dropCarriedStarShards，ResourceCmd.AddStarshardToAll(1)；
 *   hurtTarget / onAttackTargetDestroyed 丢失目标时先在同格补判
 *   （Rapier sensor 只在 overlap-start 派发，护盾碎了不会再有新的碰撞事件）；
 *   接力用 attackTargetRank 显式全序排序，避免依赖 PlantsMap 插入顺序
 *   （重连按快照 id 重建实体，顺序与连续运行的客户端不同）；
 *   beginAttackTimer / stopAttacking 都按事件名兜底清理循环定时器。
 */

test("基础数值与攻击节奏", () => {
  resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 1);
  assert.equal(model.health, 300);
  assert.equal(model.baseAttackDamage, 20);
  assert.equal(model.attackInterval, 200);
  assert.deepEqual(model.damageThresholds, [150]);
  assert.equal(entity.faction, 2);
});

test("1s 内 5 次攻击打死 100 血植物", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2, hp: 100 });

  assert.equal(model.tryStartAttack(entity, target), true);
  tick(sim, 1_000);

  assert.equal(target.model.health, 0);
  assert.equal(target.destroyed, true);
});

test("血量降到阈值以下进入破损阶段", () => {
  resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  model.takeDamage(entity, 151);
  model.updateBodyDamageStage(entity, model.damageThresholds);

  assert.equal(model.health, 149);
  assert.equal(model.currentStage, 0);
  assert.equal(entity.animController.raw.switchBodyFrame !== undefined, true);
});

test("携带星之碎片死亡后掉落给全场", () => {
  resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  model.addStarShards(entity, 1);

  model.takeDamage(entity, 300);

  assert.deepEqual(ResourceCmd.calls, [{ kind: "starshard", amount: 1 }]);
  assert.equal(model.starShardsDropped, true);
  assert.equal(model.carryStarShards, false);
});

test("护盾植物被打碎后继续攻击同格的内部植物", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const shield = makePlantTarget({ col: 7, row: 2, hp: 20, pid: 19 });
  const inner = makePlantTarget({ col: 7, row: 2, hp: 200, pid: 1 });
  getPlantsMap().set("7-2", [shield, inner]);

  assert.equal(model.tryStartAttack(entity, shield), true);
  assert.equal(entity.attacking, shield);

  // 第 4 帧（200ms）第一次啃咬：20 伤害正好打碎 20 血护盾。
  tick(sim, 200);
  assert.equal(shield.model.health, 0);
  assert.equal(inner.model.health, 200);

  // 同格接力：不重置攻击计时器，也不放僵尸继续前进。
  assert.equal(entity.attacking, inner);
  assert.equal(model.attackingId, inner.SnapshotId);
  assert.equal(model.isStop, true);
  assert.equal(entity.moveCalls.includes("start"), false);

  // 下一个 200ms 的啃咬落在内部植物身上。
  tick(sim, 200);
  assert.equal(inner.model.health, 180);
  assert.equal(entity.attacking, inner);
});

test("护盾被别处打碎时同样接力同格内部植物", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const shield = makePlantTarget({ col: 7, row: 2, hp: 20, pid: 19 });
  const inner = makePlantTarget({ col: 7, row: 2, hp: 200, pid: 1 });
  getPlantsMap().set("7-2", [shield, inner]);

  assert.equal(model.tryStartAttack(entity, shield), true);

  // PlantEntity.destroy() 的权威路径：护盾被别处的伤害打碎后通知攻击者。
  shield.model.health = 0;
  model.onAttackTargetDestroyed(entity, shield);
  assert.equal(entity.attacking, inner);
  assert.equal(model.isStop, true);
  assert.equal(entity.moveCalls.includes("start"), false);

  // 格子真的空了才继续前进。
  inner.model.health = 0;
  model.onAttackTargetDestroyed(entity, inner);
  assert.equal(entity.attacking, null);
  assert.equal(model.isStop, false);
  assert.equal(entity.moveCalls.includes("start"), true);

  tick(sim, 200);
  assert.equal(entity.attacking, null);
});

test("魅惑改阵营后按有效阵营重选目标，不重建普攻定时器", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const shield = makePlantTarget({ col: 7, row: 2, hp: 100, pid: 19 });
  const inner = makePlantTarget({ col: 7, row: 2, hp: 200, pid: 1 });
  inner.faction = Faction.PLAYER2;
  getPlantsMap().set("7-2", [shield, inner]);

  assert.equal(model.tryStartAttack(entity, shield), true);
  assert.equal(attackTimerCount(model), 1);

  // 魅惑到 PLANT：原目标(PLANT)变成友军，同格 PLAYER2 植物成为新敌人。
  model.setCharm(Faction.PLANT);
  assert.equal(entity.attacking, inner);
  assert.equal(model.attackingId, inner.SnapshotId);
  assert.equal(attackTimerCount(model), 1, "换目标不能重建普攻循环");
  assert.equal(entity.moveCalls.includes("start"), false);

  // 下一个啃咬帧仍打在新目标上。
  tick(sim, 200);
  assert.equal(inner.model.health, 180);

  // 同格再无敌对目标时停攻，并清掉唯一的普攻循环。
  inner.faction = Faction.PLANT;
  model.setCharm(Faction.PLANT);
  assert.equal(entity.attacking, null);
  assert.equal(attackTimerCount(model), 0);
});

test("魅惑持续时间按逻辑帧倒计时，到期清除并恢复敌对关系", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 7, row: 2, hp: 200, pid: 1 });
  getPlantsMap().set("7-2", [plant]);

  assert.equal(model.tryStartAttack(entity, plant), true);
  model.setCharm(Faction.PLANT, 400); // 8 帧（50ms/帧）

  assert.equal(entity.attacking, null, "魅惑后同阵营植物不再是目标");
  assert.equal(attackTimerCount(model), 0);
  assert.equal(model.charmUntilFrame > 0, true);
  assert.equal(snapshotModel(model).charmUntilFrame, model.charmUntilFrame);

  tick(sim, 350);
  assert.equal(model.charmedBy, Faction.PLANT, "未到期仍保持魅惑");
  assert.equal(model.getCharmLeftMs(), 50);

  tick(sim, 50);
  assert.equal(model.charmedBy, null);
  assert.equal(model.charmUntilFrame, 0);
  assert.equal(model.getCharmLeftMs(), 0);
  assert.equal(attackTimerCount(model), 0);
});

/** 统计本 Model 的普攻循环定时器数量（重连/多次碰撞都只能有 1 条）。 */
function attackTimerCount(model) {
  return model.tickmanager.capture().filter((timer) => timer.kind === "MonsterAttack").length;
}

/** 用给定的数组顺序搭同格植物，返回护盾碎后接力到的 pid。 */
function retargetPidWithOrder(order) {
  resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const shield = makePlantTarget({ col: 7, row: 2, hp: 100, pid: 19 });
  const cell = order.map((pid) => (pid === 19 ? shield : makePlantTarget({ col: 7, row: 2, hp: 100, pid })));
  getPlantsMap().set("7-2", cell);

  assert.equal(model.tryStartAttack(entity, shield), true);
  shield.model.health = 0;
  model.onAttackTargetDestroyed(entity, shield);
  return entity.attacking?.pid ?? null;
}

test("怪物 Definition 配置不进快照，faction 作为运行时字段进快照", () => {
  resetSim();
  const { model } = spawnMob(ZombieData, { col: 8, row: 2 });
  const snapshot = snapshotModel(model);

  for (const key of [
    "mid",
    "nameKey",
    "texturePath",
    "maxHealth",
    "baseSpeed",
    "baseAttackDamage",
    "attackInterval",
    "rank",
    "habitats",
    "boatMounted",
    "mountHealthConfig",
    "mountDamagePriority",
    "canDrown",
    "damageThresholds",
    "tickEventNames",
  ]) {
    assert.equal(key in snapshot, false, `${key} 不应进入快照`);
  }

  assert.equal(model.mid, ZombieData.mid);
  assert.equal(model.maxHealth, 300);
  assert.equal(model.baseAttackDamage, 20);
  assert.equal(model.damageThresholds.length, 1);

  // v9：阵营是运行时可回滚字段，必须随 Model 快照落地。
  assert.equal(snapshot.faction, 2); // Faction.ZOMBIE
  assert.equal(model.faction, 2);
});

test("同格接力目标与 PlantsMap 数组顺序无关（重连重建顺序不同不会分叉）", () => {
  // 优先级：护盾外壳 0 < 粉尘植物 1 < 普通植物 2 < 承载物 3
  assert.ok(attackTargetRank(19) < attackTargetRank(10));
  assert.ok(attackTargetRank(10) < attackTargetRank(1));
  assert.ok(attackTargetRank(1) < attackTargetRank(6));

  const powderOrders = [
    [19, 10, 1],
    [1, 19, 10],
    [10, 1, 19],
    [1, 10, 19],
    [10, 19, 1],
    [19, 1, 10],
  ];
  // 护盾碎了以后同格还有「粉尘植物 + 普通植物」：任何插入顺序都必须选粉尘植物。
  assert.deepEqual([...new Set(powderOrders.map(retargetPidWithOrder))], [10]);

  const carrierOrders = [
    [19, 6, 1],
    [1, 19, 6],
    [6, 1, 19],
    [1, 6, 19],
  ];
  // 睡莲是承载物，永远排在普通植物之后。
  assert.deepEqual([...new Set(carrierOrders.map(retargetPidWithOrder))], [1]);
});

test("同格两次接触只保留一条普攻定时器", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const shield = makePlantTarget({ col: 7, row: 2, hp: 500, pid: 19 });
  const inner = makePlantTarget({ col: 7, row: 2, hp: 500, pid: 1 });
  getPlantsMap().set("7-2", [shield, inner]);

  // 同帧两次 overlap-start（护盾 + 内部植物各一次）。
  model.tryStartAttack(entity, shield);
  model.tryStartAttack(entity, inner);
  assert.equal(attackTimerCount(model), 1);

  // 节奏仍是 200ms 一次，不存在"双倍攻速"。
  tick(sim, 400);
  const damaged = (500 - shield.model.health) + (500 - inner.model.health);
  assert.equal(damaged, 40);
});

test("重连后 Entity 句柄失效也能停掉普攻循环", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2, hp: 500, pid: 1 });

  assert.equal(model.tryStartAttack(entity, target), true);
  assert.equal(attackTimerCount(model), 1);

  // 跨进程重建：Entity 上的 timer 句柄不进快照，重建后是 null，
  // 而 tickmanager 里的 loop 定时器会被 restore 回来。
  entity.attackTimer = null;
  model.stopAttacking(entity);

  assert.equal(attackTimerCount(model), 0);
  // 旧循环不再触发 hurtTarget，僵尸保持前进而不是每 200ms 反复 startMove。
  const moveCallsAfterStop = entity.moveCalls.filter((call) => call === "start").length;
  tick(sim, 600);
  assert.equal(entity.moveCalls.filter((call) => call === "start").length, moveCallsAfterStop);
});

test("死亡销毁由 Model 权威帧定时器驱动，不在表现层回调里结算", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });

  model.takeDamage(entity, 300);
  assert.equal(model.isDying, true);
  assert.equal(entity.destroyed, false);

  // 350ms（7 帧，未到 DeathSettle）不应销毁：击杀计数必须等权威帧定时器，
  // 而不是 Phaser 死亡动画的 onComplete。
  tick(sim, 350);
  assert.equal(entity.destroyed, false);

  // 跨过 400ms 的 DeathSettle（第 8 帧）：Model 派发事件调用 host.destroy()。
  tick(sim, 50);
  assert.equal(entity.destroyed, true);
});
