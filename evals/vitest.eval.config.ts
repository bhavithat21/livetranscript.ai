import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Separate config for the eval harness: node environment (it hits real model APIs
// and executes JS in node:vm — no jsdom needed) and it targets the run*.ts files,
// which are deliberately NOT named *.test.ts so `npm test` never picks them up
// (model evals cost money + need keys). Run all via `npm run eval:all`, or one at a
// time with a filter, e.g. `npm run eval:coding` (= vitest … runCoding).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['evals/runCoding.ts', 'evals/runDetection.ts', 'evals/runBehavioralVoice.ts'],
    testTimeout: 300_000,
  },
})
