import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    lib: {
      entry: 'src/preload/preload.js',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
  },
})