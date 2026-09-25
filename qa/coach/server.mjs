// Reuse the exact Vite version locked under Vitest; no unpinned build tool.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { createServer } = await import(pathToFileURL(fromVitest.resolve('vite')).href)
const server = await createServer({ configFile: 'qa/coach/vite.config.ts' })
await server.listen()
server.printUrls()
