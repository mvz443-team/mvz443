import { useEffect } from 'react';

/** 全局错误兜底日志。 */
export function useGlobalErrorGuard(): void {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      console.warn('捕获到全局错误:', event.error);
    };
    window.addEventListener('error', onError, true);
    return () => window.removeEventListener('error', onError, true);
  }, []);
}