import { useEffect } from 'react';

/** 在移动设备进入游戏画面时锁定横屏，退出时解锁。 */
export function useScreenOrientationLock(
  shouldLock: boolean,
): void {
  useEffect(() => {
    if (!shouldLock) {
      return;
    }

    const orientation = screen.orientation as (ScreenOrientation & {
      lock?: (orientation: OrientationLockType) => Promise<void>;
      unlock?: () => void;
    }) | undefined;
    void orientation?.lock?.('landscape').catch(() => undefined);

    return () => {
      orientation?.unlock?.();
    };
  }, [shouldLock]);
}