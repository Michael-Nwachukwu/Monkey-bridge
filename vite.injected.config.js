import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    define: {
        global: 'globalThis',
        'process.env': {}
    },
    resolve: {
        alias: {
            buffer: 'buffer',
            process: 'process/browser'
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
            entry: 'src/injected-nexus.ts',
            name: 'NexusInjected',
            formats: ['iife'],
            fileName: () => 'injected-nexus.js'
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true
            }
        }
    }
});
