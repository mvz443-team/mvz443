/**
 * 媒体就绪等待：确保音频/视频缓存中的资源真正可播放。
 *
 * 从 Game 场景中拆出，供 Preloader 在“加载音乐音效资源”阶段复用。
 */
export class GameMediaReadiness {
  constructor(private readonly cache: Phaser.Cache.CacheManager) {}

  public async waitForMediaReady(): Promise<void> {
    await Promise.all([
      this.waitForAudioCacheReady(),
      this.waitForVideoCacheReady(),
      this.waitForBrowserMediaTick(),
    ]);
  }

  private async waitForAudioCacheReady(): Promise<void> {
    const audioCache = this.cache.audio;
    const keys = audioCache.getKeys();
    const waits: Array<Promise<void>> = [];
    const supportsAudioBuffer = typeof AudioBuffer !== "undefined";

    for (const key of keys) {
      const data = audioCache.get(key);

      if (supportsAudioBuffer && data instanceof AudioBuffer) {
        if (data.duration <= 0) {
          throw new Error(`Decoded audio "${key}" has invalid duration.`);
        }
        continue;
      }

      if (Array.isArray(data)) {
        for (const audio of data) {
          if (audio instanceof HTMLMediaElement) {
            waits.push(this.waitForMediaElementReady(audio, `audio:${key}`));
          }
        }
      }
    }

    await Promise.all(waits);
  }

  private async waitForVideoCacheReady(): Promise<void> {
    const videoCache = this.cache.video;
    const keys = videoCache.getKeys();
    const waits: Array<Promise<void>> = [];

    for (const key of keys) {
      const data = videoCache.get(key) as {
        url?: string;
        noAudio?: boolean;
        crossOrigin?: string;
      } | null;

      if (!data?.url) {
        continue;
      }

      const video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      video.muted = true;
      if (data.crossOrigin) {
        video.crossOrigin = data.crossOrigin;
      }
      video.src = data.url;

      waits.push(
        this.waitForMediaElementReady(video, `video:${key}`).finally(() => {
          video.removeAttribute("src");
          video.load();
        }),
      );
    }

    await Promise.all(waits);
  }

  private waitForMediaElementReady(media: HTMLMediaElement, label: string): Promise<void> {
    const enoughData = () => media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
    if (enoughData()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`${label} did not become ready in time.`));
      }, 20000);

      const onReady = () => {
        if (!enoughData()) {
          return;
        }
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error(`${label} failed to load.`));
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        media.removeEventListener("loadeddata", onReady);
        media.removeEventListener("canplay", onReady);
        media.removeEventListener("canplaythrough", onReady);
        media.removeEventListener("error", onError);
      };

      media.addEventListener("loadeddata", onReady);
      media.addEventListener("canplay", onReady);
      media.addEventListener("canplaythrough", onReady);
      media.addEventListener("error", onError);

      try {
        media.load();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  private waitForBrowserMediaTick(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }
}
