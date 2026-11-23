// 游戏资源分层缓存：最小资源（core）与可选额外资源（bgm / 关卡插图）。
// 下载动作放在页面侧使用 Cache API，Service Worker 只负责命中后返回缓存，
// 这样首屏强制弹窗和设置面板都能拿到逐文件真实进度。

import { baseUrl, publicAssetUrl } from '../browser';

export type BundleId = 'core' | 'bgm' | 'illustrations';

export interface ManifestEntry {
  url: string;
  size: number;
}

export interface AssetManifest {
  version: string;
  core: ManifestEntry[];
  extra: {
    bgm: ManifestEntry[];
    illustrations: ManifestEntry[];
  };
  extraHashes: {
    bgm: string;
    illustrations: string;
  };
  coreShell: ManifestEntry[];
  generatedAt: string;
}

export interface BundleStatus {
  key: string;
  ready: boolean;
  cached: number;
  total: number;
  bytes: number;
}

export interface ResourceStatus {
  loading: boolean;
  manifest: AssetManifest | null;
  core: BundleStatus;
  bgm: BundleStatus;
  illustrations: BundleStatus;
  /** core 未下载或与当前版本不一致：首屏必须阻断并二选一。 */
  gateRequired: boolean;
  error: string | null;
}

export interface DownloadProgress {
  bundle: BundleId;
  done: number;
  total: number;
  bytes: number;
}

const CACHE_PREFIX = 'mvz-';
const MANIFEST_URL = publicAssetUrl('asset-manifest.json');

const emptyBundle = (key = ''): BundleStatus => ({
  key, ready: false, cached: 0, total: 0, bytes: 0,
});

let currentStatus: ResourceStatus = {
  loading: true,
  manifest: null,
  core: emptyBundle(),
  bgm: emptyBundle(),
  illustrations: emptyBundle(),
  gateRequired: false,
  error: null,
};

const listeners = new Set<(status: ResourceStatus) => void>();

function emit() {
  for (const listener of listeners) listener(currentStatus);
}

function update(partial: Partial<ResourceStatus>) {
  currentStatus = { ...currentStatus, ...partial };
  emit();
}

function cacheKeyFor(manifest: AssetManifest, bundle: BundleId): string {
  switch (bundle) {
    case 'core':
      return `${CACHE_PREFIX}core-${manifest.version}`;
    case 'bgm':
      return `${CACHE_PREFIX}extra-bgm-${manifest.extraHashes.bgm}`;
    case 'illustrations':
      return `${CACHE_PREFIX}extra-illustrations-${manifest.extraHashes.illustrations}`;
  }
}

function entriesFor(manifest: AssetManifest, bundle: BundleId): ManifestEntry[] {
  switch (bundle) {
    case 'core':
      return manifest.core;
    case 'bgm':
      return manifest.extra.bgm;
    case 'illustrations':
      return manifest.extra.illustrations;
  }
}

/** 清单里的 URL 是相对 base 的路径；以清单自身位置为基准解析，兼容子路径部署。 */
export function resolveAssetUrl(path: string): string {
  const base = new URL(MANIFEST_URL, window.location.href);
  return new URL(path, base).href;
}

async function checkBundle(manifest: AssetManifest, bundle: BundleId): Promise<BundleStatus> {
  const entries = entriesFor(manifest, bundle);
  const key = cacheKeyFor(manifest, bundle);
  const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const total = entries.length;
  if (!('caches' in window)) return { key, ready: false, cached: 0, total, bytes };
  if (!(await caches.has(key))) return { key, ready: false, cached: 0, total, bytes };
  const cache = await caches.open(key);
  let cached = 0;
  for (const entry of entries) {
    if (await cache.match(resolveAssetUrl(entry.url), { ignoreSearch: true })) {
      cached += 1;
    }
  }
  // 部分下载（被中断）或部署路径变化导致的 URL 不匹配都不算就绪。
  const ready = total === 0 || cached === total;
  return { key, ready, cached, total, bytes };
}

export async function fetchManifest(): Promise<AssetManifest> {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`资源清单请求失败: ${response.status}`);
  }
  const manifest = await response.json() as AssetManifest;
  if (!manifest?.version || !Array.isArray(manifest.core) || !manifest.extra) {
    throw new Error('资源清单格式无效');
  }
  return manifest;
}

