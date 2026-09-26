import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const { build } = await import(pathToFileURL(createRequire(require.resolve('vitest/package.json')).resolve('vite')).href)
const react = (await import('@vitejs/plugin-react')).default
const path = file => fileURLToPath(new URL(file, import.meta.url))
await build({ configFile: false, root: path('.'), plugins: [react()], resolve: { alias: {
  '@': path('../..'), '@tauri-apps/api/core': path('./bridge.ts'), '@tauri-apps/api/event': path('./bridge.ts'), '@tauri-apps/api/window': path('./bridge.ts'),
}}, build: { outDir: path('../../qa-results/desktop-pointer/bundle'), emptyOutDir: true, rollupOptions: { output: { inlineDynamicImports: true } } } })
