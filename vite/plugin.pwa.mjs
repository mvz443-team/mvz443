import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const CACHE_PREFIX = 'mvz-';

function walk(dir, root) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, root));
    } else {
      out.push(relative(root, full).split(sep).join('/'));
    }
  }
  return out;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function gitShort() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

function bundleHash(files, hashes) {
  const h = createHash('sha256');
  for (const file of [...files].sort()) {
    h.update(file);
    h.update(':');
    h.update(hashes.get(file) ?? '');
    h.update('\n');
  }
  return h.digest('hex').slice(0, 12);
}

function isShellFile(path) {
  return path === 'index.html'
    || path === 'favicon.png'
    || /\.(?:js|css|mjs)$/.test(path);
}

function isExtraBgm(path) {
  return path.startsWith('assets/audio/')
    && !path.startsWith('assets/audio/sounds/')
    && /\.(?:ogg|mp3|m4a|wav)$/i.test(path);
}

function isExtraIllustration(path) {
  return path.startsWith('assets/dramas/');
}

/**
 * 产出 dist/asset-manifest.json 与 dist/sw.js。
 *
 * 分层：
 *  - core  : 应用壳 + 战斗素材 + stage 配置 + sfx（与代码同版本）
 *  - bgm   : assets/audio 下的音乐（按内容 hash，未变则不重下）
 *  - illust: assets/dramas 下的关卡插图
 *
 * SW 只负责“读取”缓存；下载动作在页面侧通过 Cache API 完成，
 * 这样才能给强制资源弹窗和设置面板提供真实进度。
 */
export function pwaAssetsPlugin(options = {}) {
  const appVersion = options.appVersion || 'develop';
  let outDir = 'dist';

  return {
    name: 'mvz-pwa-assets',
    apply: 'build',
    configResolved(config) {
      outDir = config.build?.outDir || 'dist';
    },
    closeBundle() {
      const root = resolve(process.cwd(), outDir);
      if (!existsSync(root)) return;

      const files = walk(root, root).filter(
        (path) => path !== 'asset-manifest.json' && path !== 'sw.js',
      );
      const hashes = new Map();
      const entries = {};
      for (const path of files) {
        const size = statSync(join(root, path)).size;
        hashes.set(path, sha256(readFileSync(join(root, path))));
        entries[path] = { url: path, size };
      }

      const coreFiles = files.filter(
        (path) => !isExtraBgm(path) && !isExtraIllustration(path),
      );
      const bgmFiles = files.filter(isExtraBgm);
      const illustrationFiles = files.filter(isExtraIllustration);

      const manifest = {
        version: `${appVersion}.${bundleHash(coreFiles, hashes)}-${gitShort()}`,
        core: coreFiles.map((path) => entries[path]),
        extra: {
          bgm: bgmFiles.map((path) => entries[path]),
          illustrations: illustrationFiles.map((path) => entries[path]),
        },
        extraHashes: {
          bgm: bundleHash(bgmFiles, hashes),
          illustrations: bundleHash(illustrationFiles, hashes),
        },
        coreShell: coreFiles.filter(isShellFile).map((path) => entries[path]),
        generatedAt: new Date().toISOString(),
      };

      writeFileSync(join(root, 'asset-manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(root, 'sw.js'), buildServiceWorker(manifest));
      process.stdout.write(
        `  pwa assets: core=${manifest.core.length} bgm=${manifest.extra.bgm.length} ` +
        `illustrations=${manifest.extra.illustrations.length} version=${manifest.version}\n`,
      );
    },
  };
}

function buildServiceWorker(manifest) {
  const coreCache = `${CACHE_PREFIX}core-${manifest.version}`;
  const extraCaches = [
    `${CACHE_PREFIX}extra-bgm-${manifest.extraHashes.bgm}`,
    `${CACHE_PREFIX}extra-illustrations-${manifest.extraHashes.illustrations}`,
  ];
  const allowed = JSON.stringify([coreCache, ...extraCaches]);

  return `/* 由 vite/plugin.pwa.mjs 自动生成，请勿手工编辑 */
const MANIFEST = ${JSON.stringify(manifest)};
const PREFIX = '${CACHE_PREFIX}';
const CORE_CACHE = ${JSON.stringify(coreCache)};
const ALLOWED = new Set(${allowed});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const firstInstall = !keys.some((key) => key.startsWith(PREFIX));
    if (firstInstall) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(PREFIX) && !ALLOWED.has(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function fromCaches(url) {
  const names = [CORE_CACHE, ...Array.from(ALLOWED).filter((k) => k !== CORE_CACHE)];
  const existing = await caches.keys();
  for (const name of names) {
    if (!existing.includes(name)) continue;
    const cache = await caches.open(name);
    const hit = await cache.match(url, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // 页面下载/更新资源时带此头，强制走网络，防止把旧缓存再写回新缓存。
  if (request.headers.has('x-mvz-precache')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 清单必须永远来自网络，否则客户端无法发现新版本。
  if (url.pathname.endsWith('/asset-manifest.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const shell = await fromCaches(new URL('index.html', self.registration.scope).href);
        if (shell) return shell;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await fromCaches(url.href);
    if (cached) return cached;
    return fetch(request);
  })());
});
`;
}

export default pwaAssetsPlugin;
