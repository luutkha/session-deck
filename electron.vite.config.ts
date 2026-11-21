import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // officeWorker.js is a second entry: the spreadsheet / Word parsers run in a worker thread with a memory limit.
        input: {
          index: resolve('src/main/index.ts'),
          officeWorker: resolve('src/main/preview/officeWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve('index.html')
        }
      }
    },
    resolve: {
      alias: [{ find: /^@\//, replacement: `${resolve('src/renderer')}/` }]
    },
    plugins: [react(), tailwindcss()]
  }
})
