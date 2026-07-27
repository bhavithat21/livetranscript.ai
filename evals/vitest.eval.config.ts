import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Separate config for the eval harness: node environment (it hits real model APIs
// and executes JS in node:vm — no jsdom needed) and it targets runCoding.ts, which
// is deliberately NOT named *.test.ts so `npm test` never picks it up (evals cost
// money + need keys). Run explicitly via `npm run eval:coding`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['evals/runCoding.ts'],
    testTimeout: 300_000,
  },
})
