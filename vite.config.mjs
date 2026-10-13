import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import provenance from './scripts/build-provenance.cjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command }) => ({
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: {
        __WSR_BUILD_PROVENANCE__: JSON.stringify(provenance.createBuildProvenance(root, { development: command === 'serve' })),
    },
    build: { outDir: 'dist', target: ['chrome111', 'edge111', 'firefox111', 'safari16.4'] },
}));
