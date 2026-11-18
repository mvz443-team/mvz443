import { BaseManager } from "./BaseManager";
import { Game } from "../scenes/Game";
import { getAuthoritativeFrame, withTickFrame } from "../core/logic/EntityTickManager";

type DeferredCommand = {
  /** 注册该命令时的权威逻辑帧；创建出的实体 timer 以此帧为起点。 */
  frame: number;
  command: () => void;
};

/**
 * 延迟管理器
 * 用于在帧末执行一些延迟操作，通常用于创建或彻底销毁实体
 */
export class DeferredManager extends BaseManager {
  // 单例实例
  private static _instance: DeferredManager;

  // 存储所有需要延迟到帧末执行的回调函数
  private commands: DeferredCommand[] = [];

  /**
   * 获取单例实例
   */
  public static get Instance(): DeferredManager {
    if (!this._instance) {
      this._instance = new DeferredManager();
    }
    return this._instance;
  }


  /**
   * 注册一个延迟执行的命令 (通常用于创建或彻底销毁实体)
   * @param command 回调函数
   */
  public defer(command: () => void): void {
    this.commands.push({
      frame: getAuthoritativeFrame(),
      command,
    });
  }

  /**
   * 清空并执行队列。
   * 必须在 Game 场景的 update 循环的【最末尾】调用。
   */
  public flush(): void {
    if (this.commands.length === 0) return;

    // 浅拷贝当前队列，然后清空原队列。
    // 这是为了防止在执行创建/销毁逻辑时，又触发了新的 defer 导致死循环。
    const tasks = [...this.commands];
    this.commands = [];

    for (const task of tasks) {
      try {
        // 以注册命令时的逻辑帧执行：即使 flush 被推迟到下一帧，
        // 新实体的计时器仍锚定在触发创建的权威帧上。
        withTickFrame(task.frame, task.command);
      } catch (error) {
        console.error("[DeferredManager] Error executing deferred command:", error);
      }
    }
  }

  /**
   * 加载管理器
   */
  public Load(): void {
    // DeferredManager 不需要在加载时做特殊操作
  }

  /**
   * 重置管理器状态
   */
  public Reset(): void {
    // 重置时清空所有延迟命令
    this.commands = [];
  }
}
