import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [react(), tailwindcss(),],
    base: './', // Use relative paths for Chrome extension
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                popup: 'index.html',
                background: 'src/background.js',
                content: 'src/content.js',
                injected: 'src/injected.js'
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name].[ext]'
            }
        }
    }
});