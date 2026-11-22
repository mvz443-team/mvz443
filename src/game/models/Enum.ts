export enum Faction {
  PLANT = 1,   // 植物阵营（植物、玩家召唤物）
  ZOMBIE = 2,  // 僵尸阵营（僵尸、墓碑障碍物）
  /** 公共出怪：可被双方攻击，也攻击双方；NEUTRAL 之间不互殴。 */
  NEUTRAL = 3,
  /** PvP 预留：两名种植者的阵营，当前 preset 不使用。 */
  PLAYER1 = 4,
  PLAYER2 = 5,
}
