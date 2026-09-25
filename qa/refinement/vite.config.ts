import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
const root = fileURLToPath(new URL('../..', import.meta.url))
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react(), {
    name: 'self-hosted-next-fonts-for-qa',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/_next/static/media/')) return next()
        const name = basename(req.url.split('?')[0])
        if (!/^[a-zA-Z0-9_.-]+\.woff2?$/.test(name)) { res.statusCode = 404; res.end(); return }
        try { res.setHeader('Content-Type', name.endsWith('woff2') ? 'font/woff2' : 'font/woff'); res.end(readFileSync(resolve(root, '.next/static/media', name))) }
        catch { res.statusCode = 404; res.end() }
      })
    },
  }],
  resolve: { alias: { 'next/link': resolve(root, 'qa/coach/adapters/link.tsx'), '@': root } },
  server: { host: '127.0.0.1', port: 4181, strictPort: true },
})
