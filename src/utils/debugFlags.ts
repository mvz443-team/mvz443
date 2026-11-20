export const UNLOCK_ALL_CARDS_STORAGE_KEY = "mvz443.debug.unlockall";
export const DBG_COMMANDS_STORAGE_KEY = "mvz443.debug.dbgCommands";
export const NET_DEBUG_STORAGE_KEY = "mvz443.debug.netDebug";

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 读取 localStorage 开关；URL 参数只用于 E2E 默认值，不会覆盖用户显式设置。 */
function readBooleanFlag(storageKey: string, queryKey: string): boolean {
  if (typeof window === "undefined") return false;

  const storage = getStorage();
  const queryValue = new URLSearchParams(window.location.search).get(queryKey);
  if (queryValue === "0" || queryValue === "false") {
    storage?.removeItem(storageKey);
    return false;
  }
  if (queryValue === "1" || queryValue === "true") {
    storage?.setItem(storageKey, "1");
    return true;
  }
  return storage?.getItem(storageKey) === "1";
}

function writeBooleanFlag(storageKey: string, value: boolean): boolean {
  const storage = getStorage();
  if (value) storage?.setItem(storageKey, "1");
  else storage?.removeItem(storageKey);
  return value;
}

/** unlockall：解锁所有卡槽和关卡章节；可开关，不是一次性按钮。 */
export function isUnlockAllEnabled(): boolean {
  return readBooleanFlag(UNLOCK_ALL_CARDS_STORAGE_KEY, "unlockall");
}

export function setUnlockAllEnabled(value: boolean): boolean {
  return writeBooleanFlag(UNLOCK_ALL_CARDS_STORAGE_KEY, value);
}

export function toggleUnlockAll(): boolean {
  return setUnlockAllEnabled(!isUnlockAllEnabled());
}

/** DBG 控制台命令开关。 */
export function isDbgCommandsEnabled(): boolean {
  return readBooleanFlag(DBG_COMMANDS_STORAGE_KEY, "dbgCommands");
}

export function setDbgCommandsEnabled(value: boolean): boolean {
  return writeBooleanFlag(DBG_COMMANDS_STORAGE_KEY, value);
}

/** 网络调试：日志、逐帧记录、desync 日志下载、MVZ_NET 测试钩子。 */
export function isNetDebugEnabled(): boolean {
  return readBooleanFlag(NET_DEBUG_STORAGE_KEY, "netDebug");
}

type NetDebugListener = (enabled: boolean) => void;
const netDebugListeners = new Set<NetDebugListener>();

/** 诊断设施订阅开关变化；设置页切换后立即生效，不必重载页面。 */
export function subscribeNetDebugEnabled(listener: NetDebugListener): () => void {
  netDebugListeners.add(listener);
  return () => netDebugListeners.delete(listener);
}

function notifyNetDebugEnabled(enabled: boolean): void {
  for (const listener of [...netDebugListeners]) listener(enabled);
}

export function setNetDebugEnabled(value: boolean): boolean {
  const applied = writeBooleanFlag(NET_DEBUG_STORAGE_KEY, value);
  notifyNetDebugEnabled(applied);
  return applied;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === NET_DEBUG_STORAGE_KEY) {
      notifyNetDebugEnabled(isNetDebugEnabled());
    }
  });
}

// 兼容旧调用名。
export const isUnlockAllCardsEnabled = isUnlockAllEnabled;
export const toggleUnlockAllCards = toggleUnlockAll;
