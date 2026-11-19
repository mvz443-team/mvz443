import { useEffect } from 'react';
import { toggleUnlockAll } from '../utils/debugFlags';

/** 注册 Ctrl+Shift+U 解锁快捷键，按下后清除 URL 上的 unlockall 参数。 */
export function useUnlockAllShortcut(): void {
  useEffect(() => {
    const handleUnlockShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.code !== 'KeyU') {
        return;
      }
      event.preventDefault();
      toggleUnlockAll();
      const url = new URL(window.location.href);
      url.searchParams.delete('unlockall');
      window.location.replace(url.toString());
    };
    window.addEventListener('keydown', handleUnlockShortcut);
    return () => window.removeEventListener('keydown', handleUnlockShortcut);
  }, []);
}