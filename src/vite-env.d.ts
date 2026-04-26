/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** Application semantic version, populated from the git tag at build time. */
    readonly VITE_APP_VERSION?: string;
    /** Commit serial number (output of `git rev-list --count HEAD`). */
    readonly VITE_APP_COMMIT?: string;
    /** Public path the app is served from (e.g. "/mvz443/"). Trailing slash included. */
    readonly VITE_APP_BASE?: string;
    /** Optional override for the docs site origin. */
    readonly VITE_DOCS_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
