export const UNLOCK_ALL_CARDS_STORAGE_KEY = "mvz443.debug.unlockAllCards";

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isUnlockAllCardsEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const storage = getStorage();
  const value = new URLSearchParams(window.location.search).get("unlockAllCards");
  if (value === "0" || value === "false") {
    storage?.removeItem(UNLOCK_ALL_CARDS_STORAGE_KEY);
    return false;
  }
  if (value === "1" || value === "true") {
    storage?.setItem(UNLOCK_ALL_CARDS_STORAGE_KEY, "1");
    return true;
  }
  return storage?.getItem(UNLOCK_ALL_CARDS_STORAGE_KEY) === "1";
}

export function toggleUnlockAllCards(): boolean {
  const storage = getStorage();
  const nextValue = !isUnlockAllCardsEnabled();
  if (nextValue) {
    storage?.setItem(UNLOCK_ALL_CARDS_STORAGE_KEY, "1");
  } else {
    storage?.removeItem(UNLOCK_ALL_CARDS_STORAGE_KEY);
  }
  return nextValue;
}
