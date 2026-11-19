import { BaseSfx } from "../../sfx/BaseSfx";

export namespace SfxCmd {
  type SfxCtor<T extends BaseSfx<any>> = new (args: ConstructorParameters<new (args: any) => T>[0]) => T;

  /**
   * 通用特效创建方法
   *
   * SFX 只做视觉表现，不得包含游戏逻辑回调 (例如创建实体、造成伤害、改变实体状态)。
   * 若需要在动画结束后执行视觉清理 (例如切换贴图可见性)，可使用 args.onComplete。
   * 需要配合游戏逻辑的定时效果，请在调用处使用 tickmanager.delayedCall 另行调度。
   *
   * @example
   * SfxCmd.Create(ArcSfx, { scene, x1, y1, x2, y2, texture, duration });
   */
  export function Create<T extends BaseSfx<any>>(
    ctor: SfxCtor<T>,
    args: ConstructorParameters<SfxCtor<T>>[0]
  ): T {
    const sfx = new ctor(args);
    // 特效只做表现，不参与权威模拟。场景销毁/回滚空窗期里 scene.add / tweens
    // 可能为 null；此时跳过播放，绝不能让异常冒泡到 tick/DeferredManager 循环
    // （否则会中断物理步进，表现为“僵尸刷出后不动”）。
    try {
      sfx.play();
    } catch (error) {
      console.warn("[SfxCmd] play skipped because the view is no longer available.", error);
    }
    return sfx;
  }
}
