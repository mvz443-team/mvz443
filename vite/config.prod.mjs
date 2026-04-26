import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import removeConsole from 'vite-plugin-remove-console'

const APP_VERSION = process.env.VITE_APP_VERSION || 'develop';
const APP_COMMIT = process.env.VITE_APP_COMMIT || 'local';
const APP_BASE = process.env.VITE_APP_BASE || './';

const phasermsg = () => {
    return {
        name: 'phasermsg',
        buildStart() {
            process.stdout.write(`Building for production...\n`);
            process.stdout.write(`  base    : ${APP_BASE}\n`);
            process.stdout.write(`  version : ${APP_VERSION}\n`);
            process.stdout.write(`  commit  : ${APP_COMMIT}\n`);
        },
        buildEnd() {
            const line = "---------------------------------------------------------";
            const msg = `❤️❤️❤️ Tell us about your game! - games@phaser.io ❤️❤️❤️`;
            process.stdout.write(`${line}\n${msg}\n${line}\n`);

            process.stdout.write(`✨ Done ✨\n`);
        }
    }
}

export default defineConfig({
    base: APP_BASE,
    define: {
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
        'import.meta.env.VITE_APP_COMMIT': JSON.stringify(APP_COMMIT),
        'import.meta.env.VITE_APP_BASE': JSON.stringify(APP_BASE),
    },
    plugins: [
        react(),
        phasermsg(),
        removeConsole()
    ],
    logLevel: 'warning',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 2
            },
            mangle: true,
            format: {
                comments: false
            }
        }
    }
});
