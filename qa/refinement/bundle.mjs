import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url), fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = await import(pathToFileURL(fromVitest.resolve('vite')).href)
await build({ configFile: 'qa/refinement/vite.config.ts', base: './', build: { outDir: resolve('qa-results/refinement-bundle'), emptyOutDir: true, cssCodeSplit: false, minify: false, rollupOptions: { input: resolve('qa/refinement/index.html'), output: { inlineDynamicImports: true } } } })
