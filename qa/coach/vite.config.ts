import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  resolve: { alias: { '@/lib/interview/useInterviewRecorder': fileURLToPath(new URL('./adapters/recorder.ts', import.meta.url)), 'next/link': fileURLToPath(new URL('./adapters/link.tsx', import.meta.url)), '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 4180, strictPort: true },
})
