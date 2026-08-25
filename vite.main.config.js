import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    rollupOptions: {
      external: ['sharp'],
    },
    lib: {
      entry: 'src/main/main.js',
      formats: ['es'],
      fileName: () => 'main.js',
    },
  },
})
