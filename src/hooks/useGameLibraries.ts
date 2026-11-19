import { useEffect, useState } from 'react';
import { initializeGameLibraries } from '../game/managers/library/initializeGameLibraries';

export type GameLibraryState = {
  ready: boolean;
  error: Error | null;
};

/** 初始化植物/僵尸/章节等静态库，返回加载状态。 */
export function useGameLibraries(): GameLibraryState {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isCancelled = false;

    initializeGameLibraries()
      .then(() => {
        if (!isCancelled) {
          setReady(true);
        }
      })
      .catch((err) => {
        console.error('Failed to initialize game libraries:', err);
        if (!isCancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return { ready, error };
}