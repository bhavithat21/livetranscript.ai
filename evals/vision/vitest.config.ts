import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({ plugins: [tsconfigPaths()], test: { environment: 'node', include: ['evals/vision/runBenchmark.ts', 'evals/vision/runSelection.ts'], testTimeout: 3_600_000 } })
