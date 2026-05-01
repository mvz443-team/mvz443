export const LEVEL_BADGE_TEXTURE_LEVELS = Array.from({ length: 9 }, (_, index) => index + 1);

export function getLevelBadgeTextureKey(level: number): string {
  return `ui/level-badge-${level}`;
}

export function getLevelBadgeAssetPath(level: number): string {
  return `card/badges/level-${level}.svg`;
}
