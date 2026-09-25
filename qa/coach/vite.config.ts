import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 4180, strictPort: true },
})
