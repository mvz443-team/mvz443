import { useCallback, useEffect, useState } from 'react';
import {
  GAME_ASPECT_RATIO,
  getGameToolLayoutMetrics,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
  LOGICAL_BATTLE_WORLD_WIDTH,
} from '../constants/gameLayout';

export type ViewportSize = {
  width: number;
  height: number;
};

export const getViewportSize = (): ViewportSize => {
  const viewport = window.visualViewport;

  return {
    width: Math.round(viewport?.width ?? window.innerWidth),
    height: Math.round(viewport?.height ?? window.innerHeight),
  };
};

/** 订阅视口尺寸变化，返回当前视口宽高。 */
export function useViewportSize(): ViewportSize {
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize());

  const updateViewportSize = useCallback(() => {
    setViewportSize(getViewportSize());
  }, []);

  useEffect(() => {
    window.addEventListener('resize', updateViewportSize);
    window.addEventListener('orientationchange', updateViewportSize);
    window.visualViewport?.addEventListener('resize', updateViewportSize);
    window.visualViewport?.addEventListener('scroll', updateViewportSize);

    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.removeEventListener('orientationchange', updateViewportSize);
      window.visualViewport?.removeEventListener('resize', updateViewportSize);
      window.visualViewport?.removeEventListener('scroll', updateViewportSize);
    };
  }, [updateViewportSize]);

  return viewportSize;
}

export function getFittedMainWidth(
  preferredWidth: number,
  viewportSize: ViewportSize,
  deviceType: 'mobile' | 'pc',
  showGameTool: boolean,
) {
  const viewportPadding = deviceType === 'mobile' ? 8 : 16;
  const availableWidth = Math.max(240, viewportSize.width - viewportPadding * 2);
  const availableHeight = Math.max(180, viewportSize.height - viewportPadding * 2);

  const getTotalWidth = (mainWidth: number) => {
    const gameHeight = mainWidth * GAME_ASPECT_RATIO;
    return getGameToolLayoutMetrics(mainWidth, gameHeight, deviceType, showGameTool).totalWidth;
  };

  const getTotalHeight = (mainWidth: number) => {
    const gameHeight = mainWidth * GAME_ASPECT_RATIO;
    return getGameToolLayoutMetrics(mainWidth, gameHeight, deviceType, showGameTool).totalHeight;
  };

  let low = 160;
  let high = Math.max(low, preferredWidth);

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (getTotalWidth(mid) <= availableWidth && getTotalHeight(mid) <= availableHeight) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.max(160, Math.floor(Math.min(preferredWidth, low)));
}

function getLandscapeViewportSize(viewportSize: ViewportSize): ViewportSize {
  return {
    width: Math.max(viewportSize.width, viewportSize.height),
    height: Math.min(viewportSize.width, viewportSize.height),
  };
}

function getMobileGameMainSize(
  viewportSize: ViewportSize,
  showGameTool: boolean,
  stageRows?: number,
): ViewportSize {
  void stageRows;
  const landscape = getLandscapeViewportSize(viewportSize);
  const availableWidth = Math.max(240, landscape.width);
  const availableHeight = Math.max(180, landscape.height);
  let low = 120;
  let high = Math.max(low, availableWidth);

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const metrics = getGameToolLayoutMetrics(mid, availableHeight, 'mobile', showGameTool);
    if (metrics.totalWidth <= availableWidth && metrics.totalHeight <= availableHeight) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    width: Math.floor(Math.max(120, low)),
    height: Math.floor(availableHeight),
  };
}

function getPcGameMainSize(
  preferredWorldWidth: number,
  viewportSize: ViewportSize,
  showGameTool: boolean,
): ViewportSize {
  const viewportPadding = 16;
  const availableWidth = Math.max(240, viewportSize.width - viewportPadding * 2);
  const availableHeight = Math.max(180, viewportSize.height - viewportPadding * 2);
  const preferredScale = Math.max(0.1, preferredWorldWidth / LOGICAL_BATTLE_WORLD_WIDTH);
  let low = 0.1;
  let high = preferredScale;

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const mainWidth = LOGICAL_BATTLE_WIDTH * mid;
    const mainHeight = LOGICAL_BATTLE_HEIGHT * mid;
    const metrics = getGameToolLayoutMetrics(mainWidth, mainHeight, 'pc', showGameTool);
    if (metrics.totalWidth <= availableWidth && metrics.totalHeight <= availableHeight) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    width: Math.floor(LOGICAL_BATTLE_WIDTH * low),
    height: Math.floor(LOGICAL_BATTLE_HEIGHT * low),
  };
}

export function getFittedMainSize(
  preferredWidth: number,
  viewportSize: ViewportSize,
  deviceType: 'mobile' | 'pc',
  showGameTool: boolean,
  stageRows?: number,
): ViewportSize {
  if (deviceType === 'mobile' && showGameTool) {
    return getMobileGameMainSize(viewportSize, showGameTool, stageRows);
  }

  if (deviceType === 'pc' && showGameTool) {
    return getPcGameMainSize(preferredWidth, viewportSize, showGameTool);
  }

  const fittedWidth = getFittedMainWidth(preferredWidth, viewportSize, deviceType, showGameTool);
  return {
    width: fittedWidth,
    height: Math.floor(fittedWidth * GAME_ASPECT_RATIO),
  };
}

export function getNonGameMainSize(
  preferredWidth: number,
  viewportSize: ViewportSize,
  deviceType: 'mobile' | 'pc',
): ViewportSize {
  if (deviceType === 'pc') {
    const fittedWidth = getFittedMainWidth(preferredWidth, viewportSize, deviceType, false);

    return {
      width: fittedWidth,
      height: Math.floor(fittedWidth * GAME_ASPECT_RATIO),
    };
  }

  const viewportPadding = 16;
  const availableWidth = Math.max(240, viewportSize.width - viewportPadding * 2);
  const availableHeight = Math.max(180, viewportSize.height - viewportPadding * 2);

  return {
    width: Math.max(160, Math.floor(Math.min(preferredWidth, availableWidth))),
    height: Math.floor(availableHeight),
  };
}