export type MonsterHandAnchor = {
  x: number;
  y: number;
};

export interface IMonsterAnimController {
  // 基础更新
  updatePosition(x: number, y: number): void;
  setDepth(depth: number): void;
  getHandAnchor?(): MonsterHandAnchor | null;

  // 视觉特效
  highlight(): void;
  twinkle?(): void;

  // 动作控制
  startLegSwing(): void;
  stopLegSwing(): void;
  startArmSwing(): void;
  stopArmSwing(): void;

  // 销毁
  destroy(): void;

  /**
   * 飞行载具状态（气球僵尸等）：true = 悬吊姿态，false = 站立姿态。
   * 只由 Entity.syncViewFromModel() 从 Model 单向同步。
   */
  setAirborne?(airborne: boolean): void;
  /** 悬吊姿态下的刚性旋转中心；固定挂件据此跟随旋转后的躯体。 */
  getHangPivot?(): MonsterHandAnchor | null;

  // 特殊状态 (如石巨人正在播放不可打断的动画)
  isInAnim?: boolean;
}
