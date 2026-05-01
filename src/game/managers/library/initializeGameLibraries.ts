import { ChapterLibrary } from "./ChapterLibrary";
import { MonsterLibrary } from "./MonsterLibrary";
import { ObstacleLibrary } from "./ObstacleLibrary";
import { PlantLibrary } from "./PlantLibrary";

declare global {
  interface Window {
    __mvz443LibrariesInitialized__?: boolean;
    __mvz443LibrariesInitializing__?: Promise<void>;
  }
}

export async function initializeGameLibraries() {
  if (window.__mvz443LibrariesInitialized__) {
    return;
  }

  if (window.__mvz443LibrariesInitializing__) {
    return window.__mvz443LibrariesInitializing__;
  }

  window.__mvz443LibrariesInitializing__ = (async () => {
    await ChapterLibrary.Initialize();
    PlantLibrary.Initialize();
    MonsterLibrary.Initialize();
    ObstacleLibrary.Initialize();

    window.__mvz443LibrariesInitialized__ = true;
  })();

  return window.__mvz443LibrariesInitializing__;
}
