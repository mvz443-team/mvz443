// Build-time injected base path. In CI this is set to "/<repo-name>/" by the
// deploy workflow; in local dev/build it falls back to "./" (a relative root).
const rawBase = (import.meta.env.VITE_APP_BASE ?? '').trim();

const getBaseUrl = (): string => {
    if (!rawBase || rawBase === './' || rawBase === '/') return '/';
    return rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
};

const getPublicUrl = (base: string): string => {
    if (base === '/') return '';
    return base.replace(/\/$/, '');
};

export const baseUrl = getBaseUrl();
export const publicUrl = getPublicUrl(baseUrl);

export const publicAssetUrl = (path: string): string => {
    if (/^(?:[a-z][a-z\d+\-.]*:|\/\/)/i.test(path)) return path;
    if (publicUrl && (path === publicUrl || path.startsWith(`${publicUrl}/`))) return path;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${publicUrl}${normalizedPath}`;
};
