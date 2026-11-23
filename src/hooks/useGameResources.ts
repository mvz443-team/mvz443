import { useEffect, useState } from 'react';
import {
  getResourceStatus,
  refreshStatus,
  subscribeResources,
  type ResourceStatus,
} from '../utils/cache/gameResources';

/** 订阅资源缓存状态；挂载后主动刷新一次（每次打开网页都会检查最小资源）。 */
export function useGameResources(): ResourceStatus {
  const [status, setStatus] = useState<ResourceStatus>(getResourceStatus);

  useEffect(() => subscribeResources(setStatus), []);
  useEffect(() => {
    void refreshStatus();
  }, []);

  return status;
}
