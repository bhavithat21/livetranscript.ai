// Optional offline browser-QA bundles: no network navigation or provider access.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = await import(pathToFileURL(fromVitest.resolve('vite')).href)
for (const entry of ['index', 'live']) await build({ configFile: 'qa/coach/vite.config.ts', base: './', build: { outDir: resolve(`qa-results/coach-bundles/${entry}`), emptyOutDir: true, cssCodeSplit: false, minify: false, rollupOptions: { input: resolve(`qa/coach/${entry}.html`), output: { inlineDynamicImports: true } } } })
