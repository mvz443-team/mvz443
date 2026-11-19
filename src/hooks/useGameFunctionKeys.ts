import { useEffect } from 'react';

/** 隐藏 F1-F10 与 ESC 的默认浏览器行为（防止触发地址栏/菜单等）。 */
export function useGameFunctionKeys(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F1" || event.key === "F2" || event.key === "F3" || event.key === "F4"
        || event.key === "F5" || event.key === "F6" || event.key === "F7" || event.key === "F8"
        || event.key === "F9" || event.key === "F10" || event.key === 'ESC') {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}