export async function refreshStatus(): Promise<ResourceStatus> {
  update({ loading: true, error: null });
  if (!import.meta.env.PROD) {
    const idle: ResourceStatus = {
      loading: false,
      manifest: null,
      core: { ...emptyBundle('dev-core'), ready: true, total: 0 },
      bgm: { ...emptyBundle('dev-bgm'), ready: true, total: 0 },
      illustrations: { ...emptyBundle('dev-art'), ready: true, total: 0 },
      gateRequired: false,
      error: null,
    };
    currentStatus = idle;
    emit();
    return idle;
  }
  try {
    const manifest = await fetchManifest();
    const [core, bgm, illustrations] = await Promise.all([
      checkBundle(manifest, 'core'),
      checkBundle(manifest, 'bgm'),
      checkBundle(manifest, 'illustrations'),
    ]);
    const next: ResourceStatus = {
      loading: false,
      manifest,
      core,
      bgm,
      illustrations,
      gateRequired: !core.ready,
      error: null,
    };
    currentStatus = next;
    emit();
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 清单不可得（离线首开/dev 静态服务）时不阻断游戏，交给网络层自己报错。
    const next: ResourceStatus = {
      loading: false,
      manifest: null,
      core: { ...emptyBundle(), ready: true },
      bgm: emptyBundle(),
      illustrations: emptyBundle(),
      gateRequired: false,
      error: message,
    };
    currentStatus = next;
    emit();
    return next;
  }
}

export function getResourceStatus(): ResourceStatus {
  return currentStatus;
}

export function subscribeResources(listener: (status: ResourceStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function cleanupStaleCaches(prefix: string, keep: string) {
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith(prefix) && key !== keep)
    .map((key) => caches.delete(key)));
}

export async function precacheBundle(
  bundle: BundleId,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const manifest = currentStatus.manifest ?? await fetchManifest();
  const entries = entriesFor(manifest, bundle);
  const key = cacheKeyFor(manifest, bundle);
  if (!('caches' in window)) {
    throw new Error('当前浏览器不支持 Cache Storage');
  }

  const cache = await caches.open(key);
  let done = 0;
  let bytes = 0;
  for (const entry of entries) {
    const url = resolveAssetUrl(entry.url);
    // 带专用头，让 SW 跳过缓存读取，避免“更新”时把旧缓存文件再存一遍。
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'X-MVZ-Precache': '1' },
    });
    if (!response.ok) {
      throw new Error(`下载失败: ${entry.url} (${response.status})`);
    }
    await cache.put(url, response);
    done += 1;
    bytes += entry.size;
    onProgress?.({ bundle, done, total: entries.length, bytes });
  }

  const stored = await (await caches.open(key)).keys();
  if (stored.length < entries.length) {
    await caches.delete(key);
    throw new Error('资源未完整下载，请重试');
  }

  await cleanupStaleCaches(
    bundle === 'core' ? `${CACHE_PREFIX}core-` : `${CACHE_PREFIX}extra-${bundle}-`,
    key,
  );
  await refreshStatus();
}

export async function clearBundle(bundle: BundleId): Promise<void> {
  const manifest = currentStatus.manifest ?? await fetchManifest();
  if ('caches' in window) {
    await caches.delete(cacheKeyFor(manifest, bundle));
  }
  await refreshStatus();
}

/** 通知 waiting 的 SW 接管并刷新页面；首次安装时没有 waiting，不动页面。 */
export async function finishUpdate(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;

  // 浏览器可能在导航后才异步发现新 SW；主动检查并等待它进入 waiting。
  await registration.update().catch(() => undefined);
  let waiting = registration.waiting;
  if (!waiting && registration.installing) {
    await new Promise<void>((resolve) => {
      const installing = registration.installing;
      if (!installing) {
        resolve();
        return;
      }
      installing.addEventListener('statechange', () => {
        if (registration.waiting) resolve();
        if (installing.state === 'redundant') resolve();
      });
      window.setTimeout(resolve, 5000);
    });
    waiting = registration.waiting;
  }
  if (!waiting) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('controllerchange', done);
      resolve();
    };
    window.addEventListener('controllerchange', done);
    waiting?.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(done, 3000);
  });
  window.location.reload();
}

/** 供 Phaser Preloader 判断是否可以加载 BGM。 */
export async function isBundleReady(bundle: 'bgm' | 'illustrations'): Promise<boolean> {
  if (!import.meta.env.PROD) return true;
  try {
    const manifest = currentStatus.manifest ?? await fetchManifest();
    currentStatus.manifest = manifest;
    return (await checkBundle(manifest, bundle)).ready;
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    // 开发环境使用 Vite 实时文件；清掉同一 origin 上可能残留的生产 SW，
    // 避免旧缓存拦截热更新资源。
    const expectedScope = new URL(baseUrl, window.location.href).href;
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(
        registrations
          .filter((registration) => registration.scope === expectedScope)
          .map((registration) => registration.unregister()),
      ))
      .catch(() => undefined);
    return;
  }
  navigator.serviceWorker.register(publicAssetUrl('sw.js'), { scope: baseUrl }).catch((error) => {
    console.warn('[resources] service worker 注册失败', error);
  });
}
