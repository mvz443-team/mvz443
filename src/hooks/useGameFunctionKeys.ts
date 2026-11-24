import { useEffect } from 'react';

/**
 * 隐藏 F1-F10 的默认浏览器行为（防止触发地址栏/菜单等）。
 *
 * 不能在这里处理 Esc：Phaser 的 KeyboardManager 会丢弃 `defaultPrevented`
 * 的事件，DOM 层 preventDefault 会让游戏内的 Esc 快捷键收不到。
 * 游戏里用到的键（Esc/T/Q/W）由 `KeybindManager` 的 `addKey` 自带 capture
 * 负责阻止浏览器默认行为。
 */
export function useGameFunctionKeys(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F1" || event.key === "F2" || event.key === "F3" || event.key === "F4"
        || event.key === "F5" || event.key === "F6" || event.key === "F7" || event.key === "F8"
        || event.key === "F9" || event.key === "F10") {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}