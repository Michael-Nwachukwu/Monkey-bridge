import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [react(), tailwindcss(),],
    base: './', // Use relative paths for Chrome extension
    define: {
        // Polyfills for Node.js globals
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
        rollupOptions: {
            input: {
                popup: 'index.html',
                background: 'src/background.ts',
                content: 'src/content.ts',
                injected: 'src/injected.ts'
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name].js',
                assetFileNames: '[name].[ext]',
                format: 'es'
            }
        }
    }
});