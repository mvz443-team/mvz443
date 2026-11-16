import type {
  LoadoutCard,
  LoadoutModifier,
  LoadoutSnapshot,
  PlayerLoadout,
} from "../../pb/common";

export type { LoadoutCard, LoadoutModifier, LoadoutSnapshot, PlayerLoadout };

/** 与服务端 room-atom/loadout.go 的 canonicalLoadout 保持完全一致。 */
export function canonicalizeLoadout(input?: LoadoutSnapshot | null): LoadoutSnapshot {
  const source: LoadoutSnapshot = input ?? {
    cards: [],
    level: 0,
    initialEnergy: 0,
    initialStarShards: 0,
    globalModifiers: [],
  };
  const seenCards = new Set<number>();
  const cards: LoadoutCard[] = [];
  for (const card of source.cards ?? []) {
    if (!card || seenCards.has(card.pid)) continue;
    seenCards.add(card.pid);
    cards.push({ pid: card.pid, level: card.level });
  }
  cards.sort((a, b) => a.pid - b.pid);

  const seenModifiers = new Set<string>();
  const globalModifiers: LoadoutModifier[] = [];
  for (const modifier of source.globalModifiers ?? []) {
    if (!modifier || seenModifiers.has(modifier.key)) continue;
    seenModifiers.add(modifier.key);
    globalModifiers.push({ key: modifier.key, value: modifier.value });
  }
  globalModifiers.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    cards,
    level: source.level ?? 0,
    initialEnergy: source.initialEnergy ?? 0,
    initialStarShards: source.initialStarShards ?? 0,
    globalModifiers,
  };
}

/** FNV-1a 32 位；规范串格式必须与服务端 loadoutHash 一致。 */
export function computeLoadoutHash(loadout: LoadoutSnapshot): string {
  const canonical = canonicalizeLoadout(loadout);
  const cardParts = canonical.cards.map((card) => `${card.pid}:${card.level}`);
  const modifierParts = canonical.globalModifiers.map((modifier) => `${modifier.key}=${modifier.value}`);
  const serialized = [
    `cards=${cardParts.join(",")}`,
    `level=${canonical.level}`,
    `energy=${canonical.initialEnergy}`,
    `stars=${canonical.initialStarShards}`,
    `mods=${modifierParts.join(",")}`,
  ].join("|");

  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(serialized);
  for (let i = 0; i < bytes.length; i++) {
    hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function toPlayerLoadout(playerId: number, input?: LoadoutSnapshot | null): PlayerLoadout {
  const canonical = canonicalizeLoadout(input);
  return { playerId, loadout: canonical, hash: computeLoadoutHash(canonical) };
}

export function findPlayerLoadout(loadouts: readonly PlayerLoadout[] | undefined, playerId: number): PlayerLoadout | undefined {
  return loadouts?.find((entry) => entry.playerId === playerId);
}
